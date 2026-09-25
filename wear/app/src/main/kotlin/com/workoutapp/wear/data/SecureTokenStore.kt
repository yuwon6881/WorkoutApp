package com.workoutapp.wear.data

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureTokenStore(context: Context) {
    private val preferences = context.getSharedPreferences("workout-wear-private", Context.MODE_PRIVATE)
    private val securePreferences = context.getSharedPreferences("workout-wear-secure", Context.MODE_PRIVATE)

    fun deviceId(): String = preferences.getString("device-id", null) ?: UUID.randomUUID().toString().also {
        preferences.edit().putString("device-id", it).apply()
    }

    fun deviceName(): String = (Build.MODEL ?: Build.PRODUCT ?: "Wear OS watch").take(120)

    fun deviceToken(): String = readSecret("device-token") ?: ByteArray(32).let { bytes ->
        SecureRandom().nextBytes(bytes)
        android.util.Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            .also { check(saveSecret("device-token", it)) { "Could not store the watch session securely." } }
    }

    fun hasStoredDeviceToken(): Boolean = readSecret("device-token") != null

    fun isDevicePaired(): Boolean = preferences.getBoolean("paired", false) && hasStoredDeviceToken()

    fun markPaired() {
        check(preferences.edit().putBoolean("paired", true).commit()) { "Could not save watch pairing state." }
    }

    fun savePendingPairing(pairingId: String, code: String, expiresAt: String) {
        preferences.edit().putString("pairing-id", pairingId).putString("pairing-code", code)
            .putString("pairing-expires", expiresAt).commit()
    }

    fun pendingPairing(): Triple<String, String, String>? {
        val id = preferences.getString("pairing-id", null) ?: return null
        val code = preferences.getString("pairing-code", null) ?: return null
        val expires = preferences.getString("pairing-expires", null) ?: return null
        return Triple(id, code, expires)
    }

    fun clearPendingPairing() {
        preferences.edit().remove("pairing-id").remove("pairing-code").remove("pairing-expires").apply()
    }

    fun clearToken() {
        clearDeviceSession()
    }

    fun clearDeviceSession() {
        securePreferences.edit().remove("device-token").remove("device-token-iv").commit()
        preferences.edit().putBoolean("paired", false).commit()
    }

    private fun saveSecret(name: String, value: String): Boolean {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return securePreferences.edit()
            .putString(name, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString("$name-iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .commit()
    }

    private fun readSecret(name: String): String? {
        val encrypted = securePreferences.getString(name, null) ?: return null
        val iv = securePreferences.getString("$name-iv", null) ?: return null
        return runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build())
        return generator.generateKey()
    }

    companion object {
        private const val KEY_ALIAS = "workout-wear-session-v1"
    }
}
