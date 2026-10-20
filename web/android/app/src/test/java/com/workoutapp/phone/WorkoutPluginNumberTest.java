package com.workoutapp.phone;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class WorkoutPluginNumberTest {
    @Test public void epochMillisecondsThatArriveAsLongAreRead() {
        // org.json parses a timestamp this size as a Long; Capacitor's getDouble returned null for it.
        assertEquals(1_760_920_000_000L, WorkoutPlugin.longOf((Object) 1_760_920_000_000L));
    }

    @Test public void integersAndDoublesAreRead() {
        assertEquals(90_000L, WorkoutPlugin.longOf((Object) 90_000));
        assertEquals(1_760_920_000_123L, WorkoutPlugin.longOf((Object) 1_760_920_000_123.6));
    }

    @Test public void missingOrInvalidValuesReadAsZero() {
        assertEquals(0L, WorkoutPlugin.longOf((Object) null));
        assertEquals(0L, WorkoutPlugin.longOf("123"));
        assertEquals(0L, WorkoutPlugin.longOf((Object) Double.NaN));
    }
}
