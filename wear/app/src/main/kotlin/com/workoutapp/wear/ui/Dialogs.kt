package com.workoutapp.wear.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.IconButtonDefaults
import androidx.wear.compose.material3.Text
import com.workoutapp.wear.ui.theme.Ayu

/** A yes/no confirmation using the platform dialog so swipe-to-dismiss and rotary behave natively. */
@Composable
fun ConfirmDialog(
    visible: Boolean,
    title: String,
    text: String,
    destructive: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        visible = visible,
        onDismissRequest = onDismiss,
        title = { Text(title, textAlign = TextAlign.Center) },
        text = { Text(text, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
        confirmButton = {
            AlertDialogDefaults.ConfirmButton(
                onClick = onConfirm,
                colors = if (destructive) IconButtonDefaults.filledIconButtonColors(
                    containerColor = Ayu.Red,
                    contentColor = Ayu.Background
                ) else IconButtonDefaults.filledIconButtonColors()
            )
        },
        dismissButton = { AlertDialogDefaults.DismissButton(onClick = onDismiss) }
    )
}
