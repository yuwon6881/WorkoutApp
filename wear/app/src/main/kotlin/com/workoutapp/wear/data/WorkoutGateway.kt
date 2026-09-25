package com.workoutapp.wear.data

interface WorkoutGateway {
    suspend fun startPairing(): PairingStart
    suspend fun pairingStatus(pairingId: String): PairingStatus
    suspend fun active(): ActiveWorkoutResponse
    suspend fun workout(sessionId: String): WorkoutSession
    suspend fun send(operation: PendingOperation): WorkoutSession
    suspend fun revoke()
}
