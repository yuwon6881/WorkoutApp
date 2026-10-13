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
    private var integrationPending = false
    private val gson: Gson = GsonBuilder().serializeNulls().create()
    @Volatile private var lastActiveEtag: String? = null
    @Volatile private var lastActiveResponse: ActiveWorkoutResponse? = null

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

    override suspend fun active(): ActiveWorkoutResponse {
        val rememberedTag = lastActiveEtag
        if (rememberedTag != null) {
            val response = requestActive(rememberedTag)
            if (response != null) return response
            // A 304 arrived but nothing was remembered; retry once without the header.
        }
        return requestActive(null) ?: throw ApiFailure(500, "WorkoutApp could not complete that request.")
    }

    override suspend fun workout(sessionId: String): WorkoutSession = request("/watch/workouts/$sessionId", "GET")

    override suspend fun send(operation: PendingOperation): WorkoutSession {
        val path = when (operation.type) {
            "set" -> "/watch/workouts/${operation.sessionId}/sets/${operation.setId}"
            "pause" -> "/watch/workouts/${operation.sessionId}/pause"
            "resume" -> "/watch/workouts/${operation.sessionId}/resume"
            "finish" -> "/watch/workouts/${operation.sessionId}/finish"
            "rest" -> "/watch/workouts/${operation.sessionId}/rest"
            else -> throw IllegalArgumentException("Unknown watch operation")
        }
        return request(path, if (operation.type == "set") "PATCH" else "POST", operation.requestJson)
    }

    override suspend fun revoke() {
        lastActiveEtag = null
        lastActiveResponse = null
        request<Unit>("/watch/session/revoke", "POST", JsonObject())
    }

    override suspend fun flushPendingIntegration() {
        if (!integrationPending) return
        request<Unit>("/watch/integrations/google-health/sync-data", "POST", JsonObject())
        integrationPending = false
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
            if (path.endsWith("/finish")) setRequestProperty("X-Fitness-Integration-Dispatch", "deferred")
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
                if (status == 401) {
                    lastActiveEtag = null
                    lastActiveResponse = null
                }
                val error = runCatching { gson.fromJson(responseText, ApiErrorBody::class.java)?.message }.getOrNull()
                throw ApiFailure(status, error ?: "WorkoutApp could not complete that request.")
            }
            if (connection.getHeaderField("X-Fitness-Integration-Pending") == "1") integrationPending = true
            if (T::class.java == Unit::class.java || responseText.isBlank()) Unit as T
            else gson.fromJson(responseText, T::class.java)
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun requestActive(ifNoneMatch: String?): ActiveWorkoutResponse? = withContext(Dispatchers.IO) {
        val connection = (URL("${baseUrl.trimEnd('/')}/api/watch/active").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 8_000
            readTimeout = 12_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            secureStore.deviceToken().takeIf { secureStore.pendingPairing() == null }
                ?.let { setRequestProperty(DEVICE_TOKEN_HEADER, it) }
            if (ifNoneMatch != null) setRequestProperty("If-None-Match", ifNoneMatch)
        }

        try {
            val status = connection.responseCode
            if (status == 304) {
                return@withContext lastActiveResponse
            }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                if (status == 401) {
                    lastActiveEtag = null
                    lastActiveResponse = null
                }
                val error = runCatching { gson.fromJson(responseText, ApiErrorBody::class.java)?.message }.getOrNull()
                throw ApiFailure(status, error ?: "WorkoutApp could not complete that request.")
            }
            if (connection.getHeaderField("X-Fitness-Integration-Pending") == "1") integrationPending = true
            val parsed = gson.fromJson(responseText, ActiveWorkoutResponse::class.java)
            lastActiveEtag = connection.getHeaderField("ETag")
            lastActiveResponse = parsed
            parsed
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        const val DEVICE_TOKEN_HEADER = "X-Workout-Device-Token"
    }
}
