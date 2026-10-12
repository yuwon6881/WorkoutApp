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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ProgressIndicatorDefaults
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Palette

/**
 * Full-screen rest countdown. The ring drains toward the deadline persisted in the snapshot, so it
 * stays correct across recreation; each restart or ±15 s gets a new generation and a full ring.
 */
@Composable
fun RestPage(
    restEndsAtEpochMs: Long,
    restGeneration: String?,
    nowEpochMs: Long,
    nextUp: NextUp?,
    busy: Boolean,
    onExtend: () -> Unit,
    onShorten: () -> Unit,
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
    val config = LocalConfiguration.current
    val compact = config.screenWidthDp < COMPACT_WATCH_DP
    val shortScreen = config.screenHeightDp <= SHORT_WATCH_DP
    val topPadding = when {
        shortScreen -> 23.dp
        config.isScreenRound -> 20.dp
        else -> 16.dp
    }
    val clockStyle = MaterialTheme.typography.numeralMedium.copy(
        fontSize = when {
            shortScreen -> 20.sp
            compact -> 28.sp
            else -> 40.sp
        },
        lineHeight = when {
            shortScreen -> 20.sp
            compact -> 32.sp
            else -> 44.sp
        }
    )
    val contextStyle = MaterialTheme.typography.labelSmall.copy(
        fontSize = if (shortScreen) 11.sp else 12.sp,
        lineHeight = if (shortScreen) 12.sp else 14.sp
    )
    val edgeLabelStyle = MaterialTheme.typography.labelMedium.copy(
        fontSize = when {
            shortScreen -> 12.sp
            compact -> 13.sp
            else -> 14.sp
        },
        lineHeight = when {
            shortScreen -> 14.sp
            compact -> 16.sp
            else -> 18.sp
        },
        letterSpacing = if (shortScreen) 0.sp else 0.5.sp
    )
    ScreenScaffold {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxSize().padding(2.dp),
                strokeWidth = 4.dp,
                colors = ProgressIndicatorDefaults.colors(
                    indicatorColor = if (finished) Palette.Teal else Palette.Accent,
                    trackColor = Palette.SurfaceRaised
                )
            )
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = topPadding, bottom = if (shortScreen) 38.dp else 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(if (shortScreen) 2.dp else 4.dp)
            ) {
                Text(
                    formatClock(seconds),
                    style = clockStyle,
                    color = if (finished) Palette.Teal else Palette.Text
                )
                if (nextUp != null) {
                    if (compact) {
                        Text(
                            nextUp.detail,
                            modifier = Modifier
                                .widthIn(max = 140.dp)
                                .semantics { contentDescription = "Next up: ${nextUp.exerciseName}, ${nextUp.detail}" },
                            style = contextStyle,
                            color = Palette.Text,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                nextUp.exerciseName,
                                modifier = Modifier.widthIn(max = 150.dp),
                                style = contextStyle,
                                color = Palette.Text,
                                textAlign = TextAlign.Center,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(nextUp.detail, style = contextStyle, color = Palette.Muted, maxLines = 1)
                        }
                    }
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    RestAdjustButton("−15", "Take 15 seconds off the rest", enabled = !busy && !finished, onClick = onShorten)
                    RestAdjustButton("+15", "Add 15 seconds of rest", enabled = !busy, onClick = onExtend)
                }
            }
            EdgeButton(
                onClick = onSkip,
                enabled = !busy,
                modifier = Modifier.align(Alignment.BottomCenter),
                buttonSize = EdgeButtonSize.Small
            ) {
                Text(
                    if (finished) "Continue" else "Skip",
                    style = edgeLabelStyle,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun RestAdjustButton(label: String, description: String, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(48.dp).semantics { contentDescription = description },
        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Palette.SurfaceHover, contentColor = Palette.Text)
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

// Below this width (for example 40 mm faces) the large numerals push the rest controls into the bezel.
private const val COMPACT_WATCH_DP = 200
private const val SHORT_WATCH_DP = 180
