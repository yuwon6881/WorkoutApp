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
    val Surface = Color(0xFF16181C)
    val SurfaceRaised = Color(0xFF1F2226)
    val SurfaceHover = Color(0xFF2A2E33)
    val Border = Color(0xFF2C3138)
    val BorderHover = Color(0xFF5E6671)
    val Text = Color(0xFFE7E9EC)
    val Muted = Color(0xFFADB4BD)
    val Faint = Color(0xFF78808B)
    val Accent = Color(0xFFFFA056)
    val AccentDim = Color(0xFFCC804A)
    val AccentContainer = Color(0xFF24160C)
    val OnAccent = Color(0xFF1A0F05)
    val Green = Color(0xFF66E8B4)
    val GreenContainer = Color(0xFF0E2019)
    val Amber = Color(0xFFF5CF4A)
    val Coral = Color(0xFFFF7F6B)
    val Red = Color(0xFFF2637D)
    val RedContainer = Color(0xFF220E12)
    val Blue = Color(0xFF5CB8FF)
    val BlueContainer = Color(0xFF0D1A24)
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
