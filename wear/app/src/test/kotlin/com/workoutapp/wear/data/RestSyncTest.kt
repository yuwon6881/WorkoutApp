package com.workoutapp.wear.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RestSyncTest {
    private val now = 1_800_000_000_000L
    private val serverRest = SessionRest(generation = "phone-rest", status = "running", deadlineUtc = "2027-01-15T08:01:00Z")
    private val serverDeadline = java.time.Instant.parse("2027-01-15T08:01:00Z").toEpochMilli()

    @Test
    fun `an idle watch takes the rest the server is running`() {
        val local = snapshot(revision = 4)
        val remote = local.session.copy(revision = 5, rest = serverRest)

        assertEquals(Triple(serverDeadline, "phone-rest", null), RestSync.forAdoption(local, remote, emptyList(), serverDeadline - 30_000))
    }

    @Test
    fun `a queued pause keeps the rest the watch froze`() {
        val local = snapshot(revision = 4).copy(pausedRestRemainingMs = 42_000L)
        val remote = local.session.copy(revision = 5, rest = serverRest)
        val pause = PendingOperation(1, "pause-1", "pause", local.session.id, null, 4, "{}", "{}", "2027-01-15T08:00:00Z", false)

        assertEquals(Triple(null, null, 42_000L), RestSync.forAdoption(local, remote, listOf(pause), serverDeadline - 30_000))
    }

    @Test
    fun `a rest this watch already alerted for is not counted again`() {
        val local = snapshot(revision = 5).copy(alertedRestGeneration = "phone-rest")
        val remote = local.session.copy(revision = 5, rest = serverRest)

        assertEquals(Triple(null, null, null), RestSync.forAdoption(local, remote, emptyList(), serverDeadline - 500))
    }

    @Test
    fun `a read older than the watch copy keeps the watch rest`() {
        val local = snapshot(revision = 6).copy(restEndsAtEpochMs = now + 60_000, restGeneration = "watch-rest")
        val remote = local.session.copy(revision = 5, rest = null)

        assertEquals(Triple(now + 60_000, "watch-rest", null), RestSync.forAdoption(local, remote, emptyList(), now))
    }

    private fun snapshot(revision: Int) = WorkoutSnapshot(
        session = WorkoutSession(id = "workout-1", revision = revision),
        unit = "kg",
        defaultRestSeconds = 90
    )
}
