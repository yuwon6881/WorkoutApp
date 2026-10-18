package com.workoutapp.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.mutableStateOf
import androidx.core.content.ContextCompat
import com.workoutapp.wear.ui.WearWorkoutApp

class MainActivity : ComponentActivity() {
    private lateinit var notificationPermissionLauncher: ActivityResultLauncher<String>
    // Re-read on every resume and after the prompt, so a grant (here or in system settings) clears the prompt at once.
    private val notificationsAllowed = mutableStateOf(true)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        notificationsAllowed.value = hasNotificationPermission()
        notificationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            notificationsAllowed.value = hasNotificationPermission()
        }
        setContent {
            WearWorkoutApp(
                notificationsAllowed = notificationsAllowed.value,
                onEnableNotifications = {
                    if (Build.VERSION.SDK_INT >= 33) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            )
        }
    }

    override fun onResume() {
        super.onResume()
        notificationsAllowed.value = hasNotificationPermission()
    }

    private fun hasNotificationPermission(): Boolean = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
