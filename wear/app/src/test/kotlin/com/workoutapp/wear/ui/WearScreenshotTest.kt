package com.workoutapp.wear.ui

import androidx.compose.runtime.Composable
import com.workoutapp.wear.data.SetTimerSnapshot
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.ui.FakeWorkouts.now
import com.workoutapp.wear.ui.FakeWorkouts.snapshot
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders every screen state on small round, large round and square watches. It proves each state
 * composes with realistic data, and the PNGs under build/wear-shots are the visual review surface.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class WearScreenshotTest {

    // One test for every device: Compose binds its frame clock to the first test's Choreographer, so
    // later Robolectric tests in the same JVM would never run entrance animations to completion.
    @Test
    fun rendersEveryScreenStateOnEveryWatch() {
        WATCH_DEVICES.forEach { device ->
            screens().forEach { (name, content) ->
                val file = renderScreen(device, name, content = content)
                assertTrue("$name was not written for ${device.id}", file.length() > 0)
            }
        }
    }

    private fun screens(): List<Pair<String, @Composable () -> Unit>> = listOf(
        "01-pairing-start" to { PairingScreen(null, null, now, false, null, null) {} },
        "02-pairing-code" to { PairingScreen("K7QM2XRP", "2026-09-25T10:36:47Z", now, false, null, null) {} },
        "03-pairing-error" to { PairingScreen(null, null, now, false, null, "WorkoutApp is unreachable. Check the watch's connection and try again.") {} },
        "04-no-workout" to { NoWorkoutScreen(false, null, null, {}, {}) },
        "05-active-set" to { Active(snapshot()) },
        "06-active-set-warmup" to { Active(snapshot(session = FakeWorkouts.warmupFirst)) },
        "07-active-set-unknown-load-pending" to { Active(snapshot(activeExerciseId = "lateral"), queued = 3) },
        "08-active-set-bodyweight" to { Active(snapshot(activeExerciseId = "dips"), unit = "lb") },
        "09-adjust-load" to {
            ValueAdjuster("Load", "82.5", "kg · suggested", canDecrease = true, onStep = {}, onDone = {})
        },
        "09b-adjust-rir" to {
            ValueAdjuster("RIR", "1", "Target RIR 1", canDecrease = true, onStep = {}, onDone = {}, valueColor = com.workoutapp.wear.ui.theme.rirColor("1"))
        },
        "10-rest-countdown" to { Active(snapshot(restEndsAtEpochMs = now + 88_000)) },
        "11-rest-done" to { Active(snapshot(restEndsAtEpochMs = now - 500)) },
        "12-overview" to { Active(snapshot(), page = 1) },
        "12b-overview-undo" to { Active(snapshot().copy(lastLoggedSetId = FakeWorkouts.bench.sets[1].id), page = 1) },
        "12c-overview-nothing-logged" to { Active(snapshot(session = FakeWorkouts.nothingLogged), page = 1) },
        "13-overview-paused-pending" to { Active(snapshot(session = FakeWorkouts.paused), queued = 2, page = 1) },
        "14-overview-reconnect" to { Active(snapshot(), queued = 4, pairingRequired = true, page = 1, notifications = false) },
        "15-set-paused" to { Active(snapshot(session = FakeWorkouts.paused, pausedRestRemainingMs = 45_000)) },
        "16-set-error" to { Active(snapshot(), error = "WorkoutApp could not complete that action.") },
        "17-all-logged" to { Active(snapshot(session = FakeWorkouts.allDone)) },
        "18-finish-confirm" to {
            ConfirmDialog(true, "Finish workout?", finishConfirmationMessage(1, 13), false, {}, {})
        },
        "19-finish-pending" to { FinishPendingScreen(2, false, null, false, false, null, null, {}, {}, {}) },
        "20-finish-pending-reconnect" to { FinishPendingScreen(2, true, "K7QM2XRP", false, false, null, null, {}, {}, {}) },
        "21-conflict-set" to {
            val operation = FakeWorkouts.operation("set", FakeWorkouts.bench.sets[1].id)
            val conflicted = snapshot(conflictOperationId = operation.id, conflictSession = FakeWorkouts.conflictingSetSession())
            ConflictReview(conflicted, operation, "kg", false, null, false, false, null, {}, {})
        },
        "22-conflict-finish" to {
            val operation = FakeWorkouts.operation("finish")
            val conflicted = snapshot(pendingFinish = true, conflictOperationId = operation.id, conflictSession = FakeWorkouts.session.copy(revision = 9))
            ConflictReview(conflicted, operation, "kg", false, null, false, false, null, {}, {})
        },
        "23-disconnect-confirm" to {
            ConfirmDialog(true, "Disconnect watch?", "You will need a new pairing code to use this watch again.", true, {}, {})
        },
        "24-active-set-timed-countdown" to { Active(snapshot(activeExerciseId = "plank")) },
        "24b-active-set-timed-countdown-running" to {
            val timerNow = System.currentTimeMillis()
            Active(snapshot(activeExerciseId = "plank", setTimers = mapOf("plank-0" to SetTimerSnapshot(startedAt = timerNow - 15_000, targetSeconds = 45))), timerNow = timerNow)
        },
        "25-active-set-timed-countup" to { Active(snapshot(activeExerciseId = "hang")) },
        "25b-active-set-timed-countup-running" to {
            val timerNow = System.currentTimeMillis()
            Active(snapshot(activeExerciseId = "hang", setTimers = mapOf("hang-0" to SetTimerSnapshot(startedAt = timerNow - 25_000, targetSeconds = null))), timerNow = timerNow)
        },
        "26-active-set-rir-off" to { Active(snapshot(trackRir = false)) },
        "27-active-set-long-title" to { Active(snapshot(activeExerciseId = "long-name")) },
        "28-active-set-weighted" to { Active(snapshot(activeExerciseId = "pullups")) },
        "29-active-set-assisted" to { Active(snapshot(activeExerciseId = "assisted-dips")) },
        "30-adjust-reps" to {
            ValueAdjuster("Reps", "8", "Target 6–8", canDecrease = true, onStep = {}, onDone = {})
        },
        "31-adjust-seconds" to {
            ValueAdjuster("Time", "0:45", "Target 45 sec", canDecrease = true, onStep = {}, onDone = {})
        }
    )

    @Composable
    private fun Active(
        snapshot: WorkoutSnapshot,
        queued: Int = 0,
        pairingRequired: Boolean = false,
        page: Int = 0,
        unit: String? = null,
        error: String? = null,
        notifications: Boolean = true,
        timerNow: Long = now
    ) {
        ActiveWorkoutScreen(
            snapshot = unit?.let { snapshot.copy(unit = it) } ?: snapshot,
            nowEpochMs = timerNow,
            queuedCount = queued,
            pairingRequired = pairingRequired,
            pairingCode = null,
            pairingChecking = false,
            busy = false,
            notificationsAllowed = notifications,
            message = null,
            error = error,
            onCompleteSet = { _, _, _, _ -> },
            onSetTimerChanged = { _, _ -> },
            onUndoLastSet = {},
            onExtendRest = {},
            onShortenRest = {},
            onSkipRest = {},
            onPauseResume = {},
            onFinish = {},
            onSelectExercise = {},
            onRetrySync = {},
            onStartPairing = {},
            onDisconnect = {},
            onEnableNotifications = {},
            initialPage = page
        )
    }
}
