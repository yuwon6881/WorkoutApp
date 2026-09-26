package com.workoutapp.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.ui.theme.Ayu
import com.workoutapp.wear.ui.theme.rirColor

enum class SetField { Reps, Load, Rir }

/** The values being edited for the current set; they reset whenever the set or display unit changes. */
@Stable
class SetDraft(reps: Int, load: Double?, rir: String?) {
    var reps by mutableIntStateOf(reps)
    var load by mutableStateOf(load)
    var rir by mutableStateOf(rir)
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
    onAdjust: (SetField) -> Unit,
    onAction: (SetAction) -> Unit
) {
    val editable = model.set != null && !paused && !busy
    WearListScreen(edgeButton = { SetEdgeButton(action, busy) { onAction(action) } }) { spec ->
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
                    MetricTile("reps", draft.reps.toString(), "reps", editable) { onAdjust(SetField.Reps) }
                    if (model.loadEditable) {
                        MetricTile("load", draft.load?.let(::formatLoad) ?: "—", loadUnitCaption(model, unit), editable) {
                            onAdjust(SetField.Load)
                        }
                    } else if (model.resistanceMode == "bodyweight") {
                        MetricTile("bodyweight load", "BW", "body", enabled = true, onClick = null)
                    }
                    if (!model.warmup) {
                        MetricTile("RIR", draft.rir ?: "—", "RIR", editable, valueColor = rirColor(draft.rir)) {
                            onAdjust(SetField.Rir)
                        }
                    }
                }
            }
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
    valueColor: Color = Ayu.Text,
    onClick: (() -> Unit)?
) {
    Column(
        modifier = Modifier
            .weight(1f)
            .heightIn(min = 50.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Ayu.SurfaceRaised)
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
            color = if (enabled) valueColor else Ayu.Muted,
            maxLines = 1
        )
        Text(caption, style = MaterialTheme.typography.labelSmall, fontSize = 10.sp, color = Ayu.Muted, maxLines = 1)
    }
}

@Composable
private fun SetEdgeButton(action: SetAction, busy: Boolean, onClick: () -> Unit) {
    val label = when (action) {
        SetAction.Log -> if (busy) "Saving" else "Log set"
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
                Ayu.Amber, Ayu.AccentContainer
            )
            model.set == null -> Badge("ALL ${model.setCount} DONE", Ayu.Green, Ayu.GreenContainer)
            else -> {
                Badge(if (model.warmup) "WARM-UP" else "SET ${model.setNumber}/${model.setCount}",
                    if (model.warmup) Ayu.Blue else Ayu.Muted,
                    if (model.warmup) Ayu.BlueContainer else Ayu.SurfaceRaised)
                when {
                    // Sync trouble outranks the target, which the crown editors repeat anyway.
                    sync.tone != SyncTone.Synced -> SyncStatusLine(sync, Modifier.weight(1f, fill = false))
                    restComplete -> Badge("REST DONE", Ayu.Green, Ayu.GreenContainer)
                    else -> targetLine(model)?.let {
                        Text(
                            it,
                            modifier = Modifier.weight(1f, fill = false),
                            style = MaterialTheme.typography.labelSmall,
                            color = Ayu.Muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
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
