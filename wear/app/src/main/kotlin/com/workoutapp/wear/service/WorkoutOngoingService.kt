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
import android.os.PowerManager
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.workoutapp.wear.MainActivity
import com.workoutapp.wear.R
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.data.WorkoutStore
import com.workoutapp.wear.ui.elapsedWorkoutSeconds

/**
 * Keeps the live workout one tap away from the watch face and buzzes when rest ends. It exists only
 * while a workout is active or its finish is waiting to sync.
 */
class WorkoutOngoingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: WorkoutStore
    private var restAlert: Runnable? = null
    private var restWakeLock: PowerManager.WakeLock? = null
    private var sessionName = "Workout"

    override fun onCreate() {
        super.onCreate()
        store = WorkoutStore.get(applicationContext)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val snapshot = store.readSnapshot()
        sessionName = intent?.getStringExtra(EXTRA_SESSION_NAME) ?: snapshot?.session?.name ?: "Workout"
        // Foreground first: a start through startForegroundService must reach it even when it is about to stop.
        startInForeground(buildNotification(snapshot))
        if (snapshot == null || (!snapshot.session.active && !snapshot.pendingFinish)) {
            // A sticky restart after the workout ended elsewhere; nothing is left to track.
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        scheduleRestAlert(snapshot)
        return START_STICKY
    }

    override fun onDestroy() {
        restAlert?.let(handler::removeCallbacks)
        releaseRestWakeLock()
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

    private fun buildNotification(snapshot: WorkoutSnapshot?, statusOverride: String? = null): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            // Wear resumes the existing task from the watch-face chip; clearing the task would restart it.
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            NOTIFICATION_ID,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val paused = snapshot?.session?.pausedAt != null
        val restEndsAt = snapshot?.restEndsAtEpochMs?.takeIf { statusOverride == null && !paused }
        val content = statusOverride ?: when {
            snapshot?.pendingFinish == true -> "Finish saved on watch • Sync pending"
            paused -> "Workout paused • Tap to return"
            restEndsAt != null -> "Rest timer running • Tap to return"
            else -> "Workout active • Tap to return"
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_workout_status)
            .setContentTitle(sessionName)
            .setContentText(content)
            .setContentIntent(pendingIntent)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
        runCatching {
            OngoingActivity.Builder(this, NOTIFICATION_ID, builder)
                .setStaticIcon(R.drawable.ic_workout_status)
                .setTouchIntent(pendingIntent)
                .setTitle(sessionName)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setContentDescription(content)
                .setStatus(ongoingStatus(snapshot, restEndsAt, statusOverride ?: content))
                .build()
                .apply(this)
        }
        return builder.build()
    }

    /**
     * Live parts for the watch-face chip: a rest countdown while resting, otherwise the active training
     * clock. Both run on the elapsed-realtime clock, so the chip ticks without waking this service.
     */
    private fun ongoingStatus(snapshot: WorkoutSnapshot?, restEndsAt: Long?, fallback: String): Status {
        val nowWall = System.currentTimeMillis()
        val nowRealtime = SystemClock.elapsedRealtime()
        if (restEndsAt != null) {
            val restZero = nowRealtime + (restEndsAt - nowWall).coerceAtLeast(0)
            return Status.Builder()
                .addTemplate("Rest #rest#")
                .addPart("rest", Status.TimerPart(restZero))
                .build()
        }
        val session = snapshot?.session
        if (session != null && session.active && session.pausedAt == null && !snapshot.pendingFinish) {
            val elapsedSeconds = elapsedWorkoutSeconds(session, nowWall)
            if (elapsedSeconds != null) {
                return Status.Builder()
                    .addTemplate("#elapsed#")
                    .addPart("elapsed", Status.StopwatchPart(nowRealtime - elapsedSeconds * 1_000))
                    .build()
            }
        }
        return Status.forPart(Status.TextPart(fallback))
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Workout session", NotificationManager.IMPORTANCE_LOW).apply {
            description = "One-tap return to the active workout and rest timer"
            setSound(null, null)
            enableVibration(false)
        })
    }

    private fun scheduleRestAlert(snapshot: WorkoutSnapshot) {
        restAlert?.let(handler::removeCallbacks)
        restAlert = null
        val deadline = snapshot.restEndsAtEpochMs
        val generation = snapshot.restGeneration
        if (deadline == null || generation == null || snapshot.session.pausedAt != null) {
            releaseRestWakeLock()
            return
        }
        // With the screen off the CPU sleeps and a posted callback would stall until the next wake,
        // so a partial wake lock bounded to this rest keeps the end-of-rest buzz on time.
        holdRestWakeLock(deadline - System.currentTimeMillis() + WAKE_LOCK_GRACE_MS)
        val alert = object : Runnable {
            override fun run() {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining > 0) {
                    handler.postDelayed(this, remaining)
                    return
                }
                if (store.claimRestAlert(generation)) {
                    vibrate()
                    val manager = getSystemService(NotificationManager::class.java)
                    runCatching { manager.notify(NOTIFICATION_ID, buildNotification(store.readSnapshot(), "Rest complete • Tap to return")) }
                }
                releaseRestWakeLock()
            }
        }
        restAlert = alert
        handler.postDelayed(alert, (deadline - System.currentTimeMillis()).coerceAtLeast(0L))
    }

    private fun holdRestWakeLock(timeoutMs: Long) {
        releaseRestWakeLock()
        if (timeoutMs <= 0) return
        restWakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WorkoutWear:rest")
            .apply {
                setReferenceCounted(false)
                acquire(timeoutMs.coerceAtMost(MAX_REST_WAKE_LOCK_MS))
            }
    }

    private fun releaseRestWakeLock() {
        restWakeLock?.takeIf { it.isHeld }?.release()
        restWakeLock = null
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
        private const val TAG = "WorkoutOngoingService"
        private const val CHANNEL_ID = "workout-session"
        private const val NOTIFICATION_ID = 7191
        private const val EXTRA_SESSION_NAME = "session-name"
        private const val ACTION_START = "com.workoutapp.wear.START"
        private const val ACTION_REST = "com.workoutapp.wear.REST"
        private const val ACTION_UPDATE = "com.workoutapp.wear.UPDATE"
        private const val WAKE_LOCK_GRACE_MS = 10_000L
        private const val MAX_REST_WAKE_LOCK_MS = 15 * 60_000L

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
            try {
                ContextCompat.startForegroundService(context.applicationContext, intent)
            } catch (refused: IllegalStateException) {
                // Android 12+ refuses a foreground start from the background (for example a sync that
                // lands after the app closed). The persisted snapshot is intact, and the service is
                // started again the next time the app opens.
                Log.w(TAG, "Deferred the workout notification until the app is in the foreground.", refused)
            }
        }
    }
}
