package com.workoutapp.phone;

import android.app.ForegroundServiceStartNotAllowedException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

/// The web app's only route to the workout store and service (through lib/platform.ts). Every
/// failure is reported to the caller; nothing here claims an alert will arrive because it was
/// scheduled.
@CapacitorPlugin(name = "WorkoutPlugin")
public class WorkoutPlugin extends Plugin {
    private volatile String lastServiceError;

    @PluginMethod
    public void getRecoveryRecord(PluginCall call) {
        String json = store().getRecovery(call.getString("accountId"));
        JSObject result = new JSObject();
        // JSONObject drops a null value; the page expects an explicit null for "nothing saved".
        result.put("recordJson", json == null ? JSONObject.NULL : json);
        call.resolve(result);
    }

    @PluginMethod
    public void saveRecoveryRecord(PluginCall call) {
        String accountId = call.getString("accountId");
        String recordJson = call.getString("recordJson");
        if (accountId == null || recordJson == null) { call.reject("A saved workout needs an account and a record.", "invalid_record"); return; }
        store().saveRecovery(accountId, call.getString("sessionId"), recordJson);
        call.resolve();
    }

    @PluginMethod
    public void deleteRecoveryRecord(PluginCall call) {
        store().deleteRecovery(call.getString("accountId"));
        call.resolve();
    }

    @PluginMethod
    public void getLastAccountId(PluginCall call) {
        String accountId = store().getLastAccountId();
        JSObject result = new JSObject();
        result.put("accountId", accountId == null ? JSONObject.NULL : accountId);
        call.resolve(result);
    }

    @PluginMethod
    public void setLastAccountId(PluginCall call) {
        store().setLastAccountId(call.getString("accountId"));
        call.resolve();
    }

    @PluginMethod
    public void claimRestAlert(PluginCall call) {
        JSObject result = new JSObject();
        result.put("claimed", store().claimRestAlert(call.getString("sessionId"), call.getString("generation")));
        call.resolve(result);
    }

    @PluginMethod
    public void syncWorkout(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) { call.reject("The workout is missing.", "invalid_state"); return; }
        RestSnapshot snapshot = new RestSnapshot(
                sessionId,
                call.getString("generation", ""),
                call.getString("status", RestSnapshot.IDLE),
                longOf(call, "deadlineMs"),
                longOf(call, "pausedRemainingMs"),
                longOf(call, "startedAtMs"),
                longOf(call, "pausedAtMs"),
                longOf(call, "pausedSeconds"),
                Boolean.TRUE.equals(call.getBoolean("alert", false)),
                Boolean.TRUE.equals(call.getBoolean("sound", true)),
                Boolean.TRUE.equals(call.getBoolean("vibrate", false)),
                call.getString("epoch", ""),
                longOf(call, "sequence"));
        // An older write from this page arrived after a newer one: the newer intent stands.
        if (!store().saveRestSnapshotIfNewer(snapshot)) { call.resolve(); return; }
        // The alarm does not depend on the service, so a rest alerts even if the service is refused.
        RestSchedule.apply(getContext(), snapshot);
        try {
            WorkoutForegroundService.start(getContext());
            lastServiceError = null;
            call.resolve();
        } catch (RuntimeException failure) {
            boolean refused = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && failure instanceof ForegroundServiceStartNotAllowedException;
            lastServiceError = refused
                    ? "Android did not allow the workout notification to start in the background. It returns when the app is open."
                    : "The workout notification could not start.";
            call.reject(lastServiceError, refused ? "fgs_not_allowed" : "fgs_failed");
        }
    }

    @PluginMethod
    public void stopWorkout(PluginCall call) {
        store().clearRestSnapshot();
        RestSchedule.cancel(getContext());
        WorkoutForegroundService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getAlertCapabilities(PluginCall call) {
        Context context = getContext();
        boolean batteryExempt = false;
        PowerManager power = context.getSystemService(PowerManager.class);
        if (power != null) batteryExempt = power.isIgnoringBatteryOptimizations(context.getPackageName());
        JSObject result = new JSObject();
        result.put("exactAlarm", RestSchedule.canScheduleExact(context));
        result.put("notifications", RestAlerts.notificationsEnabled(context));
        result.put("batteryExempt", batteryExempt);
        result.put("liveUpdates", LiveUpdateNotificationAdapter.canPromote(context));
        result.put("serviceError", lastServiceError == null ? JSONObject.NULL : lastServiceError);
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String type = call.getString("type", "app");
        Context context = getContext();
        Intent intent = new Intent();
        if ("exact_alarm".equals(type) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent.setAction(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).setData(Uri.parse("package:" + context.getPackageName()));
        } else if ("notifications".equals(type) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else if ("battery".equals(type)) {
            intent.setAction(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        } else {
            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:" + context.getPackageName()));
        }
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(intent);
            call.resolve();
        } catch (RuntimeException failure) {
            call.reject("These settings are not available on this phone.", "settings_unavailable");
        }
    }

    @PluginMethod
    public void testAlert(PluginCall call) {
        RestSchedule.scheduleTest(getContext(), Boolean.TRUE.equals(call.getBoolean("sound", true)),
                Boolean.TRUE.equals(call.getBoolean("vibrate", false)));
        call.resolve();
    }

    private WorkoutRecoveryStore store() {
        return WorkoutRecoveryStore.get(getContext());
    }

    private static long longOf(PluginCall call, String key) {
        Double value = call.getDouble(key);
        return value == null || value.isNaN() ? 0L : value.longValue();
    }
}
