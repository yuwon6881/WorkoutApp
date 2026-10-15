package com.workoutapp.phone;

/** Process-local guard: activity recreation keeps it; full process death starts a separate recovery. */
final class RendererRecoveryPolicy {
    private long lastAutomaticAt = -1;

    synchronized boolean allowAutomatic(long elapsedMs) {
        if (lastAutomaticAt >= 0 && elapsedMs - lastAutomaticAt < 60000) return false;
        lastAutomaticAt = elapsedMs;
        return true;
    }
}
