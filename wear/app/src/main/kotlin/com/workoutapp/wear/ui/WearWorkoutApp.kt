package com.workoutapp.wear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
    val repository = remember(context) { WorkoutRepository(context) }
    val pendingPairing = remember { repository.secureStore.pendingPairing() }
    var snapshot by remember { mutableStateOf(repository.cached()) }
    var pairingCode by remember { mutableStateOf(pendingPairing?.second) }
    var pairingExpiry by remember { mutableStateOf(pendingPairing?.third) }
    var pairingChecking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var nowEpochMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val scope = rememberCoroutineScope()

    fun runAction(action: suspend () -> Unit) {
        scope.launch {
            busy = true
            error = null
            try {
                action()
                snapshot = repository.cached()
            } catch (failure: Exception) {
                error = failure.message ?: "WorkoutApp could not complete that action."
                snapshot = repository.cached()
            } finally {
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

    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            var refreshOnResume = true
            var nextIdleRefreshAt = 0L
            while (true) {
                val now = System.currentTimeMillis()
                nowEpochMs = now
                val cached = repository.cached()
                val paired = repository.secureStore.isDevicePaired() && repository.secureStore.pendingPairing() == null
                val idle = cached?.session?.active != true && cached?.pendingFinish != true
                if (paired && (refreshOnResume || idle && now >= nextIdleRefreshAt)) {
                    try {
                        snapshot = repository.refresh()
                        error = null
                        if (snapshot?.session?.active == true) message = null
                    } catch (failure: Exception) {
                        error = failure.message ?: "Could not refresh. Showing saved workout data."
                        snapshot = repository.cached()
                    }
                    nextIdleRefreshAt = now + IDLE_WORKOUT_REFRESH_INTERVAL_MS
                } else {
                    snapshot = cached
                }
                refreshOnResume = false
                delay(1_000)
            }
        }
    }

    LaunchedEffect(pairingCode, lifecycleOwner) {
        if (pairingCode == null) return@LaunchedEffect
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                delay(3_000)
                pairingChecking = true
                try {
                    val status = repository.pollPairing()
                    if (status.status == "approved") {
                        pairingCode = null
                        pairingExpiry = null
                        message = "Watch connected. Looking for an active workout."
                        snapshot = repository.refresh()
                        return@repeatOnLifecycle
                    }
                    if (status.status == "expired") {
                        pairingCode = null
                        pairingExpiry = null
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

    val isPaired = repository.secureStore.isDevicePaired() && repository.secureStore.pendingPairing() == null
    val current = snapshot
    val route = when {
        (current?.session?.active != true && current?.pendingFinish != true) && (!isPaired || pairingCode != null) -> Route.Pairing
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
                        message = message,
                        error = error,
                        onStartPairing = { startPairing("Waiting for approval in WorkoutApp.") }
                    )
                    is Route.Conflict -> ConflictReview(
                        snapshot = screen.snapshot,
                        operation = repository.store.pendingOperations().firstOrNull { it.id == screen.snapshot.conflictOperationId },
                        unit = screen.snapshot.unit,
                        pairingRequired = !isPaired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        error = error,
                        onResolve = { keepWatch -> runAction { repository.resolveConflict(keepWatch) } },
                        onStartPairing = { startPairing(null) }
                    )
                    Route.FinishPending -> FinishPendingScreen(
                        queuedCount = repository.store.pendingOperations().size,
                        pairingRequired = !isPaired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        message = message,
                        error = error,
                        onSync = { runAction { repository.syncPending() } },
                        onStartPairing = { startPairing(null) },
                        onDisconnect = { runAction { repository.disconnect(); message = "Watch disconnected." } }
                    )
                    Route.NoWorkout -> NoWorkoutScreen(
                        busy = busy,
                        message = message,
                        error = error,
                        onJoin = {
                            runAction {
                                snapshot = repository.refresh()
                                message = if (snapshot == null) "No active workout found. Start one in WorkoutApp first." else null
                            }
                        },
                        onDisconnect = { runAction { repository.disconnect(); message = "Watch disconnected." } }
                    )
                    is Route.Active -> ActiveRoute(
                        active = screen.snapshot,
                        repository = repository,
                        nowEpochMs = nowEpochMs,
                        isPaired = isPaired,
                        pairingCode = pairingCode,
                        pairingChecking = pairingChecking,
                        busy = busy,
                        notificationsAllowed = notificationsAllowed,
                        message = message,
                        error = error,
                        runAction = ::runAction,
                        setMessage = { message = it },
                        setSnapshot = { snapshot = it },
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
    isPaired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    notificationsAllowed: Boolean,
    message: String?,
    error: String?,
    runAction: (suspend () -> Unit) -> Unit,
    setMessage: (String?) -> Unit,
    setSnapshot: (WorkoutSnapshot?) -> Unit,
    onStartPairing: () -> Unit,
    onEnableNotifications: () -> Unit
) {
    ActiveWorkoutScreen(
        snapshot = active,
        nowEpochMs = nowEpochMs,
        queuedCount = repository.store.pendingOperations().size,
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
        onExtendRest = { runAction { setSnapshot(repository.extendRest()) } },
        onSkipRest = { runAction { setSnapshot(repository.skipRest()) } },
        onPauseResume = {
            runAction {
                if (active.session.pausedAt == null) repository.pause() else repository.resume()
                setMessage(if (active.session.pausedAt == null) "Workout paused on this watch." else "Workout resumed on this watch.")
            }
        },
        onFinish = { runAction { repository.finish(); setMessage("Workout finished on the watch; waiting for WorkoutApp to confirm.") } },
        onSelectExercise = { id ->
            val next = active.copy(activeExerciseId = id)
            repository.store.saveSnapshot(next)
            setSnapshot(next)
        },
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

private const val IDLE_WORKOUT_REFRESH_INTERVAL_MS = 15_000L
private const val MESSAGE_VISIBLE_MS = 5_000L
private const val ROUTE_FADE_MS = 240
