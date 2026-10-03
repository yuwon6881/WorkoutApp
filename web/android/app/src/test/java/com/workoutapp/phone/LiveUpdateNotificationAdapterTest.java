package com.workoutapp.phone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.content.Context;
import android.provider.Settings;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public class LiveUpdateNotificationAdapterTest {
    private Context context;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        RestAlerts.createChannels(context);
    }

    private static RestSnapshot resting(String nextUp) {
        long now = System.currentTimeMillis();
        return new RestSnapshot("workout-1", "gen-1", RestSnapshot.RUNNING, now + 60_000, 0, now - 600_000, 0, 0,
                true, true, false, "page", 1, 90_000, nextUp);
    }

    private static String text(Notification notification) {
        CharSequence value = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
        return value == null ? null : value.toString();
    }

    @Test public void aRunningRestCountsDownInTheChipAndOffersRestButtons() {
        Notification notification = LiveUpdateNotificationAdapter.build(context, resting(null));
        assertTrue(notification.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN));
        // A short critical text would replace the countdown in the status-bar chip.
        assertNull(notification.getShortCriticalText());
        assertEquals(3, notification.actions.length);
        assertEquals("−30 s", notification.actions[0].title.toString());
        assertEquals("+30 s", notification.actions[1].title.toString());
        assertEquals("Skip", notification.actions[2].title.toString());
        assertEquals(Notification.ProgressStyle.class.getName(), notification.extras.getString(Notification.EXTRA_TEMPLATE));
        // Notification.EXTRA_REQUEST_PROMOTED_ONGOING is hidden from the public SDK.
        assertTrue(notification.extras.getBoolean("android.requestPromotedOngoing"));
    }

    @Test public void theNextSetIsPrivateAndTheLockScreenVersionStaysGeneric() {
        Notification notification = LiveUpdateNotificationAdapter.build(context, resting("Bench press · set 2 · 80 kg × 8"));
        assertEquals(Notification.VISIBILITY_PRIVATE, notification.visibility);
        assertEquals("Next: Bench press · set 2 · 80 kg × 8", text(notification));
        assertNotNull(notification.publicVersion);
        assertEquals("Rest ends at the countdown.", text(notification.publicVersion));
        // The lock screen keeps the rest buttons.
        assertEquals(3, notification.publicVersion.actions.length);
    }

    @Test public void withoutANextSetTheWholeNotificationIsPublic() {
        Notification notification = LiveUpdateNotificationAdapter.build(context, resting(null));
        assertEquals(Notification.VISIBILITY_PUBLIC, notification.visibility);
        assertNull(notification.publicVersion);
    }

    @Test public void trainingAndPausedStatesHaveNoRestButtons() {
        long now = System.currentTimeMillis();
        RestSnapshot training = new RestSnapshot("workout-1", "", RestSnapshot.IDLE, 0, 0, now - 600_000, 0, 0,
                true, true, false, "page", 1);
        Notification notification = LiveUpdateNotificationAdapter.build(context, training);
        assertEquals(1, notification.actions.length);
        assertEquals("Return to workout", notification.actions[0].title.toString());
        assertFalse(LiveUpdateNotificationAdapter.needsProgressRefresh(training, now));
        RestSnapshot paused = new RestSnapshot("workout-1", "gen-1", RestSnapshot.PAUSED, 0, 30_000, now - 600_000, 0, 0,
                true, true, false, "page", 1);
        assertNull(LiveUpdateNotificationAdapter.build(context, paused).actions);
    }

    @Test public void onlyARunningRestOfKnownLengthNeedsTheBarRedrawn() {
        long now = System.currentTimeMillis();
        assertTrue(LiveUpdateNotificationAdapter.needsProgressRefresh(resting(null), now));
        RestSnapshot unknownLength = new RestSnapshot("workout-1", "gen-1", RestSnapshot.RUNNING, now + 60_000, 0, now, 0, 0,
                true, true, false, "page", 1);
        assertFalse(LiveUpdateNotificationAdapter.needsProgressRefresh(unknownLength, now));
    }

    @Test public void otherPhonesCarryNoXiaomiExtras() {
        assertEquals(XiaomiFocus.STATUS_UNSUPPORTED, XiaomiFocus.status(context));
        assertNull(LiveUpdateNotificationAdapter.build(context, resting(null)).extras.getString(XiaomiFocus.EXTRA_PARAM));
    }

    @Test public void aXiaomiPhoneWithoutFocusPermissionGetsTheStandardNotification() {
        Settings.System.putInt(context.getContentResolver(), "notification_focus_protocol", 3);
        // Robolectric has no HyperOS permission provider, which reads as "not allowed".
        assertEquals(XiaomiFocus.STATUS_OFF, XiaomiFocus.status(context));
        assertNull(LiveUpdateNotificationAdapter.build(context, resting(null)).extras.getString(XiaomiFocus.EXTRA_PARAM));
    }

    @Test public void theXiaomiPayloadCountsDownTheRestWithoutTheNextSet() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot rest = resting("Bench press · set 2");
        JSONObject v2 = new JSONObject(XiaomiFocus.param(rest, now)).getJSONObject("param_v2");
        assertEquals("Resting", v2.getString("ticker"));
        JSONObject timer = v2.getJSONObject("param_island").getJSONObject("bigIslandArea")
                .getJSONObject("sameWidthDigitInfo").getJSONObject("timerInfo");
        assertEquals(-1, timer.getInt("timerType"));
        assertEquals(rest.deadlineMs, timer.getLong("timerWhen"));
        assertEquals(rest.deadlineMs - now, timer.getLong("timerTotal"));
        assertEquals(now, timer.getLong("timerSystemCurrent"));
        assertEquals(XiaomiFocus.PIC_REST, v2.getJSONObject("param_island").getJSONObject("smallIslandArea")
                .getJSONObject("picInfo").getString("pic"));
        assertFalse(v2.toString().contains("Bench"));
    }

    @Test public void theXiaomiPayloadCountsUpTheWorkoutLessPausedTime() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot training = new RestSnapshot("workout-1", "", RestSnapshot.IDLE, 0, 0, now - 600_000, 0, 60,
                true, true, false, "page", 1);
        JSONObject timer = new JSONObject(XiaomiFocus.param(training, now)).getJSONObject("param_v2")
                .getJSONObject("chatInfo").getJSONObject("timerInfo");
        assertEquals(1, timer.getInt("timerType"));
        assertEquals(now - 540_000, timer.getLong("timerWhen"));
        RestSnapshot paused = new RestSnapshot("workout-1", "gen-1", RestSnapshot.PAUSED, 0, 30_000, now - 600_000, 0, 0,
                true, true, false, "page", 1);
        JSONObject card = new JSONObject(XiaomiFocus.param(paused, now)).getJSONObject("param_v2").getJSONObject("chatInfo");
        assertFalse(card.has("timerInfo"));
        assertEquals("30 s left", card.getString("content"));
    }
}
