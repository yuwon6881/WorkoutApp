package com.workoutapp.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.FilledTonalButton
import androidx.wear.compose.material3.LinearProgressIndicator
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.data.WorkoutSession
import com.workoutapp.wear.ui.theme.Ayu

/** Whole-session controls: time, progress, sync, pause/resume, exercise jump list and finish. */
@Composable
fun OverviewPage(
    session: WorkoutSession,
    activeExerciseId: String,
    nowEpochMs: Long,
    sync: SyncStatus,
    queuedCount: Int,
    pendingFinish: Boolean,
    pairingRequired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    notificationsAllowed: Boolean,
    message: String?,
    error: String?,
    onPauseResume: () -> Unit,
    onFinishRequest: () -> Unit,
    onSelectExercise: (String) -> Unit,
    onRetrySync: () -> Unit,
    onStartPairing: () -> Unit,
    onDisconnectRequest: () -> Unit,
    onEnableNotifications: () -> Unit
) {
    val paused = session.pausedAt != null
    val progress = workoutProgress(session)
    WearListScreen(
        edgeButton = {
            PrimaryEdgeButton(
                if (pendingFinish) "Pending" else "Finish",
                onFinishRequest,
                enabled = !busy && !pendingFinish && session.active,
                description = if (pendingFinish) "Finish pending sync" else "Finish workout"
            )
        }
    ) { spec ->
        item {
            Column(Modifier.listRow(this, spec).padding(horizontal = topRowInset() + 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    session.name,
                    style = MaterialTheme.typography.labelMedium,
                    color = Ayu.Muted,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    elapsedWorkoutSeconds(session, nowEpochMs)?.let(::formatClock) ?: "—",
                    style = MaterialTheme.typography.numeralMedium,
                    color = if (paused) Ayu.Amber else Ayu.Text
                )
                Text(
                    if (paused) "PAUSED" else "ELAPSED",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (paused) Ayu.Amber else Ayu.Muted,
                    letterSpacing = 1.sp
                )
            }
        }
        item {
            Column(Modifier.listRow(this, spec).padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 4.dp)) {
                Text(
                    "${progress.doneSets} of ${plural(progress.plannedSets, "set")}",
                    modifier = Modifier.fillMaxWidth(),
                    style = MaterialTheme.typography.labelSmall,
                    color = Ayu.Text,
                    textAlign = TextAlign.Center
                )
                LinearProgressIndicator(
                    progress = { progress.fraction },
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                    colors = ProgressIndicatorDefaults.colors(indicatorColor = Ayu.Accent, trackColor = Ayu.SurfaceRaised)
                )
            }
        }
        item {
            FilledTonalButton(
                onClick = onPauseResume,
                enabled = !busy && session.active && !pendingFinish,
                modifier = Modifier.fillMaxWidth().listRow(this, spec),
                transformation = SurfaceTransformation(spec),
                icon = { WearIcon(if (paused) R.drawable.ic_play else R.drawable.ic_pause, null, Modifier.size(ButtonDefaults.IconSize)) },
                label = { Text(if (paused) "Resume workout" else "Pause workout") }
            )
        }
        item {
            // Without a device session a retry cannot succeed, so the reconnect prompt replaces it.
            if ((queuedCount > 0 || pendingFinish) && !pairingRequired) {
                FilledTonalButton(
                    onClick = onRetrySync,
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().listRow(this, spec),
                    transformation = SurfaceTransformation(spec),
                    icon = { WearIcon(R.drawable.ic_sync, null, Modifier.size(ButtonDefaults.IconSize), tint = sync.tone.color()) },
                    label = { Text("Sync now") },
                    secondaryLabel = { Text(sync.detail, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                )
            } else {
                Box(Modifier.listRow(this, spec), contentAlignment = Alignment.Center) { SyncStatusLine(sync) }
            }
        }
        if (pairingPromptVisible(pairingRequired, pairingCode)) item {
            PairPrompt(pairingRequired, pairingCode, pairingChecking, busy, onStartPairing, Modifier.listRow(this, spec))
        }
        if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
        item {
            ListHeader(Modifier.listRow(this, spec), transformation = SurfaceTransformation(spec)) {
                Text("Exercises", color = Ayu.Muted)
            }
        }
        session.exercises.forEach { exercise ->
            item(key = exercise.id) {
                val done = exercise.sets.count { it.done }
                val complete = exercise.sets.isNotEmpty() && done == exercise.sets.size
                val current = exercise.id == activeExerciseId
                FilledTonalButton(
                    onClick = { onSelectExercise(exercise.id) },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().listRow(this, spec),
                    transformation = SurfaceTransformation(spec),
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = if (current) Ayu.AccentContainer else Ayu.SurfaceRaised,
                        contentColor = if (current) Ayu.Accent else Ayu.Text,
                        secondaryContentColor = Ayu.Muted
                    ),
                    icon = if (complete) {
                        { WearIcon(R.drawable.ic_check, "Complete", Modifier.size(ButtonDefaults.SmallIconSize), tint = Ayu.Green) }
                    } else null,
                    label = { Text(exercise.name, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    secondaryLabel = { Text(if (current) "Now · $done of ${exercise.sets.size}" else "$done of ${plural(exercise.sets.size, "set")}") }
                )
            }
        }
        if (!notificationsAllowed) item {
            FilledTonalButton(
                onClick = onEnableNotifications,
                modifier = Modifier.fillMaxWidth().listRow(this, spec),
                transformation = SurfaceTransformation(spec),
                icon = { WearIcon(R.drawable.ic_bell, null, Modifier.size(ButtonDefaults.IconSize), tint = Ayu.Accent) },
                label = { Text("Allow notifications") },
                secondaryLabel = { Text("One-tap return from the watch face") }
            )
        }
        disconnectItem(
            spec,
            enabled = !busy && queuedCount == 0 && !pendingFinish,
            blockedBySync = queuedCount > 0 || pendingFinish,
            onClick = onDisconnectRequest
        )
    }
}
