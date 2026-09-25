package com.workoutapp.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.Card
import androidx.wear.compose.material3.CardDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import com.workoutapp.wear.R
import com.workoutapp.wear.data.PendingOperation
import com.workoutapp.wear.data.WorkoutSet
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.ui.theme.Ayu

@Composable
fun ConflictReview(
    snapshot: WorkoutSnapshot,
    operation: PendingOperation?,
    unit: String,
    pairingRequired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    error: String?,
    onResolve: (Boolean) -> Unit,
    onStartPairing: () -> Unit
) {
    val remote = snapshot.conflictSession
    val localSet = operation?.setId?.let { id -> snapshot.session.exercises.asSequence().flatMap { it.sets.asSequence() }.firstOrNull { it.id == id } }
    val remoteSet = operation?.setId?.let { id -> remote?.exercises?.asSequence()?.flatMap { it.sets.asSequence() }?.firstOrNull { it.id == id } }
    val finishAlreadyDone = operation?.type == "finish" && remote?.active == false
    val exerciseName = operation?.setId?.let { id -> snapshot.session.exercises.firstOrNull { row -> row.sets.any { it.id == id } }?.name }

    WearListScreen { spec ->
        item {
            Box(Modifier.listRow(this, spec), contentAlignment = Alignment.Center) {
                IconBadge(R.drawable.ic_warning, tint = Ayu.Amber, container = Ayu.AccentContainer, size = 36.dp)
            }
        }
        item { ScreenTitle("Review changes", Modifier.listRow(this, spec)) }
        item {
            BodyText(
                when {
                    finishAlreadyDone -> "WorkoutApp already finished this workout."
                    operation?.type == "finish" -> "WorkoutApp changed this workout while the watch was offline."
                    operation?.type == "set" -> "This set changed in WorkoutApp and on this watch."
                    else -> "Workout timing changed in WorkoutApp and on this watch."
                },
                Modifier.listRow(this, spec)
            )
        }
        if (localSet != null || remoteSet != null) {
            item { ComparisonCard("IN WORKOUTAPP", formatSet(remoteSet, unit), exerciseName, highlighted = false, spec = spec, scope = this) }
            item { ComparisonCard("ON THIS WATCH", formatSet(localSet, unit), exerciseName, highlighted = true, spec = spec, scope = this) }
        } else if (remote != null) {
            item {
                ComparisonCard(
                    "IN WORKOUTAPP",
                    if (remote.active) "Workout is active" else "Workout is finished",
                    "Revision ${remote.revision}",
                    highlighted = false, spec = spec, scope = this
                )
            }
            item {
                ComparisonCard(
                    "ON THIS WATCH",
                    if (snapshot.pendingFinish) "Finished here" else "Timing changed here",
                    "Revision ${snapshot.session.revision}",
                    highlighted = true, spec = spec, scope = this
                )
            }
        }
        if (pairingPromptVisible(pairingRequired, pairingCode)) item {
            PairPrompt(pairingRequired, pairingCode, pairingChecking, busy, onStartPairing, Modifier.listRow(this, spec))
        }
        item {
            Button(
                onClick = { onResolve(true) },
                enabled = !busy && !finishAlreadyDone,
                modifier = Modifier.fillMaxWidth().listRow(this, spec),
                transformation = SurfaceTransformation(spec),
                icon = { WearIcon(R.drawable.ic_watch, null, Modifier.size(ButtonDefaults.SmallIconSize)) },
                label = { Text(if (busy) "Saving…" else "Keep watch") }
            )
        }
        item {
            FilledTonalButton(
                onClick = { onResolve(false) },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().listRow(this, spec),
                transformation = SurfaceTransformation(spec),
                icon = { WearIcon(R.drawable.ic_sync, null, Modifier.size(ButtonDefaults.SmallIconSize)) },
                label = { Text("Use WorkoutApp") }
            )
        }
        if (!error.isNullOrBlank()) item { Feedback(null, error, Modifier.listRow(this, spec)) }
    }
}

/** Passive comparison card: it informs the choice below, so it is deliberately the non-clickable Card. */
@Composable
private fun ComparisonCard(
    source: String,
    value: String,
    detail: String?,
    highlighted: Boolean,
    spec: TransformationSpec,
    scope: TransformingLazyColumnItemScope
) {
    Card(
        modifier = Modifier.listRow(scope, spec),
        colors = CardDefaults.cardColors(containerColor = if (highlighted) Ayu.AccentContainer else Ayu.SurfaceRaised),
        transformation = with(scope) { SurfaceTransformation(spec) }
    ) {
        Text(source, style = MaterialTheme.typography.labelSmall, color = if (highlighted) Ayu.Accent else Ayu.Muted, letterSpacing = 1.sp)
        Text(value, style = MaterialTheme.typography.bodyMedium, color = Ayu.Text)
        if (detail != null) Text(detail, style = MaterialTheme.typography.labelSmall, color = Ayu.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private fun formatSet(set: WorkoutSet?, unit: String): String {
    if (set == null) return "Set is no longer in this workout"
    val loadText = set.weightKg?.let { "${formatLoad(kgToDisplay(it, unit))} $unit" } ?: "load not set"
    val rirText = set.rir?.let { "RIR $it" } ?: "RIR not set"
    return "${set.reps ?: "—"} reps · $loadText · $rirText"
}
