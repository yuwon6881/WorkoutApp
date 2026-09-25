package com.workoutapp.wear.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.FilledIconButton
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Ayu

/**
 * Full-screen rest countdown. The ring drains toward the deadline persisted in the snapshot, so it
 * stays correct across recreation; each restart or +30 s gets a new generation and a full ring.
 */
@Composable
fun RestPage(
    restEndsAtEpochMs: Long,
    restGeneration: String?,
    nowEpochMs: Long,
    nextUp: NextUp?,
    busy: Boolean,
    onExtend: () -> Unit,
    onSkip: () -> Unit
) {
    val remainingMs = (restEndsAtEpochMs - nowEpochMs).coerceAtLeast(0)
    val baselineMs = remember(restGeneration, restEndsAtEpochMs) { remainingMs.coerceAtLeast(1) }
    val progress by animateFloatAsState(
        restProgress(remainingMs, baselineMs),
        tween(durationMillis = 1_000, easing = LinearEasing),
        label = "rest-ring"
    )
    val seconds = remainingSeconds(restEndsAtEpochMs, nowEpochMs)
    val finished = seconds == 0L
    ScreenScaffold {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxSize().padding(3.dp),
                strokeWidth = 6.dp,
                colors = ProgressIndicatorDefaults.colors(
                    indicatorColor = if (finished) Ayu.Green else Ayu.Accent,
                    trackColor = Ayu.SurfaceRaised
                )
            )
            Column(
                modifier = Modifier.padding(top = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    formatClock(seconds),
                    style = MaterialTheme.typography.numeralLarge,
                    color = if (finished) Ayu.Green else Ayu.Text
                )
                if (nextUp != null) {
                    Text(
                        nextUp.exerciseName,
                        modifier = Modifier.widthIn(max = 148.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = Ayu.Text,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(nextUp.detail, style = MaterialTheme.typography.labelSmall, color = Ayu.Muted, maxLines = 1)
                }
                Row(
                    modifier = Modifier.padding(top = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    FilledTonalIconButton(
                        onClick = onExtend,
                        enabled = !busy,
                        modifier = Modifier.semantics { contentDescription = "Add 30 seconds of rest" },
                        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Ayu.SurfaceHover, contentColor = Ayu.Text)
                    ) {
                        Text("+30", style = MaterialTheme.typography.labelMedium)
                    }
                    FilledIconButton(onClick = onSkip, enabled = !busy) {
                        WearIcon(
                            if (finished) R.drawable.ic_arrow_forward else R.drawable.ic_skip,
                            contentDescription = if (finished) "Continue to the next set" else "Skip rest",
                            modifier = Modifier.size(IconButtonDefaults.DefaultIconSize)
                        )
                    }
                }
            }
        }
    }
}
