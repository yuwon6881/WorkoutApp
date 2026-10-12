package com.workoutapp.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography

/**
 * Midnight Lime, the phone and web app's dark theme, so the watch reads as the same product. Wear OS
 * screens sit on true black rather than the phone's near-black canvas; surfaces, hairline and text
 * are the web tokens, and each tinted container is its colour at about 14% over black.
 *
 * Lime is reserved for the primary action, the current or selected item and real progress. Text on
 * lime is always [OnAccent], never white. Completion and "synced" read teal so they never pass for
 * the next action.
 */
object Palette {
    val Background = Color(0xFF000000)
    val Surface = Color(0xFF141417)
    val SurfaceRaised = Color(0xFF1F1F24)
    val SurfaceHover = Color(0xFF26262C)
    val Border = Color(0xFF25252B)
    val BorderHover = Color(0xFF4A4A54)
    val Text = Color(0xFFECECF1)
    val Muted = Color(0xFFA2A2AD)
    val Faint = Color(0xFF8E8E99)
    val Accent = Color(0xFFB5F04A)
    val AccentDim = Color(0xFF94C93A)
    val AccentContainer = Color(0xFF1B230F)
    val OnAccent = Color(0xFF0C1400)
    val Teal = Color(0xFF5ED8C3)
    val TealContainer = Color(0xFF0D1E1B)
    val Amber = Color(0xFFF6BD48)
    val Red = Color(0xFFFF6B6B)
    val RedContainer = Color(0xFF240F0F)
    val Blue = Color(0xFF62A9FF)
    val BlueContainer = Color(0xFF0E1824)

    // The RIR effort scale shared with the web selector (--effort-max/-hard/-moderate/-easy).
    val EffortMax = Red
    val EffortHard = Color(0xFFFF9A4D)
    val EffortModerate = Amber
    val EffortEasy = Accent
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
    tertiary = Palette.Teal,
    tertiaryDim = Palette.Teal,
    tertiaryContainer = Palette.TealContainer,
    onTertiary = Palette.OnAccent,
    onTertiaryContainer = Palette.Teal,
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

// Counters, timers and loads change in place: tabular figures stop them jittering sideways, and the
// bold, tightly tracked cut matches the web's display numbers.
private fun TextStyle.figures(): TextStyle = copy(fontFeatureSettings = "tnum", fontWeight = FontWeight.Bold, letterSpacing = (-0.02).em)

private fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

private fun TextStyle.heading(): TextStyle = copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em)

private val WorkoutTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.figures(),
        displayMedium = base.displayMedium.figures(),
        displaySmall = base.displaySmall.figures(),
        numeralExtraLarge = base.numeralExtraLarge.figures(),
        numeralLarge = base.numeralLarge.figures(),
        numeralMedium = base.numeralMedium.figures(),
        numeralSmall = base.numeralSmall.figures(),
        numeralExtraSmall = base.numeralExtraSmall.figures(),
        titleLarge = base.titleLarge.heading(),
        titleMedium = base.titleMedium.heading(),
        titleSmall = base.titleSmall.heading(),
        labelSmall = base.labelSmall.tabular(),
        labelMedium = base.labelMedium.tabular()
    )
}

@Composable
fun WearWorkoutTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = WorkoutColorScheme, typography = WorkoutTypography, content = content)
}

/** Effort tiers shared with the web RIR selector: 0 max, 1 hard, 2 moderate, 3+ easy. */
fun rirColor(rir: String?): Color = when (rir) {
    "0" -> Palette.EffortMax
    "1" -> Palette.EffortHard
    "2" -> Palette.EffortModerate
    null -> Palette.Muted
    else -> Palette.EffortEasy
}
