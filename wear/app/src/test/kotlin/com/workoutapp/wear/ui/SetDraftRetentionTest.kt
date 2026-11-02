package com.workoutapp.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.wear.compose.material3.AppScaffold
import com.workoutapp.wear.ui.theme.Palette
import com.workoutapp.wear.ui.theme.WearWorkoutTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Crown edits not yet logged belong to their set, not to whichever exercise is on screen. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w227dp-h227dp-round-watch")
class SetDraftRetentionTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun `an unlogged rep edit survives a visit to another exercise`() {
        var active by mutableStateOf("bench")
        rule.setContent {
            WearWorkoutTheme {
                AppScaffold {
                    Box(Modifier.fillMaxSize().background(Palette.Background)) {
                        ActiveWorkoutScreen(
                            snapshot = FakeWorkouts.snapshot(activeExerciseId = active),
                            nowEpochMs = FakeWorkouts.now,
                            queuedCount = 0,
                            pairingRequired = false,
                            pairingCode = null,
                            pairingChecking = false,
                            busy = false,
                            notificationsAllowed = true,
                            message = null,
                            error = null,
                            onCompleteSet = { _, _, _, _ -> },
                            onSetTimerChanged = { _, _ -> },
                            onCountdownFinished = { _, _ -> false },
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
                            onEnableNotifications = {}
                        )
                    }
                }
            }
        }

        rule.onNodeWithContentDescription("reps 6").performClick()
        rule.onNodeWithContentDescription("Increase Reps").performClick()
        rule.onNodeWithContentDescription("Done").performClick()
        rule.onNodeWithContentDescription("reps 7").assertExists()

        active = "incline"
        rule.waitForIdle()
        active = "bench"
        rule.waitForIdle()

        rule.onNodeWithContentDescription("reps 7").assertExists()
    }
}
