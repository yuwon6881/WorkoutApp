package com.workoutapp.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography

/** The phone and web app's Ayu dark tokens, so the watch reads as the same product. */
object Ayu {
    val Background = Color(0xFF0B0E14)
    val Surface = Color(0xFF11151E)
    val SurfaceRaised = Color(0xFF161B26)
    val SurfaceHover = Color(0xFF1E2433)
    val Border = Color(0xFF222936)
    val BorderHover = Color(0xFF333D4E)
    val Text = Color(0xFFF0F2F5)
    val Muted = Color(0xFF949DA9)
    val Faint = Color(0xFF5A6473)
    val Accent = Color(0xFFE6B450)
    val AccentDim = Color(0xFFB98F3C)
    val AccentContainer = Color(0xFF2B2415)
    val OnAccent = Color(0xFF14130E)
    val Green = Color(0xFF86EFAC)
    val GreenContainer = Color(0xFF142A1E)
    val Amber = Color(0xFFFBBF24)
    val Coral = Color(0xFFFB8B5E)
    val Red = Color(0xFFF87171)
    val RedContainer = Color(0xFF2E1719)
    val Blue = Color(0xFF60A5FA)
    val BlueContainer = Color(0xFF132136)
}

private val AyuColorScheme = ColorScheme(
    primary = Ayu.Accent,
    primaryDim = Ayu.AccentDim,
    primaryContainer = Ayu.AccentContainer,
    onPrimary = Ayu.OnAccent,
    onPrimaryContainer = Ayu.Accent,
    secondary = Ayu.Blue,
    secondaryDim = Ayu.Blue,
    secondaryContainer = Ayu.BlueContainer,
    onSecondary = Ayu.Background,
    onSecondaryContainer = Ayu.Blue,
    tertiary = Ayu.Green,
    tertiaryDim = Ayu.Green,
    tertiaryContainer = Ayu.GreenContainer,
    onTertiary = Ayu.Background,
    onTertiaryContainer = Ayu.Green,
    surfaceContainerLow = Ayu.Surface,
    surfaceContainer = Ayu.SurfaceRaised,
    surfaceContainerHigh = Ayu.SurfaceHover,
    onSurface = Ayu.Text,
    onSurfaceVariant = Ayu.Muted,
    outline = Ayu.BorderHover,
    outlineVariant = Ayu.Border,
    background = Ayu.Background,
    onBackground = Ayu.Text,
    error = Ayu.Red,
    errorDim = Ayu.Red,
    errorContainer = Ayu.RedContainer,
    onError = Ayu.Background,
    onErrorContainer = Ayu.Red
)

// Counters, timers and loads change in place; tabular figures stop them jittering sideways.
private fun TextStyle.tabular(): TextStyle = copy(fontFeatureSettings = "tnum")

private val AyuTypography = Typography().let { base ->
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
    MaterialTheme(colorScheme = AyuColorScheme, typography = AyuTypography, content = content)
}

/** Effort tiers shared with the web RIR selector: 0 max red, 1 coral, 2 amber, 3+ green. */
fun rirColor(rir: String?): Color = when (rir) {
    "0" -> Ayu.Red
    "1" -> Ayu.Coral
    "2" -> Ayu.Amber
    null -> Ayu.Muted
    else -> Ayu.Green
}
