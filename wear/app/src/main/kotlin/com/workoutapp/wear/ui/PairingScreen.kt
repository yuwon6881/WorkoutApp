package com.workoutapp.wear.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.LinearProgressIndicator
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.ui.theme.Palette

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
    val failed = !error.isNullOrBlank()
    val compact = largeText()
    val allowance = timeTextAllowance()
    WearListScreen(
        edgeButton = {
            PrimaryEdgeButton(if (busy) "Wait…" else "Pair", onStartPairing, enabled = !busy, description = "Pair this watch with WorkoutApp")
        }
    ) { spec ->
        // A failure replaces the introduction (and, at large text, the title) so the explanation and the
        // Pair action share the first screen.
        if (!failed || !compact) {
            item { ScreenTitle("Pair watch", Modifier.fillMaxWidth().padding(start = topRowInset(), end = topRowInset(), top = timeTextAllowance())) }
        }
        if (!failed) item { BodyText("Log WorkoutApp sets from your wrist.", Modifier.listRow(this, spec)) }
        if (hasFeedback(message, error)) {
            item {
                val top = if (failed && compact) allowance else 0.dp
                Feedback(message, error, Modifier.listRow(this, spec).padding(start = topRowInset(), end = topRowInset(), top = top))
            }
        }
    }
}

@Composable
private fun PairingCode(code: String, secondsLeft: Long?, checking: Boolean, message: String?, error: String?) {
    // The API only sends an expiry, so the first reading for this code is the ring's full length.
    val baseline = remember(code) { secondsLeft?.coerceAtLeast(1) }
    val target = if (secondsLeft != null && baseline != null) secondsLeft.toFloat() / baseline else 1f
    val progress by animateFloatAsState(target.coerceIn(0f, 1f), tween(1_000, easing = LinearEasing), label = "pairing-expiry")
    // The expiry ring follows a round bezel; a square face would cut its text across the inscribed
    // circle, so it shows the same countdown as a bar under the expiry line instead.
    val round = LocalConfiguration.current.isScreenRound
    val ringInset = if (round) RING_CLEARANCE else 0.dp
    Box(Modifier.fillMaxSize()) {
        if (round) {
            CircularProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxSize().padding(2.dp),
                strokeWidth = 4.dp,
                colors = ProgressIndicatorDefaults.colors(indicatorColor = Palette.Accent, trackColor = Palette.SurfaceRaised)
            )
        }
        WearListScreen { spec ->
            item {
                Column(
                    Modifier.fillMaxWidth().padding(start = topRowInset(), end = topRowInset(), top = timeTextAllowance()),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Pairing code", style = MaterialTheme.typography.labelSmall, color = Palette.Muted)
                    PairingCodeText(code, Modifier.padding(top = 2.dp))
                    Text(
                        secondsLeft?.let { "Expires in ${formatClock(it)}" } ?: "Waiting for approval",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (secondsLeft != null && secondsLeft < 60) Palette.Amber else Palette.Muted
                    )
                    if (!round) {
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                            colors = ProgressIndicatorDefaults.colors(indicatorColor = Palette.Accent, trackColor = Palette.SurfaceRaised)
                        )
                    }
                }
            }
            item {
                BodyText(PAIRING_INSTRUCTION, Modifier.listRow(this, spec).padding(start = ringInset, end = ringInset, top = 4.dp), color = Palette.Text)
            }
            item {
                BodyText(
                    if (checking) "Checking approval…" else "Approve only if this code matches your watch.",
                    Modifier.listRow(this, spec).padding(horizontal = ringInset)
                )
            }
            if (hasFeedback(message, error)) item { Feedback(message, error, Modifier.listRow(this, spec).padding(horizontal = ringInset)) }
        }
    }
}

// Keeps list text inside the expiry ring (2 dp margin plus its 4 dp stroke) with a little air.
private val RING_CLEARANCE = 8.dp
