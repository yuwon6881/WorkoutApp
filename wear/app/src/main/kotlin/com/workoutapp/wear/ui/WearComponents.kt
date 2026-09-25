package com.workoutapp.wear.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.Icon
import androidx.wear.compose.material3.LocalContentColor
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Ayu

/**
 * One scrolling screen: rotary-aware list, round-screen content padding, scroll-away time text and an
 * optional edge-hugging primary action. Every list screen goes through here so they scroll alike.
 */
@Composable
fun WearListScreen(
    edgeButton: (@Composable BoxScope.() -> Unit)? = null,
    content: TransformingLazyColumnScope.(TransformationSpec) -> Unit
) {
    val state = rememberTransformingLazyColumnState()
    val spec = rememberTransformationSpec()
    if (edgeButton != null) {
        ScreenScaffold(scrollState = state, edgeButton = edgeButton) { padding ->
            TransformingLazyColumn(state = state, contentPadding = padding) { content(spec) }
        }
    } else {
        ScreenScaffold(scrollState = state) { padding ->
            TransformingLazyColumn(state = state, contentPadding = padding) { content(spec) }
        }
    }
}

/** Width and height morphing for plain (non-surface) rows so they shrink with their neighbours at the edges. */
fun Modifier.listRow(scope: TransformingLazyColumnItemScope, spec: TransformationSpec): Modifier =
    fillMaxWidth().transformedHeight(scope, spec)

@Composable
fun WearIcon(@DrawableRes id: Int, contentDescription: String?, modifier: Modifier = Modifier, tint: Color = Color.Unspecified) {
    Icon(
        painter = painterResource(id),
        contentDescription = contentDescription,
        modifier = modifier,
        tint = if (tint == Color.Unspecified) LocalContentColor.current else tint
    )
}

/** A tinted disc that gives empty and status screens a focal point without a heavy illustration. */
@Composable
fun IconBadge(@DrawableRes id: Int, tint: Color, container: Color, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    Box(
        modifier = modifier.size(size).clip(CircleShape).background(container),
        contentAlignment = Alignment.Center
    ) {
        WearIcon(id, contentDescription = null, modifier = Modifier.size(size * 0.5f), tint = tint)
    }
}

@Composable
fun BrandMark(modifier: Modifier = Modifier, size: Dp = 48.dp) {
    Image(
        painter = painterResource(R.drawable.ic_launcher_foreground),
        contentDescription = null,
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(Ayu.SurfaceRaised)
            .border(1.dp, Ayu.Border, CircleShape)
    )
}

@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier, maxLines: Int = 2) {
    Text(
        text,
        modifier = modifier.fillMaxWidth(),
        style = MaterialTheme.typography.titleMedium,
        textAlign = TextAlign.Center,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis
    )
}

@Composable
fun BodyText(text: String, modifier: Modifier = Modifier, color: Color = Ayu.Muted) {
    Text(
        text,
        modifier = modifier.fillMaxWidth().padding(horizontal = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = color,
        textAlign = TextAlign.Center
    )
}

/** Transient confirmations read muted; failures read red and stay until the next action clears them. */
@Composable
fun Feedback(message: String?, error: String?, modifier: Modifier = Modifier) {
    when {
        !error.isNullOrBlank() -> BodyText(error, modifier, color = Ayu.Red)
        !message.isNullOrBlank() -> BodyText(message, modifier, color = Ayu.Muted)
    }
}

fun hasFeedback(message: String?, error: String?): Boolean = !message.isNullOrBlank() || !error.isNullOrBlank()

/** The screen's one primary action. Short text only: the top of an edge button is too narrow for an icon and a word. */
@Composable
fun PrimaryEdgeButton(label: String, onClick: () -> Unit, enabled: Boolean = true, description: String = label) {
    EdgeButton(
        onClick = onClick,
        modifier = Modifier.semantics { contentDescription = description },
        enabled = enabled,
        buttonSize = EdgeButtonSize.ExtraSmall
    ) {
        Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Extra side inset for a list's first rows, which sit where a round face is narrowest; square faces need none. */
@Composable
fun topRowInset(): Dp = if (LocalConfiguration.current.isScreenRound) 14.dp else 0.dp
