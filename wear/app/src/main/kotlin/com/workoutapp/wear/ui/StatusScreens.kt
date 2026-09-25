package com.workoutapp.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.OutlinedButton
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Ayu

// These screens also carry "Disconnect watch" below the fold. An edge button only appears once a list is
// scrolled to its end, so the primary action is an in-list button that is visible on the first screen.

@Composable
fun NoWorkoutScreen(
    busy: Boolean,
    message: String?,
    error: String?,
    onJoin: () -> Unit,
    onDisconnect: () -> Unit
) {
    var confirmDisconnect by rememberSaveable { mutableStateOf(false) }
    WearListScreen { spec ->
        item {
            Box(Modifier.listRow(this, spec), contentAlignment = Alignment.Center) {
                IconBadge(R.drawable.ic_workout_status, tint = Ayu.Accent, container = Ayu.AccentContainer, size = 36.dp)
            }
        }
        item { ScreenTitle("No active workout", Modifier.listRow(this, spec)) }
        item { BodyText("Start one in WorkoutApp, then join it here.", Modifier.listRow(this, spec)) }
        primaryItem(spec, if (busy) "Checking…" else "Join workout", R.drawable.ic_arrow_forward, enabled = !busy, onClick = onJoin)
        if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
        disconnectItem(spec, enabled = !busy, blockedBySync = false) { confirmDisconnect = true }
    }
    DisconnectDialog(confirmDisconnect, onDismiss = { confirmDisconnect = false }) {
        confirmDisconnect = false
        onDisconnect()
    }
}

@Composable
fun FinishPendingScreen(
    queuedCount: Int,
    pairingRequired: Boolean,
    pairingCode: String?,
    pairingChecking: Boolean,
    busy: Boolean,
    message: String?,
    error: String?,
    onSync: () -> Unit,
    onStartPairing: () -> Unit,
    onDisconnect: () -> Unit
) {
    var confirmDisconnect by rememberSaveable { mutableStateOf(false) }
    val status = syncStatus(queuedCount, pairingRequired, busy)
    WearListScreen { spec ->
        item {
            Box(Modifier.listRow(this, spec), contentAlignment = Alignment.Center) {
                IconBadge(R.drawable.ic_check, tint = Ayu.Green, container = Ayu.GreenContainer, size = 36.dp)
            }
        }
        item { ScreenTitle("Workout finished", Modifier.listRow(this, spec)) }
        item {
            Box(Modifier.listRow(this, spec).padding(vertical = 2.dp), contentAlignment = Alignment.Center) {
                SyncStatusLine(status)
            }
        }
        item { BodyText("Saved on this watch. WorkoutApp confirms it once the watch syncs.", Modifier.listRow(this, spec)) }
        if (pairingPromptVisible(pairingRequired, pairingCode)) {
            item { PairPrompt(pairingRequired, pairingCode, pairingChecking, busy, onStartPairing, Modifier.listRow(this, spec)) }
        } else {
            primaryItem(spec, if (busy) "Syncing…" else "Sync now", R.drawable.ic_sync, enabled = !busy, onClick = onSync)
        }
        if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
        disconnectItem(spec, enabled = !busy && queuedCount == 0, blockedBySync = queuedCount > 0) { confirmDisconnect = true }
    }
    DisconnectDialog(confirmDisconnect, onDismiss = { confirmDisconnect = false }) {
        confirmDisconnect = false
        onDisconnect()
    }
}

@Composable
fun DisconnectDialog(visible: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    ConfirmDialog(
        visible = visible,
        title = "Disconnect watch?",
        text = "You will need a new pairing code to use this watch again.",
        destructive = true,
        onConfirm = onConfirm,
        onDismiss = onDismiss
    )
}

private fun TransformingLazyColumnScope.primaryItem(
    spec: TransformationSpec,
    label: String,
    icon: Int,
    enabled: Boolean,
    onClick: () -> Unit
) {
    item {
        Button(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp).listRow(this, spec),
            transformation = SurfaceTransformation(spec),
            icon = { WearIcon(icon, null, Modifier.size(ButtonDefaults.IconSize)) },
            label = { Text(label, maxLines = 1) }
        )
    }
}

/** Disconnecting drops the device session, so it is refused while saved changes still need to sync. */
fun TransformingLazyColumnScope.disconnectItem(
    spec: TransformationSpec,
    enabled: Boolean,
    blockedBySync: Boolean,
    onClick: () -> Unit
) {
    item {
        OutlinedButton(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp).listRow(this, spec),
            transformation = SurfaceTransformation(spec),
            icon = { WearIcon(R.drawable.ic_logout, null, Modifier.size(ButtonDefaults.SmallIconSize), tint = if (enabled) Ayu.Red else Ayu.Faint) },
            label = { Text(if (blockedBySync) "Sync before disconnecting" else "Disconnect watch", color = if (enabled) Ayu.Red else Ayu.Faint) }
        )
    }
}
