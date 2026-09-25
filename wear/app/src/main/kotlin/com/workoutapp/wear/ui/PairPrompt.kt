package com.workoutapp.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.R
import com.workoutapp.wear.ui.theme.Ayu

const val PAIRING_INSTRUCTION = "Enter it in WorkoutApp under Settings → Wear OS."

fun pairingPromptVisible(pairingRequired: Boolean, pairingCode: String?): Boolean = pairingRequired || pairingCode != null

/** Re-pairing inside a workout, so saved changes can still reach WorkoutApp after the watch session lapsed. */
@Composable
fun PairPrompt(
    pairingRequired: Boolean,
    pairingCode: String?,
    checking: Boolean,
    busy: Boolean,
    onStartPairing: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (!pairingPromptVisible(pairingRequired, pairingCode)) return
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (pairingCode == null) {
            BodyText("Reconnect to WorkoutApp to sync the changes saved here.")
            Button(
                onClick = onStartPairing,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                icon = { WearIcon(R.drawable.ic_watch, null, Modifier.size(ButtonDefaults.IconSize)) },
                label = { Text("Pair this watch") }
            )
        } else {
            Text("PAIRING CODE", style = MaterialTheme.typography.labelSmall, color = Ayu.Muted, letterSpacing = 1.sp)
            PairingCodeText(pairingCode)
            BodyText(if (checking) "Checking approval…" else PAIRING_INSTRUCTION)
        }
    }
}

@Composable
fun PairingCodeText(code: String, modifier: Modifier = Modifier) {
    val formatted = formatPairingCode(code)
    Text(
        formatted,
        modifier = modifier.semantics { contentDescription = "Pairing code ${formatted.toCharArray().joinToString(" ")}" },
        style = MaterialTheme.typography.numeralExtraSmall,
        fontSize = 26.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.sp,
        color = Ayu.Accent,
        textAlign = TextAlign.Center,
        maxLines = 1
    )
}
