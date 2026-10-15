package com.workoutapp.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffoldDefaults
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Palette
import com.workoutapp.wear.ui.theme.rirColor

enum class SetField { Reps, Load, Rir, Time }

/** The values being edited for the current set; they reset whenever the set or display unit changes. */
@Stable
class SetDraft(reps: Int, load: Double?, rir: String?, seconds: Int? = null) {
    private var sourceReps = reps
    private var sourceLoad = load
    private var sourceRir = rir
    private var sourceSeconds = seconds
    var reps by mutableIntStateOf(reps)
    var load by mutableStateOf(load)
    var rir by mutableStateOf(rir)
    var seconds by mutableStateOf(seconds)
    /** When the set's stopwatch started; the count is derived from it so a dimmed screen loses nothing. */
    var timerStartedAt by mutableStateOf<Long?>(null)
        private set
    /** Seconds a countdown runs to; null counts up until stopped. */
    var timerTarget by mutableStateOf<Int?>(null)
        private set
    private var timerBase = 0
    private var timerPausedAt by mutableStateOf<Long?>(null)
    val timing: Boolean get() = timerStartedAt != null

    /** Remote edits refresh untouched fields; locally adjusted values and running timers stay. */
    fun reconcile(model: ActiveSetModel) {
        if (reps == sourceReps) reps = model.startingReps
        if (load == sourceLoad) load = model.startingLoad
        if (rir == sourceRir) rir = model.startingRir
        if (!timing && seconds == sourceSeconds) seconds = model.startingSeconds
        sourceReps = model.startingReps
        sourceLoad = model.startingLoad
        sourceRir = model.startingRir
        sourceSeconds = model.startingSeconds
    }

    fun loadForSubmission(model: ActiveSetModel, unit: String): Double? {
        if (!model.loadEditable) return passthroughLoad(model.set, unit)
        if (load != sourceLoad) return load
        return (model.set?.weightKg ?: model.set?.suggestion?.suggestedLoadKg)?.let { kgToDisplay(it, unit) }
    }

    fun secondsAt(nowEpochMs: Long): Int? = timerStartedAt?.let { stopwatchSeconds(timerBase, it, timerPausedAt ?: nowEpochMs, timerTarget) } ?: seconds

    fun restoreTimer(timer: com.workoutapp.wear.data.SetTimerSnapshot?) {
        if (timer == null) return
        timerStartedAt = timer.startedAt
        timerBase = timer.baseSeconds
        timerTarget = timer.targetSeconds
        timerPausedAt = timer.pausedAt
        seconds = timer.stoppedSeconds
    }

    fun snapshotTimer() = com.workoutapp.wear.data.SetTimerSnapshot(timerStartedAt, timerBase, timerTarget, seconds, timerPausedAt)

    /** Time left on a running countdown, or null when counting up or stopped. */
    fun remainingAt(nowEpochMs: Long): Int? = timerTarget?.let { target -> secondsAt(nowEpochMs)?.let { target - it } }?.takeIf { timing }

    /**
     * Counts down to a target, or up without one. A partial hold continues; a set already at its
     * target starts a fresh attempt.
     */
    fun startTimer(nowEpochMs: Long, targetSeconds: Int? = null) {
        val entered = seconds ?: 0
        timerBase = if (targetSeconds != null && entered >= targetSeconds) 0 else entered
        timerTarget = targetSeconds
        timerStartedAt = nowEpochMs
        timerPausedAt = null
    }

    /** When a running countdown reaches its target. */
    fun countdownEndsAt(): Long? = if (timerPausedAt != null) null else timerStartedAt?.let { started -> timerTarget?.let { started + (it - timerBase) * 1_000L } }

    /** A countdown reached its target: it stops with the target recorded. */
    fun finishCountdown() {
        val target = timerTarget ?: return
        if (!timing) return
        timerStartedAt = null
        seconds = target
    }

    fun stopTimer(nowEpochMs: Long): Int? {
        val reached = secondsAt(nowEpochMs)
        timerStartedAt = null
        seconds = reached?.takeIf { it > 0 }
        return seconds
    }
}

sealed interface SetAction {
    data object Log : SetAction
    data object Resume : SetAction
    data object NextExercise : SetAction
    data object Finish : SetAction
}

fun setAction(model: ActiveSetModel, paused: Boolean, allLogged: Boolean): SetAction = when {
    paused -> SetAction.Resume
    model.set != null -> SetAction.Log
    allLogged -> SetAction.Finish
    else -> SetAction.NextExercise
}

/**
 * The glanceable "now" page: what to do, the values that will be logged, and one Log action that
 * fits on the first screen. Each value opens the crown editor rather than crowding the round face.
 */
@Composable
fun SetPage(
    model: ActiveSetModel,
    draft: SetDraft,
    unit: String,
    action: SetAction,
    paused: Boolean,
    pausedRestSeconds: Long?,
    restComplete: Boolean,
    sync: SyncStatus,
    busy: Boolean,
    message: String?,
    error: String?,
    nowEpochMs: Long,
    onAdjust: (SetField) -> Unit,
    onToggleTimer: () -> Unit,
    onAction: (SetAction) -> Unit
) {
    val editable = model.set != null && !paused && !busy
    val timerState = if (model.timed) TimerState(draft.timing, draft.secondsAt(nowEpochMs) != null) else null
    // With large text or on a short face the page only fits above the Log action without a separate
    // feedback row, so the message briefly replaces the badge row; the overview still shows it in full.
    val compactFeedback = largeText() || LocalConfiguration.current.screenHeightDp < SHORT_FACE_DP
    WearListScreen(
        edgeButton = { SetEdgeButton(action, busy, timerState) { onAction(action) } },
        edgeButtonSpacing = ScreenScaffoldDefaults.EdgeButtonMinSpacing
    ) { spec ->
        item {
            Column(
                // Not height-morphed: this row sits in the top transition area, where morphing clipped its edges.
                Modifier.fillMaxWidth().padding(start = topRowInset(), end = topRowInset(), top = timeTextAllowance()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                SetBadgeRow(
                    model, paused, pausedRestSeconds, restComplete, sync,
                    feedback = if (compactFeedback) inlineFeedback(message, error) else null
                )
                Text(
                    model.exercise.name,
                    modifier = Modifier
                        .padding(top = 2.dp)
                        .semantics { contentDescription = model.exercise.name },
                    style = MaterialTheme.typography.titleSmall.let { it.copy(lineHeight = it.fontSize * 1.2f) },
                    textAlign = TextAlign.Center,
                    // Enlarged text would push the Log action below the fold; the overview keeps the full name.
                    maxLines = if (largeText()) 1 else 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (model.set == null) {
            item { BodyText("All planned sets for this exercise are logged.", Modifier.listRow(this, spec)) }
        } else {
            item {
                Row(
                    Modifier.listRow(this, spec),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (model.timed) {
                        val remaining = draft.remainingAt(nowEpochMs)
                        val shown = remaining ?: draft.secondsAt(nowEpochMs)
                        MetricTile(
                            "time",
                            formatSetSeconds(shown ?: model.targetSeconds),
                            when {
                                remaining != null -> "left"
                                draft.timing -> "timing"
                                shown == null && model.targetSeconds != null -> "target"
                                else -> "time"
                            },
                            editable && !draft.timing,
                            valueColor = if (draft.timing) Palette.Accent else if (shown == null) Palette.Muted else Palette.Text
                        ) { onAdjust(SetField.Time) }
                    } else {
                        MetricTile("reps", draft.reps.toString(), "reps", editable) { onAdjust(SetField.Reps) }
                    }
                    if (model.loadEditable) {
                        MetricTile("load", draft.load?.let(::formatLoad) ?: "—", loadUnitCaption(model, unit), editable) {
                            onAdjust(SetField.Load)
                        }
                    } else if (model.resistanceMode == "bodyweight") {
                        MetricTile("bodyweight load", "BW", "body", enabled = true, onClick = null)
                    }
                    if (!model.warmup && !model.timed && model.trackRir) {
                        MetricTile("RIR", draft.rir ?: "—", "RIR", editable, valueColor = rirColor(draft.rir)) {
                            onAdjust(SetField.Rir)
                        }
                    }
                    // A timed set has no RIR, so its free slot holds the start/stop control beside the time.
                    if (model.timed) TimerToggle(draft.timing, enabled = editable, onClick = onToggleTimer)
                }
            }
        }
        if (!compactFeedback && hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
    }
}

/** A value summary; when editable the whole tile is the touch target for its crown editor. */
@Composable
private fun RowScope.MetricTile(
    name: String,
    value: String,
    caption: String,
    enabled: Boolean,
    valueColor: Color = Palette.Text,
    onClick: (() -> Unit)?
) {
    Column(
        modifier = Modifier
            .weight(1f)
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.SurfaceRaised)
            .then(
                if (onClick == null) Modifier
                else Modifier.clickable(enabled = enabled, role = Role.Button, onClickLabel = "Adjust $name", onClick = onClick)
            )
            .padding(horizontal = 2.dp, vertical = 1.dp)
            .semantics { contentDescription = "$name $value" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        val tunedFontSize = when {
            value.length > 4 -> 14.sp
            value.length > 3 -> 16.sp
            value.length > 2 -> 18.sp
            else -> 20.sp
        }
        // Line heights hug the glyphs so the tile stays one touch target tall at large text sizes.
        Text(
            value,
            style = MaterialTheme.typography.numeralExtraSmall.copy(fontSize = tunedFontSize, lineHeight = tunedFontSize * 1.1f),
            color = if (enabled) valueColor else Palette.Muted,
            maxLines = 1
        )
        Text(caption, style = MaterialTheme.typography.labelSmall, fontSize = 10.sp, lineHeight = 12.sp, color = Palette.Muted, maxLines = 1)
    }
}

/** Where a timed set stands, so the one edge button can start the hold, then stop and log it. */
data class TimerState(val running: Boolean, val hasTime: Boolean)

@Composable
private fun SetEdgeButton(action: SetAction, busy: Boolean, timer: TimerState?, onClick: () -> Unit) {
    // At large text the small edge button holds about eight characters, so the timed labels shorten;
    // the button still announces the full action.
    val short = largeText()
    val label = when (action) {
        SetAction.Log -> when {
            busy -> "Saving"
            timer?.running == true -> if (short) "Log time" else "Stop & log"
            timer != null && !timer.hasTime -> if (short) "Start" else "Start timer"
            else -> "Log set"
        }
        SetAction.Resume -> "Resume"
        SetAction.Finish -> "Finish"
        SetAction.NextExercise -> "Next"
    }
    val description = when {
        busy -> label
        action == SetAction.Log && timer?.running == true -> "Stop timer and log set"
        action == SetAction.Log && timer != null && !timer.hasTime -> "Start timer"
        else -> label
    }
    PrimaryEdgeButton(label, onClick, enabled = !busy, description = description)
}

/** Feedback squeezed into the badge row: its text, and whether it reports a failure. */
private data class InlineFeedback(val text: String, val error: Boolean)

private fun inlineFeedback(message: String?, error: String?): InlineFeedback? = when {
    !error.isNullOrBlank() -> InlineFeedback(error, error = true)
    !message.isNullOrBlank() -> InlineFeedback(message, error = false)
    else -> null
}

@Composable
private fun SetBadgeRow(
    model: ActiveSetModel,
    paused: Boolean,
    pausedRestSeconds: Long?,
    restComplete: Boolean,
    sync: SyncStatus,
    feedback: InlineFeedback?
) {
    Row(
        modifier = Modifier.widthIn(max = underClockMaxWidth()),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        when {
            // Feedback is short-lived and takes the whole row so as much of it as possible shows.
            feedback != null -> BadgeRowText(feedback.text, if (feedback.error) Palette.Red else Palette.Muted)
            paused -> {
                Badge("Paused", Palette.Amber, Palette.SurfaceRaised)
                // The frozen rest is trailing text so a narrow row shortens it rather than the state.
                pausedRestSeconds?.let { BadgeRowText("Rest ${formatClock(it)}", Palette.Amber, small = true) }
            }
            model.set == null -> Badge("All ${model.setCount} done", Palette.Teal, Palette.TealContainer)
            else -> {
                Badge(if (model.warmup) "Warm-up" else "Set ${model.setNumber}/${model.setCount}",
                    if (model.warmup) Palette.Blue else Palette.Muted,
                    if (model.warmup) Palette.BlueContainer else Palette.SurfaceRaised)
                when {
                    // Sync trouble outranks the target, which the crown editors repeat anyway.
                    sync.tone != SyncTone.Synced -> SyncStatusLine(sync, Modifier.weight(1f, fill = false))
                    restComplete -> Badge("Rest done", Palette.Teal, Palette.TealContainer)
                    else -> targetLine(model)?.let { BadgeRowText(it, Palette.Muted) }
                }
            }
        }
    }
}

// "Small" matches the pills beside it, for a short value that must not be ellipsized away.
@Composable
private fun RowScope.BadgeRowText(text: String, color: Color, small: Boolean = false) {
    Text(
        text,
        modifier = Modifier.weight(1f, fill = false).semantics { contentDescription = text },
        style = MaterialTheme.typography.labelSmall.let { if (small) it.copy(fontSize = 10.sp, lineHeight = 13.sp) else it },
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

/** Starts or stops a timed set without logging it, for a hold taken in parts or timed before logging. */
@Composable
private fun TimerToggle(running: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val label = if (running) "Stop timer" else "Start timer"
    FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(48.dp).semantics { contentDescription = label },
        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Palette.SurfaceRaised, contentColor = Palette.Text)
    ) {
        WearIcon(if (running) R.drawable.ic_pause else R.drawable.ic_play, null, Modifier.size(IconButtonDefaults.SmallIconSize))
    }
}

@Composable
fun Badge(text: String, color: Color, container: Color) {
    Text(
        text,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(container).padding(horizontal = 7.dp, vertical = 1.dp),
        style = MaterialTheme.typography.labelSmall,
        fontSize = 10.sp,
        lineHeight = 13.sp,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis
    )
}

fun targetLine(model: ActiveSetModel): String? {
    val parts = listOfNotNull(
        model.targetReps,
        model.targetRir?.takeIf { !model.warmup }?.let { "RIR $it" }
    )
    return if (parts.isEmpty()) null else parts.joinToString(" · ")
}

/** Short tile caption: the unit, qualified only when the number means something other than total load. */
fun loadUnitCaption(model: ActiveSetModel, unit: String): String = when (model.resistanceMode) {
    "added" -> "+$unit"
    "assistance" -> "−$unit"
    else -> if (model.exercise.weightBasis == "per_side") "$unit/side" else unit
}

/** Longer caption for the full-screen editor, where there is room to say where the value came from. */
fun loadCaption(model: ActiveSetModel, load: Double?, unit: String): String = when {
    load == null -> "${loadUnitCaption(model, unit)} · not recorded"
    model.resistanceMode == "added" -> "$unit added"
    model.resistanceMode == "assistance" -> "$unit assistance"
    model.suggestedLoad != null && load == model.suggestedLoad -> "${loadUnitCaption(model, unit)} · suggested"
    else -> loadUnitCaption(model, unit)
}

// Below this height (a 180 dp square face) a feedback row would push the Log action off the first screen.
private const val SHORT_FACE_DP = 190
