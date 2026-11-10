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
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.workoutapp.wear.MainActivity
import com.workoutapp.wear.R
import com.workoutapp.wear.data.WorkoutRepository
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.data.WorkoutStore
import com.workoutapp.wear.ui.elapsedWorkoutSeconds
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Keeps the live workout one tap away from the watch face and buzzes when rest ends. It exists only
 * while a workout is active or its finish is waiting to sync.
 */
class WorkoutOngoingService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var store: WorkoutStore
    private val pollScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var pollJob: Job? = null
    private var restAlert: Runnable? = null
    private var timerAlert: Runnable? = null
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
        scheduleAlerts(snapshot)
        startPhoneChangePolling()
        return START_STICKY
    }

    /**
     * A rest the phone skipped or changed only reaches the watch through the API, and the screen's
     * own refresh stops once the app is backgrounded. While a rest is running this asks the API on a
     * timer; an adopted change re-arms the alerts through `startRest`/`start`, so a buzz for a rest
     * the phone already skipped is dropped. It does nothing outside a running rest, to spare battery
     * and requests (a rest started on the phone while the watch idles is seen when the screen opens).
     * The loop is driven by the clock, never by an alert callback, so it cannot feed back into itself.
     */
    private fun startPhoneChangePolling() {
        if (pollJob?.isActive == true) return
        pollJob = pollScope.launch {
            while (isActive) {
                val snapshot = store.readSnapshot()
                if (snapshot == null || (!snapshot.session.active && !snapshot.pendingFinish)) return@launch
                // No running rest means no buzz that stale phone data could get wrong, so stop asking
                // the network; the next rest start restarts this loop through onStartCommand.
                val wait = refreshDelayMs(snapshot, System.currentTimeMillis()) ?: return@launch
                delay(wait)
                try {
                    WorkoutRepository.get(applicationContext).refresh()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (failure: Exception) {
                    // Offline or signed out: the stored snapshot stays authoritative until the next pass.
                    Log.d(TAG, "Background refresh skipped: ${failure.message}")
                }
            }
        }
    }

    override fun onDestroy() {
        pollJob?.cancel()
        restAlert?.let(handler::removeCallbacks)
        timerAlert?.let(handler::removeCallbacks)
        releaseRestWakeLock()
        pollScope.cancel()
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
            .setColor(ContextCompat.getColor(this, R.color.brand_accent))
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

    /** Arms the end-of-rest and end-of-countdown pulses; either may be absent. */
    private fun scheduleAlerts(snapshot: WorkoutSnapshot) {
        restAlert?.let(handler::removeCallbacks)
        restAlert = null
        timerAlert?.let(handler::removeCallbacks)
        timerAlert = null
        val restDeadline = scheduleRestAlert(snapshot)
        val timerDeadline = scheduleTimerAlert(snapshot)
        val latest = listOfNotNull(restDeadline, timerDeadline).maxOrNull()
        // With the screen off the CPU sleeps and a posted callback would stall until the next wake,
        // so a partial wake lock bounded to the last pending alert keeps each buzz on time.
        if (latest == null) releaseRestWakeLock()
        else holdRestWakeLock(latest - System.currentTimeMillis() + WAKE_LOCK_GRACE_MS)
    }

    /**
     * A timed set counting down to its target pulses when it ends even with the screen off, when the
     * page's own countdown cannot run. The store claim keeps the page and this service to one pulse.
     */
    private fun scheduleTimerAlert(snapshot: WorkoutSnapshot): Long? {
        if (snapshot.session.pausedAt != null || !snapshot.session.active || snapshot.pendingFinish) return null
        val (setId, timer) = snapshot.setTimers.orEmpty().entries
            .mapNotNull { (id, timer) -> timer.countdownEndsAt()?.let { id to timer } }
            .minByOrNull { (_, timer) -> timer.countdownEndsAt()!! } ?: return null
        val deadline = timer.countdownEndsAt() ?: return null
        val startedAt = timer.startedAt ?: return null
        val alert = object : Runnable {
            override fun run() {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining > 0) {
                    handler.postDelayed(this, remaining)
                    return
                }
                if (store.claimSetTimerAlert(setId, startedAt)) vibrateAlert(this@WorkoutOngoingService)
                timerAlert = null
                // Only the earliest countdown is armed at a time; arm the next running one now,
                // or a second timed set would stay silent until something else updated the service.
                val latest = store.readSnapshot()
                if (latest != null && (latest.session.active || latest.pendingFinish)) scheduleAlerts(latest)
                else if (restAlert == null) releaseRestWakeLock()
            }
        }
        timerAlert = alert
        handler.postDelayed(alert, (deadline - System.currentTimeMillis()).coerceAtLeast(0L))
        return deadline
    }

    private fun scheduleRestAlert(snapshot: WorkoutSnapshot): Long? {
        val deadline = snapshot.restEndsAtEpochMs
        val generation = snapshot.restGeneration
        if (deadline == null || generation == null || snapshot.session.pausedAt != null) return null
        val alert = object : Runnable {
            override fun run() {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining > 0) {
                    handler.postDelayed(this, remaining)
                    return
                }
                if (store.claimRestAlert(generation)) {
                    vibrateAlert(this@WorkoutOngoingService)
                    val manager = getSystemService(NotificationManager::class.java)
                    runCatching { manager.notify(NOTIFICATION_ID, buildNotification(store.readSnapshot(), "Rest complete • Tap to return")) }
                }
                restAlert = null
                if (timerAlert == null) releaseRestWakeLock()
            }
        }
        restAlert = alert
        handler.postDelayed(alert, (deadline - System.currentTimeMillis()).coerceAtLeast(0L))
        return deadline
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

    companion object {
        private const val TAG = "WorkoutOngoingService"
        private const val CHANNEL_ID = "workout-session"
        private const val NOTIFICATION_ID = 7191
        private const val EXTRA_SESSION_NAME = "session-name"
        private const val ACTION_START = "com.workoutapp.wear.START"
        private const val ACTION_REST = "com.workoutapp.wear.REST"
        private const val ACTION_UPDATE = "com.workoutapp.wear.UPDATE"
        private const val WAKE_LOCK_GRACE_MS = 10_000L
        private const val REST_POLL_MS = 15_000L
        private const val PRE_ALERT_CHECK_MS = 2_000L
        private const val MIN_POLL_MS = 1_000L

        /**
         * How long to wait before the next background refresh while a rest runs, with one last check
         * just before it ends so a skip made on the phone in that window is seen before the watch
         * buzzes. Null when no rest is running (or it is paused): nothing to watch.
         */
        internal fun refreshDelayMs(snapshot: WorkoutSnapshot, nowEpochMs: Long): Long? {
            val restEndsAt = snapshot.restEndsAtEpochMs?.takeIf { snapshot.session.pausedAt == null }
                ?: return null
            val untilCheck = restEndsAt - PRE_ALERT_CHECK_MS - nowEpochMs
            return if (untilCheck in MIN_POLL_MS until REST_POLL_MS) untilCheck else REST_POLL_MS
        }
        // A timed set lasts up to two hours (WorkoutRepository.MAX_SET_SECONDS); a lock capped below
        // that lets the CPU sleep through the end of a long countdown with the screen off.
        private const val MAX_REST_WAKE_LOCK_MS = WorkoutRepository.MAX_SET_SECONDS * 1_000L + 5 * 60_000L

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
