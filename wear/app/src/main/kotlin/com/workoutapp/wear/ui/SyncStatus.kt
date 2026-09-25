package com.workoutapp.wear.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.ui.theme.Ayu

enum class SyncTone { Synced, Pending, Syncing, Attention }

data class SyncStatus(val tone: SyncTone, val label: String, val detail: String)

/**
 * Edits are saved on the watch first and replayed in order; this names where they stand so the
 * lifter can tell "saved here, not yet in WorkoutApp" apart from "confirmed by WorkoutApp".
 */
fun syncStatus(queuedCount: Int, pairingRequired: Boolean, syncing: Boolean): SyncStatus = when {
    queuedCount > 0 && pairingRequired -> SyncStatus(
        SyncTone.Attention,
        "Reconnect to sync",
        "${plural(queuedCount, "change")} saved on this watch"
    )
    queuedCount > 0 && syncing -> SyncStatus(SyncTone.Syncing, "Syncing…", "Sending ${plural(queuedCount, "change")}")
    queuedCount > 0 -> SyncStatus(SyncTone.Pending, "${queuedCount} to sync", "Saved on this watch")
    pairingRequired -> SyncStatus(SyncTone.Attention, "Not connected", "Pair to sync with WorkoutApp")
    else -> SyncStatus(SyncTone.Synced, "Synced", "Up to date with WorkoutApp")
}

fun SyncTone.color(): Color = when (this) {
    SyncTone.Synced -> Ayu.Green
    SyncTone.Pending -> Ayu.Amber
    SyncTone.Syncing -> Ayu.Blue
    SyncTone.Attention -> Ayu.Red
}

@Composable
fun SyncDot(tone: SyncTone, modifier: Modifier = Modifier) {
    Box(modifier.size(6.dp).background(tone.color(), CircleShape))
}

/** A compact dot-and-label line that sits under a screen title without competing with it. */
@Composable
fun SyncStatusLine(status: SyncStatus, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.semantics { contentDescription = "${status.label}. ${status.detail}" },
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        SyncDot(status.tone)
        Text(
            status.label,
            style = MaterialTheme.typography.labelSmall,
            color = if (status.tone == SyncTone.Synced) Ayu.Muted else status.tone.color(),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
