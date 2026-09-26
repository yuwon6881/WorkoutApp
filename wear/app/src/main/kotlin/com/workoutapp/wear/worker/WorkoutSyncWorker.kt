package com.workoutapp.wear.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.workoutapp.wear.data.WorkoutRepository
import kotlin.coroutines.cancellation.CancellationException

class WorkoutSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val outcome = try {
            WorkoutRepository.get(applicationContext).syncPending()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            return Result.retry()
        }
        // Conflicts and lapsed pairing wait for the lifter; retrying them in the background cannot help.
        return if (outcome.pending && !outcome.conflict && !outcome.sessionExpired && !outcome.needsPairing) Result.retry()
        else Result.success()
    }
}
