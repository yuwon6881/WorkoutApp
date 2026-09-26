package com.workoutapp.wear.service

import android.content.Context
import android.os.Looper
import android.os.PowerManager
import android.os.VibratorManager
import com.workoutapp.wear.data.WorkoutSession
import com.workoutapp.wear.data.WorkoutSnapshot
import com.workoutapp.wear.data.WorkoutStore
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.shadows.ShadowVibrator

@RunWith(org.robolectric.RobolectricTestRunner::class)
@Config(sdk = [36])
@LooperMode(LooperMode.Mode.PAUSED)
class WorkoutOngoingServiceTest {
    private lateinit var context: Context
    private lateinit var store: WorkoutStore
    private val controllers = mutableListOf<ServiceController<WorkoutOngoingService>>()

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        store = WorkoutStore.get(context)
        store.clearAll()
        ShadowPowerManager.clearWakeLocks()
        ShadowVibrator.reset()
    }

    @After
    fun tearDown() {
        controllers.asReversed().forEach { runCatching { it.destroy() } }
        controllers.clear()
        store.clearAll()
        ShadowPowerManager.clearWakeLocks()
        ShadowVibrator.reset()
    }

    @Test
    fun `replacement cancellation pause finish and destruction release the real service wake lock`() {
        val first = snapshot(restEndsAt = now() + 60_000, generation = "rest-1")
        store.saveSnapshot(first)
        val controller = newService()
        dispatch(controller, 1)
        val firstLock = latestWakeLock()
        assertTrue(firstLock.isHeld)

        store.saveSnapshot(first.copy(restEndsAtEpochMs = now() + 90_000, restGeneration = "rest-2"))
        dispatch(controller, 2)
        val replacementLock = latestWakeLock()
        assertFalse(firstLock.isHeld)
        assertTrue(replacementLock.isHeld)

        store.saveSnapshot(first.copy(restEndsAtEpochMs = null, restGeneration = null))
        dispatch(controller, 3)
        assertFalse(replacementLock.isHeld)

        store.saveSnapshot(first.copy(
            restEndsAtEpochMs = now() + 60_000,
            restGeneration = "rest-paused",
            session = first.session.copy(pausedAt = "2026-09-27T10:00:00Z")
        ))
        dispatch(controller, 4)
        assertFalse(latestWakeLock().isHeld)

        store.saveSnapshot(first.copy(restEndsAtEpochMs = now() + 60_000, restGeneration = "rest-resumed"))
        dispatch(controller, 5)
        val resumedLock = latestWakeLock()
        assertTrue(resumedLock.isHeld)
        controller.destroy()
        controllers.remove(controller)
        assertFalse(resumedLock.isHeld)

        val finished = newService()
        store.saveSnapshot(first.copy(
            session = first.session.copy(active = false, finishedAt = "2026-09-27T10:01:00Z"),
            restEndsAtEpochMs = null,
            restGeneration = null
        ))
        dispatch(finished, 6)
        assertFalse(latestWakeLock().isHeld)
    }

    @Test
    fun `stale generations are ignored and the persisted service alert vibrates once`() {
        val staleDeadline = now() + 100
        store.saveSnapshot(snapshot(restEndsAt = staleDeadline, generation = "stale"))
        val controller = newService()
        dispatch(controller, 1)
        val staleAlert = restAlert(controller)

        // Run the actual pending callback after SQLite has advanced to a different generation.
        store.saveSnapshot(snapshot(restEndsAt = now() + 10_000, generation = "current"))
        Thread.sleep(150)
        val vibrator = Shadows.shadowOf(context.getSystemService(VibratorManager::class.java).defaultVibrator)
        vibrator.setHasVibrator(true)
        staleAlert.run()
        assertFalse(vibrator.isVibrating)
        assertFalse(latestWakeLock().isHeld)
        assertEquals("current", store.readSnapshot()?.restGeneration)
        assertNull(store.readSnapshot()?.alertedRestGeneration)

        store.saveSnapshot(snapshot(restEndsAt = now() + 100, generation = "current"))
        dispatch(controller, 2)
        val currentAlert = restAlert(controller)
        Thread.sleep(150)
        currentAlert.run()
        idle()
        assertTrue(vibrator.isVibrating)
        assertArrayEquals(longArrayOf(0, 180, 100, 180), vibrator.pattern)
        assertEquals("current", store.readSnapshot()?.alertedRestGeneration)
        assertNull(store.readSnapshot()?.restGeneration)

        ShadowVibrator.reset()
        currentAlert.run()
        idle()
        assertFalse(vibrator.isVibrating)

        dispatch(controller, 3)
        idle()
        assertFalse(Shadows.shadowOf(context.getSystemService(VibratorManager::class.java).defaultVibrator).isVibrating)
    }

    private fun newService(): ServiceController<WorkoutOngoingService> =
        Robolectric.buildService(WorkoutOngoingService::class.java).create().also(controllers::add)

    private fun dispatch(controller: ServiceController<WorkoutOngoingService>, startId: Int) {
        controller.startCommand(0, startId)
    }

    private fun idle() = Shadows.shadowOf(Looper.getMainLooper()).idle()

    private fun now() = System.currentTimeMillis()

    private fun restAlert(controller: ServiceController<WorkoutOngoingService>): Runnable {
        val field = WorkoutOngoingService::class.java.getDeclaredField("restAlert")
        field.isAccessible = true
        return requireNotNull(field.get(controller.get()) as? Runnable)
    }

    private fun latestWakeLock(): PowerManager.WakeLock =
        requireNotNull(ShadowPowerManager.getLatestWakeLock())

    private fun snapshot(restEndsAt: Long, generation: String) = WorkoutSnapshot(
        session = WorkoutSession(id = "workout-test", name = "Test workout"),
        unit = "kg",
        defaultRestSeconds = 90,
        activeExerciseId = "exercise-1",
        restEndsAtEpochMs = restEndsAt,
        restGeneration = generation
    )
}
