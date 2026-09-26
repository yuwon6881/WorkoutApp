package com.workoutapp.wear.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.wear.compose.material3.AppScaffold
import com.workoutapp.wear.ui.theme.Ayu
import com.workoutapp.wear.ui.theme.WearWorkoutTheme
import java.io.File
import java.time.Duration
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowDialog

/** A watch form factor as Robolectric resource qualifiers. */
data class WatchDevice(val id: String, val qualifiers: String, val fontScale: Float = 1f)

val WATCH_DEVICES = listOf(
    WatchDevice("small-round", "w192dp-h192dp-round-watch-xhdpi"),
    WatchDevice("large-round", "w227dp-h227dp-round-watch-xhdpi"),
    WatchDevice("square", "w180dp-h180dp-notround-watch-xhdpi"),
    // Accessibility text size on the smallest face: values and actions must stay legible and on screen.
    WatchDevice("small-round-large-text", "w192dp-h192dp-round-watch-xhdpi", fontScale = 1.3f),
    // Not a real watch: a tall canvas that shows every list item at once for layout review.
    WatchDevice("tall-review", "w192dp-h560dp-notround-watch-xhdpi")
)

/**
 * Renders one screen through a real activity and view hierarchy, including any open dialog window,
 * and writes a PNG. Round screens are masked to the physical circle so anything drawn past the
 * bezel is visibly lost, exactly as it would be on the watch.
 */
fun renderScreen(device: WatchDevice, name: String, settleMs: Long = 2_000, content: @Composable () -> Unit): File {
    RuntimeEnvironment.setQualifiers(device.qualifiers)
    RuntimeEnvironment.setFontScale(device.fontScale)
    val controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
    val activity = controller.get()
    activity.setContent {
        WearWorkoutTheme {
            AppScaffold { Box(Modifier.fillMaxSize().background(Ayu.Background)) { content() } }
        }
    }
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(settleMs))
    val root = activity.window.decorView
    val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    root.draw(canvas)
    ShadowDialog.getLatestDialog()?.takeIf { it.isShowing }?.window?.decorView?.draw(canvas)
    if (activity.resources.configuration.isScreenRound) maskToCircle(canvas, bitmap.width, bitmap.height)
    val directory = File(System.getProperty("wear.shots.dir") ?: "build/wear-shots", device.id)
    directory.mkdirs()
    val file = File(directory, "$name.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    ShadowDialog.getLatestDialog()?.dismiss()
    controller.pause().stop().destroy()
    return file
}

private fun maskToCircle(canvas: Canvas, width: Int, height: Int) {
    val outside = Path().apply {
        fillType = Path.FillType.INVERSE_WINDING
        addCircle(width / 2f, height / 2f, width / 2f, Path.Direction.CW)
    }
    canvas.drawPath(outside, Paint().apply { color = BEZEL; isAntiAlias = true })
}

private const val BEZEL = 0xFF2A2E36.toInt()
