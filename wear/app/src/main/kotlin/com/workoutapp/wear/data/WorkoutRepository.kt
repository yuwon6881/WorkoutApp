package com.workoutapp.wear.data

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.workoutapp.wear.service.WorkoutOngoingService
import com.workoutapp.wear.worker.WorkoutSyncWorker
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The watch's single entry point to the live workout. Logging is local-first: every edit is written
 * to the store with its projected result before any request, then replayed in order. The watch only
 * joins a workout already running in WorkoutApp; starting, editing exercises and discarding stay on
 * the phone.
 */
class WorkoutRepository private constructor(context: Context) {
    private val application = context.applicationContext
    val store = WorkoutStore.get(application)
    val secureStore = SecureTokenStore(application)
    private val api = WorkoutApi(com.workoutapp.wear.BuildConfig.API_BASE_URL, secureStore)
    private val sync = WorkoutSyncCoordinator(application, store, api)
    private val gson: Gson = GsonBuilder().serializeNulls().create()

    // Replay, refresh and conflict resolution read the queue head, wait on the network and write
    // back; one gate for the process stops the activity and the sync worker interleaving them.
    private val gate = Mutex()

    val state: StateFlow<StoreState> get() = store.state
    val notice: StateFlow<String?> get() = store.notice

    fun cached(): WorkoutSnapshot? = store.readSnapshot()

    fun saveSetTimer(setId: String, timer: SetTimerSnapshot) {
        val saved = store.update { snapshot, _ ->
            if (snapshot?.session?.active != true || snapshot.pendingFinish ||
                snapshot.session.exercises.none { e -> e.sets.any { it.id == setId && !it.done } }) snapshot
            else snapshot.copy(setTimers = snapshot.setTimers.orEmpty() + (setId to timer))
        }
        // The ongoing service pulses at the end of a countdown when the screen is off, so it re-reads timers.
        if (saved?.setTimers?.get(setId) == timer) WorkoutOngoingService.update(application, saved.session.name)
    }

    /** True for the one caller that ends this countdown run and should give its pulse. */
    fun claimSetTimerAlert(setId: String, startedAt: Long): Boolean = store.claimSetTimerAlert(setId, startedAt)

    fun isPaired(): Boolean = secureStore.isDevicePaired() && secureStore.pendingPairing() == null

    suspend fun refresh(): WorkoutSnapshot? = gate.withLock {
        if (!isPaired()) return@withLock store.readSnapshot()
        if (store.pendingOperations().isNotEmpty()) {
            syncLocked()
            val local = store.readSnapshot()
            if (local?.conflictOperationId != null || local?.pendingFinish == true && store.pendingOperations().isNotEmpty()) return@withLock local
        }
        val active = try {
            api.active()
        } catch (failure: ApiFailure) {
            if (failure.statusCode == 401) secureStore.clearDeviceSession()
            throw failure
        }
        adopt(active)
    }

    /** Takes the server's live workout while keeping queued edits and watch-only state (rest, current exercise). */
    private fun adopt(active: ActiveWorkoutResponse): WorkoutSnapshot? {
        val remote = active.session
        val next = store.update { local, pending ->
            val ownEdits = local != null && (pending.any { it.sessionId == local.session.id } || local.pendingFinish || local.conflictOperationId != null)
            when {
                // Edits that could not be sent stay visible until a later sync settles them.
                ownEdits && remote?.id != local?.session?.id -> local
                remote == null -> null
                local?.session?.id == remote.id -> {
                    val (restEndsAt, restGen, pausedRest) = RestSync.forAdoption(local, remote, pending, System.currentTimeMillis())

                    local.copy(
                        session = SessionProjection.project(remote, pending),
                        unit = active.unit,
                        defaultRestSeconds = active.restSeconds,
                        trackRir = active.trackRir != false,
                        activeExerciseId = local.activeExerciseId?.takeIf { id -> remote.exercises.any { it.id == id } }
                            ?: firstIncomplete(remote),
                        restEndsAtEpochMs = restEndsAt,
                        restGeneration = restGen,
                        pausedRestRemainingMs = pausedRest
                    )
                }
                else -> {
                    val (restEndsAt, restGen, pausedRest) = remoteRestState(remote.rest)

                    WorkoutSnapshot(
                        session = remote,
                        unit = active.unit,
                        defaultRestSeconds = active.restSeconds,
                        trackRir = active.trackRir != false,
                        activeExerciseId = firstIncomplete(remote),
                        restEndsAtEpochMs = restEndsAt,
                        restGeneration = restGen,
                        pausedRestRemainingMs = pausedRest
                    )
                }
            }
        }
        if (next == null) WorkoutOngoingService.stop(application)
        else if (next.session.active || next.pendingFinish) {
            if (next.restEndsAtEpochMs != null) WorkoutOngoingService.startRest(application, next.session.name)
            else WorkoutOngoingService.start(application, next.session.name)
        }
        return next
    }

    fun resumeBackgroundTracking() {
        val snapshot = store.readSnapshot() ?: return
        if (!snapshot.session.active && !snapshot.pendingFinish) return
        WorkoutOngoingService.start(application, snapshot.session.name)
    }

    suspend fun beginPairing(): PairingStart {
        val pairing = api.startPairing()
        secureStore.savePendingPairing(pairing.pairingId, pairing.code, pairing.expiresAt)
        return pairing
    }

    suspend fun pollPairing(): PairingStatus {
        val pairing = secureStore.pendingPairing() ?: throw IllegalStateException("Start pairing again on your watch.")
        val status = try {
            api.pairingStatus(pairing.first)
        } catch (gone: ApiFailure) {
            // Starting any pairing sweeps expired rows, so a code left on screen can be deleted
            // server-side (404). It can never be approved, so treat it exactly like an expired one
            // instead of polling a pairing that no longer exists.
            if (gone.statusCode != 404) throw gone
            PairingStatus("expired", pairing.third)
        }
        if (status.status == "approved") {
            secureStore.markPaired()
            secureStore.clearPendingPairing()
            scheduleSync()
        }
        if (status.status == "expired") {
            secureStore.clearDeviceSession()
            secureStore.clearPendingPairing()
        }
        return status
    }

    /** Logs reps for an ordinary set, or seconds (and no reps) for a timed hold. */
    fun logSet(exerciseId: String, setId: String, reps: Int?, displayWeight: Double?, rir: String?, durationSeconds: Int? = null) =
        retryOnRace { logSetOnce(exerciseId, setId, reps, displayWeight, rir, durationSeconds) }

    private fun logSetOnce(exerciseId: String, setId: String, reps: Int?, displayWeight: Double?, rir: String?, durationSeconds: Int?) {
        if (durationSeconds == null) require(reps != null && reps > 0) { "Enter the reps you completed." }
        else require(durationSeconds in 1..MAX_SET_SECONDS) { "Enter a time between 1 second and 2 hours." }
        require(displayWeight == null || displayWeight >= 0) { "Load cannot be negative." }
        val snapshot = requireSnapshot()
        check(snapshot.session.active && snapshot.session.pausedAt == null && !snapshot.pendingFinish) { "Resume the workout before logging a set." }
        val exercise = snapshot.session.exercises.firstOrNull { it.id == exerciseId } ?: error("This exercise is no longer in the workout.")
        val set = exercise.sets.firstOrNull { it.id == setId } ?: error("This set is no longer in the workout.")
        // Preserve canonical values when the UI submits an untouched load in display units.
        val baselineKg = set.weightKg ?: set.suggestion?.suggestedLoadKg
        val baselineDisplay = baselineKg?.let { if (snapshot.unit == "lb") it * LB_PER_KG else it }
        val weightKg = if (displayWeight != null && baselineDisplay != null && kotlin.math.abs(displayWeight - baselineDisplay) < 1e-9)
            baselineKg else displayWeight?.let { if (snapshot.unit == "lb") it / LB_PER_KG else it }
        val actualRir = RirPolicy.normalize(rir, set.warmup)
        val timed = durationSeconds != null
        val patch = SetPatch(weightKg, if (timed) null else reps, durationSeconds, RirPolicy.toRpe(actualRir), actualRir, true, set.warmup, set.resistanceMode)
        queueSetPatch(snapshot, exercise, set, patch)
    }

    /** Takes back the last set logged on this watch: it returns to the set page with its values kept. */
    fun undoLastSet() = retryOnRace { undoLastSetOnce() }

    private fun undoLastSetOnce() {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && snapshot.session.pausedAt == null && !snapshot.pendingFinish) { "Resume the workout before changing a set." }
        val setId = snapshot.lastLoggedSetId ?: error("There is no set from this watch to undo.")
        val exercise = snapshot.session.exercises.firstOrNull { row -> row.sets.any { it.id == setId } }
            ?: error("That set is no longer in the workout.")
        val set = exercise.sets.first { it.id == setId }
        check(set.done) { "That set is no longer logged." }
        queueSetPatch(snapshot, exercise, set, SetPatch(set.weightKg, set.reps, set.durationSeconds, set.rpe, set.rir, false, set.warmup, set.resistanceMode))
    }

    fun pause() = changePauseState(true)
    fun resume() = changePauseState(false)

    fun finish() = retryOnRace { finishOnce() }

    private fun finishOnce() {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && !snapshot.pendingFinish) { "This workout is already finished on the watch." }
        // WorkoutApp only saves a workout with at least one completed working set; queueing one
        // without would sit unsendable on the watch. Unlogged sets are simply left out.
        check(hasLoggedWorkingSet(snapshot.session)) { "Log at least one working set before finishing." }
        val finishedAt = workoutEventInstant(Instant.now(), snapshot.session).toString()
        val mutationId = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", mutationId)
            addProperty("finishedAt", finishedAt)
        }
        val locallyFinished = snapshot.copy(
            session = snapshot.session.copy(active = false, finishedAt = finishedAt),
            restEndsAtEpochMs = null,
            restGeneration = null,
            pausedRestRemainingMs = null,
            pendingFinish = true,
            lastLoggedSetId = null
        )
        store.enqueueIfCurrent(snapshot, locallyFinished, PendingOperation(
            sequence = 0,
            id = mutationId,
            type = "finish",
            sessionId = snapshot.session.id,
            revision = snapshot.session.revision,
            requestJson = request.toString(),
            baselineJson = gson.toJson(snapshot.session),
            createdAt = finishedAt,
            attempted = false
        ))
        WorkoutOngoingService.update(application, snapshot.session.name)
        scheduleSync()
    }

    /** The server's rest as the watch holds it; an ended or idle rest leaves nothing to count. */
    private fun remoteRestState(rest: SessionRest?): Triple<Long?, String?, Long?> = RestSync.fromServer(rest, System.currentTimeMillis())

    fun extendRest(seconds: Int = 30): WorkoutSnapshot? = retryOnRace { extendRestOnce(seconds) }

    private fun extendRestOnce(seconds: Int): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        if (!snapshot.session.active || snapshot.session.pausedAt != null || snapshot.pendingFinish || seconds <= 0) return snapshot
        val now = System.currentTimeMillis()
        val gen = UUID.randomUUID().toString()
        val mutationId = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", mutationId)
            addProperty("action", "extend")
            addProperty("seconds", seconds)
            addProperty("generation", gen)
            addProperty("originDeviceId", secureStore.deviceId())
            addProperty("occurredAt", Instant.ofEpochMilli(now).toString())
            SyncMergePolicy.addExpectedGeneration(this, snapshot.session.rest?.generation)
        }
        val next = snapshot.copy(
            restEndsAtEpochMs = (snapshot.restEndsAtEpochMs?.coerceAtLeast(now) ?: now) + seconds * 1_000L,
            restGeneration = gen,
            alertedRestGeneration = null,
            pausedRestRemainingMs = null
        )
        store.enqueueIfCurrent(snapshot, next, PendingOperation(0, mutationId, "rest", snapshot.session.id, null, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        WorkoutOngoingService.startRest(application, next.session.name)
        scheduleSync()
        return next
    }

    /** Takes time off a running rest; cutting past zero ends the rest, as the server does. */
    fun shortenRest(seconds: Int = 15): WorkoutSnapshot? = retryOnRace { shortenRestOnce(seconds) }

    private fun shortenRestOnce(seconds: Int): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        val endsAt = snapshot.restEndsAtEpochMs
        if (!snapshot.session.active || snapshot.session.pausedAt != null || snapshot.pendingFinish || seconds <= 0 || endsAt == null) return snapshot
        val now = System.currentTimeMillis()
        val shortened = RestPolicy.shortenedDeadline(endsAt, seconds, now)
        val gen = if (shortened == null) null else UUID.randomUUID().toString()
        val mutationId = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", mutationId)
            addProperty("action", "shorten")
            addProperty("seconds", seconds)
            // An ended rest carries no generation, matching the server clearing it.
            addProperty("generation", gen ?: UUID.randomUUID().toString())
            addProperty("originDeviceId", secureStore.deviceId())
            addProperty("occurredAt", Instant.ofEpochMilli(now).toString())
            SyncMergePolicy.addExpectedGeneration(this, snapshot.session.rest?.generation)
        }
        val next = snapshot.copy(
            restEndsAtEpochMs = shortened,
            restGeneration = gen,
            alertedRestGeneration = null,
            pausedRestRemainingMs = null
        )
        store.enqueueIfCurrent(snapshot, next, PendingOperation(0, mutationId, "rest", snapshot.session.id, null, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        if (shortened != null) WorkoutOngoingService.startRest(application, next.session.name)
        else WorkoutOngoingService.update(application, next.session.name)
        scheduleSync()
        return next
    }

    fun skipRest(): WorkoutSnapshot? = retryOnRace { skipRestOnce() }

    private fun skipRestOnce(): WorkoutSnapshot? {
        val snapshot = store.readSnapshot() ?: return null
        if (!snapshot.session.active || snapshot.pendingFinish) return snapshot
        // Nothing to skip: sending one would only move the workout's revision.
        if (snapshot.restEndsAtEpochMs == null && snapshot.pausedRestRemainingMs == null) return snapshot
        val gen = UUID.randomUUID().toString()
        val mutationId = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", mutationId)
            addProperty("action", "skip")
            addProperty("generation", gen)
            addProperty("originDeviceId", secureStore.deviceId())
            addProperty("occurredAt", Instant.now().toString())
            SyncMergePolicy.addExpectedGeneration(this, snapshot.session.rest?.generation)
        }
        val next = snapshot.copy(restEndsAtEpochMs = null, restGeneration = null, pausedRestRemainingMs = null, alertedRestGeneration = null)
        store.enqueueIfCurrent(snapshot, next, PendingOperation(0, mutationId, "rest", snapshot.session.id, null, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        WorkoutOngoingService.update(application, next.session.name)
        scheduleSync()
        return next
    }

    fun selectExercise(exerciseId: String) {
        store.update { snapshot, _ -> snapshot?.copy(activeExerciseId = exerciseId) }
    }

    fun clearNotice() = store.clearNotice()

    suspend fun syncPending(): SyncOutcome = gate.withLock { syncLocked() }

    private suspend fun syncLocked(): SyncOutcome {
        if (store.pendingOperations().isNotEmpty() && !isPaired()) {
            return SyncOutcome(pending = true, needsPairing = true, message = "Pair this watch again to sync saved changes.")
        }
        val outcome = sync.syncPending()
        if (outcome.sessionExpired) secureStore.clearDeviceSession()
        return outcome
    }

    suspend fun resolveConflict(keepWatchValue: Boolean) {
        gate.withLock {
            sync.resolveConflict(keepWatchValue)
            syncLocked()
        }
    }

    suspend fun disconnect() {
        check(store.pendingOperations().isEmpty()) { "Sync or review pending workout changes before disconnecting this watch." }
        // The watch stays paired until WorkoutApp has revoked its session, so a lost or offline watch
        // never leaves a live session behind; offline, the lifter is told why rather than shown a socket error.
        try {
            api.revoke()
        } catch (failure: ApiFailure) {
            if (failure.statusCode != 401) throw failure
        } catch (offline: java.io.IOException) {
            throw IllegalStateException("Connect this watch to the internet to disconnect it from WorkoutApp.", offline)
        }
        secureStore.clearToken()
        secureStore.clearPendingPairing()
        store.clearAll()
        WorkoutOngoingService.stop(application)
    }

    private fun changePauseState(pause: Boolean) = retryOnRace { changePauseStateOnce(pause) }

    private fun changePauseStateOnce(pause: Boolean) {
        val snapshot = requireSnapshot()
        check(snapshot.session.active && !snapshot.pendingFinish) { "This workout is already finished." }
        check(if (pause) snapshot.session.pausedAt == null else snapshot.session.pausedAt != null) {
            if (pause) "This workout is already paused." else "Resume is only available while the workout is paused."
        }
        val occurredAt = workoutEventInstant(Instant.now(), snapshot.session)
        val id = UUID.randomUUID().toString()
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", id)
            addProperty("occurredAt", occurredAt.toString())
        }
        val nowEpochMs = System.currentTimeMillis()
        val pausedRest = if (pause) snapshot.restEndsAtEpochMs?.let { RestTimerPolicy.remainingMs(it, nowEpochMs) } else null
        val resumedDeadline = if (pause) null else RestTimerPolicy.resumeDeadline(snapshot.pausedRestRemainingMs, nowEpochMs)
        val nextSession = if (pause) snapshot.session.copy(pausedAt = occurredAt.toString()) else snapshot.session.copy(
            pausedAt = null,
            pausedSeconds = snapshot.session.pausedSeconds + (snapshot.session.pausedAt?.let {
                ((occurredAt.toEpochMilli() - Instant.parse(it).toEpochMilli()).coerceAtLeast(0) / 1_000L)
            } ?: 0L)
        )
        val next = snapshot.copy(
            session = nextSession,
            setTimers = snapshot.setTimers.orEmpty().mapValues { (_, timer) -> if (pause) timer.pause(nowEpochMs) else timer.resume(nowEpochMs) },
            restEndsAtEpochMs = resumedDeadline,
            pausedRestRemainingMs = if (pause) pausedRest else null,
            restGeneration = if (resumedDeadline != null) UUID.randomUUID().toString() else null
        )
        store.enqueueIfCurrent(snapshot, next, PendingOperation(0, id, if (pause) "pause" else "resume", snapshot.session.id,
            revision = snapshot.session.revision, requestJson = request.toString(), baselineJson = gson.toJson(snapshot.session),
            createdAt = occurredAt.toString(), attempted = false))
        if (pause) WorkoutOngoingService.update(application, snapshot.session.name)
        else if (resumedDeadline != null) WorkoutOngoingService.startRest(application, snapshot.session.name)
        else WorkoutOngoingService.start(application, snapshot.session.name)
        scheduleSync()
    }

    private fun queueSetPatch(snapshot: WorkoutSnapshot, exercise: WorkoutExercise, set: WorkoutSet, patch: SetPatch) {
        val updated = snapshot.session.exercises.map { current ->
            if (current.id != exercise.id) current else current.copy(sets = current.sets.map { if (it.id == set.id) it.copy(
                weightKg = patch.weightKg, reps = patch.reps, durationSeconds = patch.durationSeconds, rpe = patch.rpe, rir = patch.rir, done = patch.done
            ) else it })
        }
        val nextSession = SessionProjection.withCounts(snapshot.session.copy(exercises = updated))
        val id = UUID.randomUUID().toString()
        // Only the values a lifter logs are sent; the warm-up flag and resistance mode belong to the phone.
        val request = JsonObject().apply {
            addProperty("revision", snapshot.session.revision)
            addProperty("mutationId", id)
            add("weightKg", gson.toJsonTree(patch.weightKg))
            add("reps", gson.toJsonTree(patch.reps))
            add("durationSeconds", gson.toJsonTree(patch.durationSeconds))
            add("rpe", gson.toJsonTree(patch.rpe))
            add("rir", gson.toJsonTree(patch.rir))
            addProperty("done", patch.done)
        }
        val shouldRest = patch.done && RestPolicy.shouldRestAfter(nextSession, exercise.id, set.id)
        val restSeconds = RestPolicy.restSecondsAfter(exercise, set, snapshot.defaultRestSeconds)
        val restGeneration = if (shouldRest && restSeconds > 0) UUID.randomUUID().toString() else null
        val restDeadline = if (restGeneration != null) System.currentTimeMillis() + restSeconds * 1_000L else null
        if (shouldRest && restGeneration != null) {
            val restObj = JsonObject().apply {
                addProperty("action", "start")
                addProperty("seconds", restSeconds)
                addProperty("generation", restGeneration)
                addProperty("originDeviceId", secureStore.deviceId())
                addProperty("occurredAt", Instant.now().toString())
            }
            request.add("rest", restObj)
        } else if (!patch.done && snapshot.restEndsAtEpochMs != null) {
            val restObj = JsonObject().apply {
                addProperty("action", "skip")
                addProperty("generation", UUID.randomUUID().toString())
                addProperty("originDeviceId", secureStore.deviceId())
            }
            request.add("rest", restObj)
        }
        val nextSnapshot = snapshot.copy(
            session = nextSession,
            activeExerciseId = if (patch.done) RestPolicy.nextExerciseId(nextSession, exercise.id, set.id) else exercise.id,
            restEndsAtEpochMs = restDeadline,
            restGeneration = restGeneration,
            pausedRestRemainingMs = null,
            alertedRestGeneration = null,
            lastLoggedSetId = if (patch.done) set.id else null
        )
        store.enqueueIfCurrent(snapshot, nextSnapshot, PendingOperation(0, id, "set", snapshot.session.id, set.id, snapshot.session.revision,
            request.toString(), gson.toJson(snapshot.session), Instant.now().toString(), false))
        if (restDeadline != null) WorkoutOngoingService.startRest(application, snapshot.session.name)
        else WorkoutOngoingService.update(application, snapshot.session.name)
        scheduleSync()
    }

    /**
     * A local action reads the snapshot, builds its replacement and writes it; a sync acknowledgement
     * on another thread can land in between. The store refuses that stale write and the action is
     * rebuilt from the newer snapshot, so a logged set never restores an older server revision.
     */
    private fun <T> retryOnRace(action: () -> T): T {
        repeat(MAX_RACE_RETRIES - 1) {
            try { return action() } catch (_: SnapshotChangedException) { /* rebuild from the newer snapshot */ }
        }
        return action()
    }

    private fun requireSnapshot(): WorkoutSnapshot = store.readSnapshot() ?: error("Open an active WorkoutApp session on your watch first.")

    /**
     * Each edit replaces any waiting sync, so a retry sitting in exponential backoff after a long
     * offline stretch does not hold a fresh edit back; mutation ids make an interrupted send safe.
     */
    private fun scheduleSync() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = OneTimeWorkRequestBuilder<WorkoutSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, SYNC_BACKOFF_SECONDS, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(application).enqueueUniqueWork(SYNC_WORK, ExistingWorkPolicy.REPLACE, request)
    }

    companion object {
        const val SYNC_WORK = "workout-wear-sync"
        const val LB_PER_KG = 2.2046226218
        /** Mirrors the API: one timed set lasts at most two hours. */
        const val MAX_SET_SECONDS = 7_200
        private const val SYNC_BACKOFF_SECONDS = 15L
        private const val MAX_RACE_RETRIES = 5

        @Volatile private var shared: WorkoutRepository? = null

        fun get(context: Context): WorkoutRepository = shared ?: synchronized(this) {
            shared ?: WorkoutRepository(context.applicationContext).also { shared = it }
        }

        fun hasLoggedWorkingSet(session: WorkoutSession): Boolean =
            session.exercises.any { exercise -> exercise.sets.any { it.done && !it.warmup } }

        private fun firstIncomplete(session: WorkoutSession): String? =
            session.exercises.firstOrNull { exercise -> exercise.sets.any { !it.done } }?.id
    }
}
