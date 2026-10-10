package com.workoutapp.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography

/**
 * The phone and web app's dark theme, so the watch reads as the same product. Wear OS screens sit
 * on true black, so surfaces step up from black rather than from the phone's near-black canvas, and
 * each container is its colour at 14% over black.
 */
object Palette {
    val Background = Color(0xFF000000)
    val Surface = Color(0xFF13151B)
    val SurfaceRaised = Color(0xFF1C202A)
    val SurfaceHover = Color(0xFF252A36)
    val Border = Color(0xFF252A36)
    val BorderHover = Color(0xFF4B5563)
    val Text = Color(0xFFF3F4F6)
    val Muted = Color(0xFF9CA3AF)
    val Faint = Color(0xFF6B7280)
    val Accent = Color(0xFFCCFF00)
    val AccentDim = Color(0xFFA3CC00)
    val AccentContainer = Color(0xFF1C2400)
    val OnAccent = Color(0xFF0A0A0C)
    val Green = Color(0xFFCCFF00)
    val GreenContainer = Color(0xFF1C2400)
    val Amber = Color(0xFFFACC15)
    val Coral = Color(0xFFFB923C)
    val Red = Color(0xFFF43F5E)
    val RedContainer = Color(0xFF240B10)
    val Blue = Color(0xFF22D3EE)
    val BlueContainer = Color(0xFF072127)
}

private val WorkoutColorScheme = ColorScheme(
    primary = Palette.Accent,
    primaryDim = Palette.AccentDim,
    primaryContainer = Palette.AccentContainer,
    onPrimary = Palette.OnAccent,
    onPrimaryContainer = Palette.Accent,
    secondary = Palette.Blue,
    secondaryDim = Palette.Blue,
    secondaryContainer = Palette.BlueContainer,
    onSecondary = Palette.Background,
    onSecondaryContainer = Palette.Blue,
    tertiary = Palette.Green,
    tertiaryDim = Palette.Green,
    tertiaryContainer = Palette.GreenContainer,
    onTertiary = Palette.Background,
    onTertiaryContainer = Palette.Green,
    surfaceContainerLow = Palette.Surface,
    surfaceContainer = Palette.SurfaceRaised,
    surfaceContainerHigh = Palette.SurfaceHover,
    onSurface = Palette.Text,
    onSurfaceVariant = Palette.Muted,
    outline = Palette.BorderHover,
    outlineVariant = Palette.Border,
    background = Palette.Background,
    onBackground = Palette.Text,
    error = Palette.Red,
    errorDim = Palette.Red,
    errorContainer = Palette.RedContainer,
    onError = Palette.Background,
    onErrorContainer = Palette.Red
)

// Counters, timers and loads change in place; tabular figures stop them jittering sideways.
private fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

private val WorkoutTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.tabular(),
        displayMedium = base.displayMedium.tabular(),
        displaySmall = base.displaySmall.tabular(),
        numeralExtraLarge = base.numeralExtraLarge.tabular(),
        numeralLarge = base.numeralLarge.tabular(),
        numeralMedium = base.numeralMedium.tabular(),
        numeralSmall = base.numeralSmall.tabular(),
        numeralExtraSmall = base.numeralExtraSmall.tabular(),
        labelSmall = base.labelSmall.tabular(),
        labelMedium = base.labelMedium.tabular()
    )
}

@Composable
fun WearWorkoutTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = WorkoutColorScheme, typography = WorkoutTypography, content = content)
}

/** Effort tiers shared with the web RIR selector: 0 max red, 1 coral, 2 amber, 3+ green. */
fun rirColor(rir: String?): Color = when (rir) {
    "0" -> Palette.Red
    "1" -> Palette.Coral
    "2" -> Palette.Amber
    null -> Palette.Muted
    else -> Palette.Green
}
