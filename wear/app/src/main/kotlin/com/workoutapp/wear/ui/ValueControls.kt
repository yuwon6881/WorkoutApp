package com.workoutapp.wear.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.EdgeButton
import androidx.wear.compose.material3.EdgeButtonSize
import androidx.wear.compose.material3.FilledTonalIconButton
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Ayu

@Composable
private fun StepButton(increase: Boolean, name: String, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalIconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(IconButtonDefaults.ExtraSmallButtonSize + 12.dp),
        colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Ayu.SurfaceHover, contentColor = Ayu.Text)
    ) {
        WearIcon(
            if (increase) R.drawable.ic_plus else R.drawable.ic_minus,
            contentDescription = "${if (increase) "Increase" else "Decrease"} $name",
            modifier = Modifier.size(IconButtonDefaults.SmallIconSize)
        )
    }
}

/**
 * Full-screen editor for bigger changes: the crown steps the value one increment per detent-sized
 * turn, the flanking buttons do the same by touch, and Done or back returns to the set.
 */
@Composable
fun ValueAdjuster(
    title: String,
    value: String,
    caption: String,
    canDecrease: Boolean,
    onStep: (increase: Boolean) -> Unit,
    onDone: () -> Unit,
    valueColor: Color = Ayu.Text
) {
    val haptics = LocalHapticFeedback.current
    val focusRequester = remember { FocusRequester() }
    val accumulated = remember { floatArrayOf(0f) }
    BackHandler(onBack = onDone)
    LaunchedEffect(Unit) { focusRequester.requestFocus() }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Ayu.Background)
            .onRotaryScrollEvent { event ->
                accumulated[0] += event.verticalScrollPixels
                while (accumulated[0] >= ROTARY_STEP_PX || accumulated[0] <= -ROTARY_STEP_PX) {
                    val increase = accumulated[0] > 0
                    accumulated[0] += if (increase) -ROTARY_STEP_PX else ROTARY_STEP_PX
                    if (increase || canDecrease) {
                        onStep(increase)
                        haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick)
                    }
                }
                true
            }
            .focusRequester(focusRequester)
            .focusable(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(bottom = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = Ayu.Muted, letterSpacing = 1.sp)
            Row(
                modifier = Modifier.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                StepButton(increase = false, name = title, enabled = canDecrease) {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onStep(false)
                }
                Text(
                    value,
                    modifier = Modifier.widthIn(min = 64.dp),
                    style = MaterialTheme.typography.numeralMedium,
                    fontSize = if (value.length > 4) 28.sp else 34.sp,
                    color = valueColor,
                    textAlign = TextAlign.Center,
                    maxLines = 1
                )
                StepButton(increase = true, name = title, enabled = true) {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onStep(true)
                }
            }
            Text(caption, style = MaterialTheme.typography.labelSmall, color = Ayu.Muted)
            Text("Turn the crown to adjust", style = MaterialTheme.typography.labelSmall, color = Ayu.Faint)
        }
        EdgeButton(
            onClick = onDone,
            modifier = Modifier.align(Alignment.BottomCenter),
            buttonSize = EdgeButtonSize.ExtraSmall
        ) {
            WearIcon(R.drawable.ic_check, "Done", Modifier.size(ButtonDefaults.SmallIconSize))
        }
    }
}

private const val ROTARY_STEP_PX = 36f
