package com.workoutapp.wear.data

object RirPolicy {
    val choices = listOf("0", "1", "2", "3", "4", "5+")

    fun normalize(value: String?, warmup: Boolean): String? = when {
        warmup -> null
        value == null -> null
        value in choices -> value
        else -> throw IllegalArgumentException("Choose an RIR from 0 to 4 or 5+.")
    }

    fun toRpe(value: String?): Double? = when (value) {
        "0", "1", "2", "3", "4" -> 10.0 - value.toInt()
        null, "5+" -> null
        else -> throw IllegalArgumentException("Choose an RIR from 0 to 4 or 5+.")
    }
}
