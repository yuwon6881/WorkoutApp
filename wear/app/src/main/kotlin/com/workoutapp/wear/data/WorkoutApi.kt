package com.workoutapp.wear.data

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ApiFailure(val statusCode: Int, message: String) : Exception(message)

class WorkoutApi(private val baseUrl: String, private val secureStore: SecureTokenStore) : WorkoutGateway {
    private val gson: Gson = GsonBuilder().serializeNulls().create()

    override suspend fun startPairing(): PairingStart {
        val deviceToken = secureStore.deviceToken()
        val body = JsonObject().apply {
            addProperty("deviceId", secureStore.deviceId())
            addProperty("deviceName", secureStore.deviceName())
            addProperty("deviceToken", deviceToken)
        }
        return request("/watch/pairing/start", "POST", body, pairingBootstrap = true)
    }

    override suspend fun pairingStatus(pairingId: String): PairingStatus {
        val body = JsonObject().apply {
            addProperty("pairingId", pairingId)
            addProperty("deviceToken", secureStore.deviceToken())
        }
        return request("/watch/pairing/status", "POST", body, pairingBootstrap = true)
    }

    override suspend fun active(): ActiveWorkoutResponse = request("/watch/active", "GET")

    override suspend fun workout(sessionId: String): WorkoutSession = request("/watch/workouts/$sessionId", "GET")

    override suspend fun send(operation: PendingOperation): WorkoutSession {
        val path = when (operation.type) {
            "set" -> "/watch/workouts/${operation.sessionId}/sets/${operation.setId}"
            "pause" -> "/watch/workouts/${operation.sessionId}/pause"
            "resume" -> "/watch/workouts/${operation.sessionId}/resume"
            "finish" -> "/watch/workouts/${operation.sessionId}/finish"
            else -> throw IllegalArgumentException("Unknown watch operation")
        }
        return request(path, if (operation.type == "set") "PATCH" else "POST", operation.requestJson)
    }

    override suspend fun revoke() {
        request<Unit>("/watch/session/revoke", "POST", JsonObject())
    }

    private suspend inline fun <reified T> request(
        path: String,
        method: String,
        body: Any? = null,
        pairingBootstrap: Boolean = false
    ): T = withContext(Dispatchers.IO) {
        val connection = (URL("${baseUrl.trimEnd('/')}/api$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 12_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            if (pairingBootstrap) setRequestProperty("X-Workout-Wear-Client", "1")
            else secureStore.deviceToken().takeIf { secureStore.pendingPairing() == null || !path.endsWith("/status") }
                ?.let { setRequestProperty(DEVICE_TOKEN_HEADER, it) }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }

        try {
            if (body != null) connection.outputStream.use { output ->
                val serialized = when (body) {
                    is String -> body
                    else -> gson.toJson(body)
                }
                output.write(serialized.toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val error = runCatching { gson.fromJson(responseText, ApiErrorBody::class.java)?.message }.getOrNull()
                throw ApiFailure(status, error ?: "WorkoutApp could not complete that request.")
            }
            if (T::class.java == Unit::class.java || responseText.isBlank()) Unit as T
            else gson.fromJson(responseText, T::class.java)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val DEVICE_TOKEN_HEADER = "X-Workout-Device-Token"
    }
}
