package com.workoutapp.wear.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.workoutapp.wear.data.WorkoutRepository

class WorkoutSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val outcome = runCatching { WorkoutRepository(applicationContext).syncPending() }.getOrElse {
            return Result.retry()
        }
        return if (outcome.pending && !outcome.conflict && !outcome.sessionExpired && !outcome.needsPairing) Result.retry()
        else Result.success()
    }
}
