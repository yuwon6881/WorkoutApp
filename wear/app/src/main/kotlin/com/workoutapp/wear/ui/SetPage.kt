package com.workoutapp.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Palette
import com.workoutapp.wear.ui.theme.rirColor

enum class SetField { Reps, Load, Rir, Time }

/** The values being edited for the current set; they reset whenever the set or display unit changes. */
@Stable
class SetDraft(reps: Int, load: Double?, rir: String?, seconds: Int? = null) {
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
    WearListScreen(edgeButton = { SetEdgeButton(action, busy, timerState) { onAction(action) } }) { spec ->
        item {
            Column(Modifier.listRow(this, spec).padding(horizontal = topRowInset()), horizontalAlignment = Alignment.CenterHorizontally) {
                SetBadgeRow(model, paused, pausedRestSeconds, restComplete, sync)
                Text(
                    model.exercise.name,
                    modifier = Modifier.padding(top = 3.dp),
                    style = MaterialTheme.typography.titleSmall,
                    textAlign = TextAlign.Center,
                    // Enlarged text would push the Log action below the fold; the overview keeps the full name.
                    maxLines = if (LocalDensity.current.fontScale > LARGE_TEXT_SCALE) 1 else 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (model.set == null) {
            item { BodyText("All planned sets for this exercise are logged.", Modifier.listRow(this, spec)) }
        } else {
            item {
                Row(Modifier.listRow(this, spec).padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
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
                }
            }
        }
        if (model.timed && model.set != null) {
            item { TimerToggle(draft.timing, enabled = editable, Modifier.listRow(this, spec), onToggleTimer) }
        }
        if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
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
            .heightIn(min = 50.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Palette.SurfaceRaised)
            .then(
                if (onClick == null) Modifier
                else Modifier.clickable(enabled = enabled, role = Role.Button, onClickLabel = "Adjust $name", onClick = onClick)
            )
            .semantics { contentDescription = "$name $value" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            value,
            style = MaterialTheme.typography.numeralExtraSmall,
            fontSize = if (value.length > 4) 18.sp else 22.sp,
            color = if (enabled) valueColor else Palette.Muted,
            maxLines = 1
        )
        Text(caption, style = MaterialTheme.typography.labelSmall, fontSize = 10.sp, color = Palette.Muted, maxLines = 1)
    }
}

/** Where a timed set stands, so the one edge button can start the hold, then stop and log it. */
data class TimerState(val running: Boolean, val hasTime: Boolean)

@Composable
private fun SetEdgeButton(action: SetAction, busy: Boolean, timer: TimerState?, onClick: () -> Unit) {
    val label = when (action) {
        SetAction.Log -> when {
            busy -> "Saving"
            timer?.running == true -> "Stop & log"
            timer != null && !timer.hasTime -> "Start timer"
            else -> "Log set"
        }
        SetAction.Resume -> "Resume"
        SetAction.Finish -> "Finish"
        SetAction.NextExercise -> "Next"
    }
    PrimaryEdgeButton(label, onClick, enabled = !busy)
}

@Composable
private fun SetBadgeRow(model: ActiveSetModel, paused: Boolean, pausedRestSeconds: Long?, restComplete: Boolean, sync: SyncStatus) {
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        when {
            paused -> Badge(
                pausedRestSeconds?.let { "PAUSED · REST ${formatClock(it)}" } ?: "PAUSED",
                Palette.Amber, Palette.AccentContainer
            )
            model.set == null -> Badge("ALL ${model.setCount} DONE", Palette.Green, Palette.GreenContainer)
            else -> {
                Badge(if (model.warmup) "WARM-UP" else "SET ${model.setNumber}/${model.setCount}",
                    if (model.warmup) Palette.Blue else Palette.Muted,
                    if (model.warmup) Palette.BlueContainer else Palette.SurfaceRaised)
                when {
                    // Sync trouble outranks the target, which the crown editors repeat anyway.
                    sync.tone != SyncTone.Synced -> SyncStatusLine(sync, Modifier.weight(1f, fill = false))
                    restComplete -> Badge("REST DONE", Palette.Green, Palette.GreenContainer)
                    else -> targetLine(model)?.let {
                        Text(
                            it,
                            modifier = Modifier.weight(1f, fill = false),
                            style = MaterialTheme.typography.labelSmall,
                            color = Palette.Muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
}

/** Starts or stops a timed set without logging it, for a hold taken in parts or timed before logging. */
@Composable
private fun TimerToggle(running: Boolean, enabled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        icon = { WearIcon(if (running) R.drawable.ic_pause else R.drawable.ic_play, null, Modifier.size(ButtonDefaults.IconSize)) },
        label = { Text(if (running) "Stop timer" else "Start timer", maxLines = 1) }
    )
}

@Composable
fun Badge(text: String, color: Color, container: Color) {
    Text(
        text,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(container).padding(horizontal = 7.dp, vertical = 1.dp),
        style = MaterialTheme.typography.labelSmall,
        fontSize = 10.sp,
        letterSpacing = 0.6.sp,
        color = color,
        maxLines = 1
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
    else -> unit
}

/** Longer caption for the full-screen editor, where there is room to say where the value came from. */
fun loadCaption(model: ActiveSetModel, load: Double?, unit: String): String = when {
    load == null -> "$unit · not recorded"
    model.resistanceMode == "added" -> "$unit added"
    model.resistanceMode == "assistance" -> "$unit assistance"
    model.suggestedLoad != null && load == model.suggestedLoad -> "$unit · suggested"
    else -> unit
}

private const val LARGE_TEXT_SCALE = 1.1f
