package com.workoutapp.wear.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.workoutapp.wear.MainActivity
import com.workoutapp.wear.R
import com.workoutapp.wear.data.WorkoutStore

class WorkoutOngoingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: WorkoutStore
    private var restAlert: Runnable? = null
    private var sessionName = "Workout"

    override fun onCreate() {
        super.onCreate()
        store = WorkoutStore(applicationContext)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        sessionName = intent?.getStringExtra(EXTRA_SESSION_NAME) ?: store.readSnapshot()?.session?.name ?: "Workout"
        startInForeground(buildNotification())
        scheduleRestAlert()
        return START_STICKY
    }

    override fun onDestroy() {
        restAlert?.let(handler::removeCallbacks)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startInForeground(notification: Notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(statusOverride: String? = null): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val snapshot = store.readSnapshot()
        val restActive = snapshot?.restEndsAtEpochMs != null
        val content = statusOverride ?: if (snapshot?.pendingFinish == true) "Finish saved on watch • Sync pending"
        else if (snapshot?.session?.pausedAt != null) "Workout paused • Tap to return"
        else if (restActive) "Rest timer running • Tap to return"
        else "Workout active • Tap to return"
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_workout_status)
            .setContentTitle(sessionName)
            .setContentText(content)
            .setContentIntent(pendingIntent)
            .setCategory("workout")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        runCatching {
            OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
                .setStaticIcon(R.drawable.ic_workout_status)
                .setTouchIntent(pendingIntent)
                .setTitle("Workout")
                .setCategory("workout")
                .setContentDescription(content)
                .setStatus(ongoingStatus(snapshot?.restEndsAtEpochMs?.takeIf { statusOverride == null }, content))
                .build()
                .apply(this)
        }
        return builder.build()
    }

    // A live countdown on the watch-face chip while resting; the parts run on the elapsed-realtime clock.
    private fun ongoingStatus(restEndsAtEpochMs: Long?, fallback: String): Status {
        if (restEndsAtEpochMs == null) return Status.forPart(Status.TextPart(fallback))
        val restZero = SystemClock.elapsedRealtime() + (restEndsAtEpochMs - System.currentTimeMillis()).coerceAtLeast(0)
        return Status.Builder()
            .addTemplate("Rest #rest#")
            .addPart("rest", Status.TimerPart(restZero))
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Workout session", NotificationManager.IMPORTANCE_LOW).apply {
            description = "One-tap return to the active workout and rest timer"
            setSound(null, null)
            enableVibration(false)
        })
    }

    private fun scheduleRestAlert() {
        restAlert?.let(handler::removeCallbacks)
        val snapshot = store.readSnapshot() ?: return
        val deadline = snapshot.restEndsAtEpochMs ?: return
        val generation = snapshot.restGeneration ?: return
        restAlert = Runnable {
            val remaining = deadline - System.currentTimeMillis()
            if (remaining > 0) {
                handler.postDelayed(restAlert!!, remaining)
            } else if (store.claimRestAlert(generation)) {
                vibrate()
                val manager = getSystemService(NotificationManager::class.java)
                runCatching { manager.notify(NOTIFICATION_ID, buildNotification("Rest complete • Tap to return")) }
            }
        }.also { handler.postDelayed(it, (deadline - System.currentTimeMillis()).coerceAtLeast(0L)) }
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= 31) {
            getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Vibrator::class.java)
        }
        if (vibrator?.hasVibrator() == true) {
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 180, 100, 180), -1))
        }
    }

    companion object {
        private const val CHANNEL_ID = "workout-session"
        private const val NOTIFICATION_ID = 7191
        private const val EXTRA_SESSION_NAME = "session-name"
        private const val ACTION_START = "com.workoutapp.wear.START"
        private const val ACTION_REST = "com.workoutapp.wear.REST"
        private const val ACTION_UPDATE = "com.workoutapp.wear.UPDATE"

        fun start(context: Context, sessionName: String) = send(context, ACTION_START, sessionName)

        fun startRest(context: Context, sessionName: String) {
            // The service reads the persisted deadline and generation from SQLite on every start.
            send(context, ACTION_REST, sessionName)
        }

        fun update(context: Context, sessionName: String) = send(context, ACTION_UPDATE, sessionName)

        fun stop(context: Context) {
            context.applicationContext.stopService(Intent(context, WorkoutOngoingService::class.java))
        }

        private fun send(context: Context, action: String, sessionName: String) {
            val intent = Intent(context, WorkoutOngoingService::class.java).apply {
                this.action = action
                putExtra(EXTRA_SESSION_NAME, sessionName)
            }
            ContextCompat.startForegroundService(context.applicationContext, intent)
        }
    }
}
