package com.workoutapp.wear.service

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** The short double pulse for a rest ending or a timed set reaching its target. */
internal val ALERT_PATTERN = longArrayOf(0, 180, 100, 180)

/**
 * Buzzes the wrist, marked as a notification vibration as the phone's rest alert is. Android drops
 * unmarked vibrations from an app that is not in the foreground, which is exactly when a rest ends
 * with the screen off, and applies the watch's own notification vibration settings to marked ones.
 */
fun vibrateAlert(context: Context) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Vibrator::class.java)
    }
    if (vibrator?.hasVibrator() != true) return
    val effect = VibrationEffect.createWaveform(ALERT_PATTERN, -1)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_NOTIFICATION))
    } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(effect, AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build())
    }
}
