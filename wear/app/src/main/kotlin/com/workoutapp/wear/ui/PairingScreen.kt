package com.workoutapp.wear.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.ui.theme.Ayu

@Composable
fun PairingScreen(
    code: String?,
    expiresAt: String?,
    nowEpochMs: Long,
    busy: Boolean,
    message: String?,
    error: String?,
    onStartPairing: () -> Unit
) {
    if (code == null) {
        PairingStart(busy, message, error, onStartPairing)
    } else {
        PairingCode(code, pairingSecondsLeft(expiresAt, nowEpochMs), busy, message, error)
    }
}

@Composable
private fun PairingStart(busy: Boolean, message: String?, error: String?, onStartPairing: () -> Unit) {
    WearListScreen(
        edgeButton = {
            PrimaryEdgeButton(if (busy) "Wait…" else "Pair", onStartPairing, enabled = !busy, description = "Pair this watch with WorkoutApp")
        }
    ) { spec ->
        // An error needs the room more than the brand mark does, so the Pair action stays on the first screen.
        if (error.isNullOrBlank()) item { Box(Modifier.listRow(this, spec), contentAlignment = Alignment.Center) { BrandMark(size = 40.dp) } }
        item { ScreenTitle("Connect watch", Modifier.listRow(this, spec)) }
        item { BodyText("Pair with WorkoutApp to log sets from your wrist.", Modifier.listRow(this, spec)) }
        if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
    }
}

@Composable
private fun PairingCode(code: String, secondsLeft: Long?, checking: Boolean, message: String?, error: String?) {
    // The API only sends an expiry, so the first reading for this code is the ring's full length.
    val baseline = remember(code) { secondsLeft?.coerceAtLeast(1) }
    val target = if (secondsLeft != null && baseline != null) secondsLeft.toFloat() / baseline else 1f
    val progress by animateFloatAsState(target.coerceIn(0f, 1f), tween(1_000, easing = LinearEasing), label = "pairing-expiry")
    Box(Modifier.fillMaxSize()) {
        CircularProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxSize().padding(2.dp),
            strokeWidth = 4.dp,
            colors = ProgressIndicatorDefaults.colors(indicatorColor = Ayu.Accent, trackColor = Ayu.SurfaceRaised)
        )
        WearListScreen { spec ->
            item {
                Column(Modifier.listRow(this, spec), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("PAIRING CODE", style = MaterialTheme.typography.labelSmall, color = Ayu.Muted, letterSpacing = 1.sp)
                    PairingCodeText(code, Modifier.padding(top = 2.dp))
                    Text(
                        secondsLeft?.let { "Expires in ${formatClock(it)}" } ?: "Waiting for approval",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (secondsLeft != null && secondsLeft < 60) Ayu.Amber else Ayu.Muted
                    )
                }
            }
            item { BodyText(PAIRING_INSTRUCTION, Modifier.listRow(this, spec).padding(top = 4.dp), color = Ayu.Text) }
            item {
                BodyText(
                    if (checking) "Checking approval…" else "Approve only if this code matches your watch.",
                    Modifier.listRow(this, spec)
                )
            }
            if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec)) }
        }
    }
}
