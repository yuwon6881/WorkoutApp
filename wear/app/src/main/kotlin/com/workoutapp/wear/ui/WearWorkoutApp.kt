package com.workoutapp.wear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.compose.material3.AppScaffold
import com.workoutapp.wear.data.WorkoutRepository
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.ui.theme.WearWorkoutTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun WearWorkoutApp(notificationsAllowed: Boolean, onEnableNotifications: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val repository = remember(context) { WorkoutRepository.get(context) }
    val storeState by repository.state.collectAsState()
    val notice by repository.notice.collectAsState()
    val pendingPairing = remember { repository.secureStore.pendingPairing() }
    var pairingCode by remember { mutableStateOf(pendingPairing?.second) }
    var pairingExpiry by remember { mutableStateOf(pendingPairing?.third) }
    var pairingChecking by remember { mutableStateOf(false) }
    var paired by remember { mutableStateOf(repository.isPaired()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var nowEpochMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val scope = rememberCoroutineScope()

    // busy flips before the coroutine starts, so a second tap in the same frame is ignored rather
    // than logging the set twice.
    fun runAction(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                action()
            } catch (failure: Exception) {
                error = failure.message ?: "WorkoutApp could not complete that action."
            } finally {
                paired = repository.isPaired()
                busy = false
            }
        }
    }

    fun startPairing(waitingMessage: String?) = runAction {
        val pairing = repository.beginPairing()
        pairingCode = pairing.code
        pairingExpiry = pairing.expiresAt
        if (waitingMessage != null) message = waitingMessage
    }

    LaunchedEffect(Unit) { repository.resumeBackgroundTracking() }

    // Clocks tick locally; the server is asked on resume and then on a slow cadence, faster while a
    // workout is live so sets logged or exercises changed on the phone reach the wrist.
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var nextRefreshAt = 0L
            while (true) {
                val now = System.currentTimeMillis()
                nowEpochMs = now
                paired = repository.isPaired()
                if (paired && now >= nextRefreshAt && !busy) {
                    try {
                        val refreshed = repository.refresh()
                        error = null
                        if (refreshed?.session?.active == true) message = null
                    } catch (failure: Exception) {
                        error = failure.message ?: "Could not refresh. Showing saved workout data."
                    }
                    paired = repository.isPaired()
                    val live = repository.cached()?.session?.active == true
                    nextRefreshAt = System.currentTimeMillis() + if (live) ACTIVE_REFRESH_INTERVAL_MS else IDLE_REFRESH_INTERVAL_MS
                }
                delay(1_000)
            }
        }
    }

    LaunchedEffect(pairingCode, lifecycleOwner) {
        if (pairingCode == null) return@LaunchedEffect
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                // The API allows one status check every three seconds per address; stay under it.
                delay(PAIRING_POLL_MS)
                pairingChecking = true
                try {
                    val status = repository.pollPairing()
                    if (status.status == "approved") {
                        pairingCode = null
                        pairingExpiry = null
                        paired = true
                        message = "Watch connected. Looking for an active workout."
                        repository.refresh()
                        return@repeatOnLifecycle
                    }
                    if (status.status == "expired") {
                        pairingCode = null
                        pairingExpiry = null
                        paired = false
                        message = "The code expired. Request a new one to pair this watch."
                        return@repeatOnLifecycle
                    }
                } catch (failure: Exception) {
                    error = failure.message ?: "Could not check pairing approval."
                } finally {
                    pairingChecking = false
                }
            }
        }
    }

    // Confirmations such as "Set saved on this watch." acknowledge an action; failures stay until the next one.
    LaunchedEffect(message) {
        if (message != null) {
            delay(MESSAGE_VISIBLE_MS)
            message = null
        }
    }

    // A sync notice explains something that happened out of sight, so it stays until it has been on screen.
    LaunchedEffect(notice, lifecycleOwner) {
        if (notice == null) return@LaunchedEffect
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            delay(NOTICE_VISIBLE_MS)
            repository.clearNotice()
        }
    }

    val current = storeState.snapshot
    val queuedCount = storeState.pending.size
    val shownMessage = notice ?: message
    val route = when {
        (current?.session?.active != true && current?.pendingFinish != true) && (!paired || pairingCode != null) -> Route.Pairing
        current?.conflictOperationId != null -> Route.Conflict(current)
        current?.pendingFinish == true -> Route.FinishPending
        current == null || !current.session.active -> Route.NoWorkout
        else -> Route.Active(current)
    }

    WearWorkoutTheme {
        AppScaffold {
            AnimatedContent(
                targetState = route,
                transitionSpec = { fadeIn(tween(ROUTE_FADE_MS)) togetherWith fadeOut(tween(ROUTE_FADE_MS)) },
                contentKey = { it::class },
                label = "route"
            ) { screen ->
                when (screen) {
                    Route.Pairing -> PairingScreen(
                        code = pairingCode,
                        expiresAt = pairingExpiry,
                        nowEpochMs = nowEpochMs,
                        busy = busy || pairingChecking,
                        message = shownMessage,
                        error = error,
                        onStartPairing = { startPairing("Waiting for approval in WorkoutApp.") }
                    )
                    is Route.Conflict -> ConflictReview(
                        snapshot = screen.snapshot,
                        operation = storeState.pending.firstOrNull { it.id == screen.snapshot.conflictOperationId },
                        unit = screen.snapshot.unit,
                        pairingRequired = !paired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        error = error,
                        onResolve = { keepWatch -> runAction { repository.resolveConflict(keepWatch) } },
                        onStartPairing = { startPairing(null) }
                    )
                    Route.FinishPending -> FinishPendingScreen(
                        queuedCount = queuedCount,
                        pairingRequired = !paired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        message = shownMessage,
                        error = error,
                        onSync = { runAction { repository.syncPending() } },
                        onStartPairing = { startPairing(null) },
                        onDisconnect = { runAction { repository.disconnect(); message = "Watch disconnected." } }
                    )
                    Route.NoWorkout -> NoWorkoutScreen(
                        busy = busy,
                        message = shownMessage,
                        error = error,
                        onJoin = {
                            runAction {
                                val joined = repository.refresh()
                                message = if (joined == null) "No active workout found. Start one in WorkoutApp first." else null
                            }
                        },
                        onDisconnect = { runAction { repository.disconnect(); message = "Watch disconnected." } }
                    )
                    is Route.Active -> ActiveRoute(
                        active = screen.snapshot,
                        repository = repository,
                        nowEpochMs = nowEpochMs,
                        queuedCount = queuedCount,
                        isPaired = paired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        notificationsAllowed = notificationsAllowed,
                        message = shownMessage,
                        error = error,
                        runAction = ::runAction,
                        setMessage = { message = it },
                        onStartPairing = { startPairing("Waiting for approval in WorkoutApp.") },
                        onEnableNotifications = onEnableNotifications
                    )
                }
            }
        }
    }
}

@Composable
private fun ActiveRoute(
    active: WorkoutSnapshot,
    repository: WorkoutRepository,
    nowEpochMs: Long,
    queuedCount: Int,
    isPaired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    notificationsAllowed: Boolean,
    message: String?,
    error: String?,
    runAction: (suspend () -> Unit) -> Unit,
    setMessage: (String?) -> Unit,
    onStartPairing: () -> Unit,
    onEnableNotifications: () -> Unit
) {
    ActiveWorkoutScreen(
        snapshot = active,
        nowEpochMs = nowEpochMs,
        queuedCount = queuedCount,
        pairingRequired = !isPaired,
        pairingCode = pairingCode,
        pairingChecking = pairingChecking,
        busy = busy,
        notificationsAllowed = notificationsAllowed,
        message = message,
        error = error,
        onCompleteSet = { reps, load, rir ->
            val model = activeSetModel(active)
            model.set?.let { set ->
                runAction { repository.logSet(model.exercise.id, set.id, reps, load, rir); setMessage("Set saved on this watch.") }
            }
        },
        onUndoLastSet = { runAction { repository.undoLastSet(); setMessage("Set undone. Log it again when ready.") } },
        onExtendRest = { repository.extendRest() },
        onSkipRest = { repository.skipRest() },
        onPauseResume = {
            val pausing = active.session.pausedAt == null
            runAction {
                if (pausing) repository.pause() else repository.resume()
                setMessage(if (pausing) "Workout paused on this watch." else "Workout resumed on this watch.")
            }
        },
        onFinish = { runAction { repository.finish(); setMessage("Workout finished on the watch; waiting for WorkoutApp to confirm.") } },
        onSelectExercise = repository::selectExercise,
        onRetrySync = { runAction { repository.syncPending(); setMessage("Sync checked.") } },
        onStartPairing = onStartPairing,
        onDisconnect = { runAction { repository.disconnect(); setMessage("Watch disconnected.") } },
        onEnableNotifications = onEnableNotifications
    )
}

/** Top-level destinations; each carries the snapshot it was chosen from so a fading-out screen never reads a newer, incompatible one. */
private sealed interface Route {
    data object Pairing : Route
    data class Conflict(val snapshot: WorkoutSnapshot) : Route
    data object FinishPending : Route
    data object NoWorkout : Route
    data class Active(val snapshot: WorkoutSnapshot) : Route
}

private const val ACTIVE_REFRESH_INTERVAL_MS = 15_000L
private const val IDLE_REFRESH_INTERVAL_MS = 30_000L
private const val PAIRING_POLL_MS = 4_000L
private const val MESSAGE_VISIBLE_MS = 5_000L
private const val NOTICE_VISIBLE_MS = 8_000L
private const val ROUTE_FADE_MS = 240
