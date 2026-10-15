package com.workoutapp.phone;

import static org.junit.Assert.*;
import org.junit.Test;

public class RendererRecoveryPolicyTest {
    @Test public void oneAutomaticRecreationPerMinute() {
        RendererRecoveryPolicy policy = new RendererRecoveryPolicy();
        assertTrue(policy.allowAutomatic(1000));
        assertFalse(policy.allowAutomatic(1001));
        assertFalse(policy.allowAutomatic(60999));
        assertTrue(policy.allowAutomatic(61000));
    }
}
