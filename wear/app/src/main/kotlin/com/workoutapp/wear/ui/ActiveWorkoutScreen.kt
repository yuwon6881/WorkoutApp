package com.workoutapp.wear.ui

import kotlinx.coroutines.delay
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.wear.compose.foundation.pager.HorizontalPager
import androidx.wear.compose.foundation.pager.rememberPagerState
import androidx.wear.compose.material3.AnimatedPage
import androidx.wear.compose.material3.HorizontalPagerScaffold
import androidx.wear.compose.material3.PagerScaffoldDefaults
import com.workoutapp.wear.data.WorkoutRepository
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.ui.theme.rirColor
import kotlinx.coroutines.launch

/**
 * The live workout as two pages: "now" (the set to log, or the rest countdown once one is running)
 * and the session overview. Crown-driven value editing and confirmations sit above both pages.
 */
@Composable
fun ActiveWorkoutScreen(
    snapshot: WorkoutSnapshot,
    nowEpochMs: Long,
    queuedCount: Int,
    pairingRequired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    notificationsAllowed: Boolean,
    message: String?,
    error: String?,
    onCompleteSet: (reps: Int?, load: Double?, rir: String?, durationSeconds: Int?) -> Unit,
    onUndoLastSet: () -> Unit,
    onExtendRest: () -> Unit,
    onShortenRest: () -> Unit,
    onSkipRest: () -> Unit,
    onPauseResume: () -> Unit,
    onFinish: () -> Unit,
    onSelectExercise: (String) -> Unit,
    onRetrySync: () -> Unit,
    onStartPairing: () -> Unit,
    onDisconnect: () -> Unit,
    onEnableNotifications: () -> Unit,
    initialPage: Int = 0
) {
    val session = snapshot.session
    val model = activeSetModel(snapshot)
    val unit = snapshot.unit
    val paused = session.pausedAt != null
    val draft = remember(model.set?.id, unit) { SetDraft(model.startingReps, model.startingLoad, model.startingRir, model.startingSeconds) }
    var adjusting by rememberSaveable(model.set?.id) { mutableStateOf<SetField?>(null) }
    var confirmFinish by rememberSaveable(session.id) { mutableStateOf(false) }
    var confirmDisconnect by rememberSaveable { mutableStateOf(false) }
    val pagerState = rememberPagerState(initialPage = initialPage) { PAGE_COUNT }
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val sync = syncStatus(queuedCount, pairingRequired, busy && queuedCount > 0)
    val restEndsAt = snapshot.restEndsAtEpochMs
    val undoableSet = if (paused) null else undoableSet(snapshot)
    val canFinish = WorkoutRepository.hasLoggedSet(session)

    val context = LocalContext.current
    // A countdown finishes itself at its target with the rest-end pulse; the draft keeps the time.
    LaunchedEffect(draft, draft.timerStartedAt, draft.timerTarget) {
        val target = draft.timerTarget ?: return@LaunchedEffect
        val endsAt = draft.countdownEndsAt() ?: return@LaunchedEffect
        delay((endsAt - System.currentTimeMillis()).coerceAtLeast(0))
        if (draft.timing && draft.timerTarget == target) {
            draft.finishCountdown()
            vibrateTimerDone(context)
        }
    }

    val onSetAction: (SetAction) -> Unit = { action ->
        when (action) {
            SetAction.Log -> {
                val now = System.currentTimeMillis()
                val load = if (model.loadEditable) draft.load else passthroughLoad(model.set, unit)
                if (!model.timed) {
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    onCompleteSet(draft.reps, load, if (model.warmup) null else draft.rir, null)
                } else if (!draft.timing && draft.seconds == null) {
                    // A timed set with no time yet: the edge button starts the hold.
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    draft.startTimer(now, model.targetSeconds)
                } else {
                    val seconds = if (draft.timing) draft.stopTimer(now) else draft.seconds
                    if (seconds != null) {
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        onCompleteSet(null, load, null, seconds)
                    }
                }
            }
            SetAction.Resume -> onPauseResume()
            SetAction.Finish -> confirmFinish = true
            SetAction.NextExercise -> nextIncompleteExercise(session, model.exercise.id)?.let { onSelectExercise(it.id) }
        }
    }

    Box(Modifier.fillMaxSize()) {
        // The indicator fades when idle so it never sits over the edge button a lifter is about to press.
        HorizontalPagerScaffold(pagerState = pagerState, pageIndicatorAnimationSpec = PagerScaffoldDefaults.FadeOutAnimationSpec) {
            HorizontalPager(state = pagerState, userScrollEnabled = adjusting == null) { page ->
                AnimatedPage(pageIndex = page, pagerState = pagerState) {
                    if (page == 0) {
                        AnimatedContent(
                            targetState = restEndsAt != null && !paused,
                            transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(160)) },
                            label = "set-or-rest"
                        ) { resting ->
                            if (resting && restEndsAt != null) {
                                RestPage(
                                    restEndsAtEpochMs = restEndsAt,
                                    restGeneration = snapshot.restGeneration,
                                    nowEpochMs = nowEpochMs,
                                    nextUp = nextUp(snapshot),
                                    busy = busy,
                                    onExtend = onExtendRest,
                                    onShorten = onShortenRest,
                                    onSkip = onSkipRest
                                )
                            } else {
                                SetPage(
                                    model = model,
                                    draft = draft,
                                    unit = unit,
                                    action = setAction(model, paused, allSetsLogged(session)),
                                    paused = paused,
                                    pausedRestSeconds = snapshot.pausedRestRemainingMs?.let { (it + 999) / 1_000 },
                                    restComplete = snapshot.alertedRestGeneration != null && restEndsAt == null,
                                    sync = sync,
                                    busy = busy,
                                    message = message,
                                    error = error,
                                    nowEpochMs = nowEpochMs,
                                    onAdjust = { adjusting = it },
                                    onToggleTimer = {
                                        val now = System.currentTimeMillis()
                                        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                                        if (draft.timing) draft.stopTimer(now) else draft.startTimer(now, model.targetSeconds)
                                    },
                                    onAction = onSetAction
                                )
                            }
                        }
                    } else {
                        OverviewPage(
                            session = session,
                            activeExerciseId = model.exercise.id,
                            nowEpochMs = nowEpochMs,
                            sync = sync,
                            queuedCount = queuedCount,
                            pendingFinish = snapshot.pendingFinish,
                            pairingRequired = pairingRequired,
                            pairingCode = pairingCode,
                            pairingChecking = pairingChecking,
                            busy = busy,
                            notificationsAllowed = notificationsAllowed,
                            message = message,
                            error = error,
                            undoableSet = undoableSet,
                            onUndoLastSet = onUndoLastSet,
                            onPauseResume = onPauseResume,
                            canFinish = canFinish,
                            onFinishRequest = { confirmFinish = true },
                            onSelectExercise = { id ->
                                onSelectExercise(id)
                                scope.launch { pagerState.animateScrollToPage(0) }
                            },
                            onRetrySync = onRetrySync,
                            onStartPairing = onStartPairing,
                            onDisconnectRequest = { confirmDisconnect = true },
                            onEnableNotifications = onEnableNotifications
                        )
                    }
                }
            }
        }
        AnimatedVisibility(
            visible = adjusting != null && model.set != null,
            enter = fadeIn(tween(160)) + scaleIn(tween(200), initialScale = 0.94f),
            exit = fadeOut(tween(120)) + scaleOut(tween(120), targetScale = 0.96f)
        ) {
            adjusting?.let { field -> SetFieldAdjuster(field, model, draft, unit) { adjusting = null } }
        }
    }

    val progress = workoutProgress(session)
    ConfirmDialog(
        visible = confirmFinish,
        title = "Finish workout?",
        text = "${progress.doneSets} of ${plural(progress.plannedSets, "set")} logged. WorkoutApp confirms the finish when the watch syncs.",
        destructive = false,
        onConfirm = { confirmFinish = false; onFinish() },
        onDismiss = { confirmFinish = false }
    )
    DisconnectDialog(confirmDisconnect, onDismiss = { confirmDisconnect = false }) {
        confirmDisconnect = false
        onDisconnect()
    }
}

@Composable
private fun SetFieldAdjuster(field: SetField, model: ActiveSetModel, draft: SetDraft, unit: String, onDone: () -> Unit) {
    when (field) {
        SetField.Reps -> ValueAdjuster(
            title = "Reps",
            value = draft.reps.toString(),
            caption = model.targetReps?.let { "Target $it" } ?: "reps",
            canDecrease = draft.reps > MIN_REPS,
            onStep = { up -> draft.reps = stepReps(draft.reps, up) },
            onDone = onDone
        )
        SetField.Load -> ValueAdjuster(
            title = model.loadLabel,
            value = draft.load?.let(::formatLoad) ?: "—",
            caption = loadCaption(model, draft.load, unit),
            canDecrease = draft.load != null,
            onStep = { up -> draft.load = stepLoad(draft.load, model.loadStep, up) },
            onDone = onDone
        )
        SetField.Rir -> ValueAdjuster(
            title = "Reps in reserve",
            value = draft.rir ?: "—",
            caption = model.targetRir?.let { "Target RIR $it" } ?: "0 = no reps left",
            canDecrease = draft.rir != "0",
            onStep = { up -> draft.rir = stepRir(draft.rir, up, model.targetRir) },
            onDone = onDone,
            valueColor = rirColor(draft.rir)
        )
        SetField.Time -> ValueAdjuster(
            title = "Time",
            value = formatSetSeconds(draft.seconds),
            caption = model.targetReps?.let { "Target $it" } ?: "min:sec",
            canDecrease = draft.seconds != null,
            onStep = { up -> draft.seconds = stepSeconds(draft.seconds, up) },
            onDone = onDone
        )
    }
}

private const val PAGE_COUNT = 2
