package com.workoutapp.phone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.Shadows;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 36)
public class LiveUpdateNotificationAdapterTest {
    private Context context;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        RestAlerts.createChannels(context);
    }

    @After public void clearSetOffer() {
        NotificationSetLogging.publish(null, null);
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

    @Test public void hyperOsKeepsTheIslandToShortTextWhileStockAndroidKeepsTheChronometer() {
        long now = System.currentTimeMillis();
        RestSnapshot training = new RestSnapshot("workout-1", "", RestSnapshot.IDLE, 0, 0, now - 600_000, 0, 0,
                true, true, false, "page", 1);
        assertNull(LiveUpdateNotificationAdapter.build(context, training).getShortCriticalText());
        assertEquals(0, LiveUpdateNotificationAdapter.refreshDelayMs(context, training, now));

        Settings.System.putInt(context.getContentResolver(), "notification_focus_protocol", 3);
        assertEquals("10m", LiveUpdateNotificationAdapter.build(context, training).getShortCriticalText());
        long delay = LiveUpdateNotificationAdapter.refreshDelayMs(context, training, now);
        assertTrue(delay > 0 && delay <= 60_000);
        RestSnapshot paused = new RestSnapshot("workout-1", "", RestSnapshot.IDLE, 0, 0, now - 600_000, now - 1000, 0,
                true, true, false, "page", 1);
        assertEquals("Paused", LiveUpdateNotificationAdapter.build(context, paused).getShortCriticalText());
        assertEquals(0, LiveUpdateNotificationAdapter.refreshDelayMs(context, paused, now));
        // HyperOS does not draw the chronometer in the island, so a rest counts down in the short
        // text, redrawn every second.
        RestSnapshot rest = resting(null);
        String left = LiveUpdateNotificationAdapter.build(context, rest).getShortCriticalText().toString();
        assertTrue(left.equals("1:00") || left.equals("0:59"));
        long restDelay = LiveUpdateNotificationAdapter.refreshDelayMs(context, rest, now);
        assertTrue(restDelay > 0 && restDelay <= 1_020);
        assertEquals("1h 05m", LiveUpdateNotificationAdapter.elapsedShort(65 * 60_000L));
        assertEquals("1:31", LiveUpdateNotificationAdapter.remainingShort(90_001L));
        assertEquals("0:05", LiveUpdateNotificationAdapter.remainingShort(5_000L));
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
        JSONObject v2 = new JSONObject(XiaomiFocus.param(rest, now, null)).getJSONObject("param_v2");
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

    @Test public void theXiaomiRestButtonUsesTheSameBroadcastAsTheAndroidButton() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot rest = resting(null);
        PendingIntent extend = LiveUpdateNotificationAdapter.build(context, rest).actions[1].actionIntent;
        Bundle extras = XiaomiFocus.extras(context, rest, now, extend, null, null);
        JSONObject v2 = new JSONObject(extras.getString(XiaomiFocus.EXTRA_PARAM)).getJSONObject("param_v2");
        String key = v2.getJSONArray("actions").getJSONObject(0).getString("action");
        Notification.Action action = extras.getBundle(XiaomiFocus.EXTRA_ACTIONS)
                .getParcelable(key, Notification.Action.class);
        assertEquals("+30 s", action.title.toString());
        assertEquals(extend, action.actionIntent);
        Intent broadcast = Shadows.shadowOf(action.actionIntent).getSavedIntent();
        assertEquals(RestAction.EXTEND, broadcast.getStringExtra(RestActionReceiver.EXTRA_KIND));
        assertTrue((broadcast.getFlags() & Intent.FLAG_RECEIVER_FOREGROUND) != 0);
    }

    @Test public void aPreviousCardsButtonRetainsItsOriginalRestGeneration() {
        RestSnapshot rest = resting(null);
        PendingIntent previous = LiveUpdateNotificationAdapter.build(context, rest).actions[1].actionIntent;
        PendingIntent current = LiveUpdateNotificationAdapter.build(context, rest.withGeneration("gen-2"))
                .actions[1].actionIntent;
        assertFalse(previous.equals(current));
        assertEquals("gen-1", Shadows.shadowOf(previous).getSavedIntent()
                .getStringExtra(RestActionReceiver.EXTRA_GENERATION));
    }

    @Test public void theXiaomiPayloadCountsUpTheWorkoutLessPausedTime() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot training = new RestSnapshot("workout-1", "", RestSnapshot.IDLE, 0, 0, now - 600_000, 0, 60,
                true, true, false, "page", 1);
        JSONObject timer = new JSONObject(XiaomiFocus.param(training, now, null)).getJSONObject("param_v2")
                .getJSONObject("chatInfo").getJSONObject("timerInfo");
        assertEquals(1, timer.getInt("timerType"));
        assertEquals(now - 540_000, timer.getLong("timerWhen"));
        RestSnapshot paused = new RestSnapshot("workout-1", "gen-1", RestSnapshot.PAUSED, 0, 30_000, now - 600_000, 0, 0,
                true, true, false, "page", 1);
        JSONObject pausedPayload = new JSONObject(XiaomiFocus.param(paused, now, null)).getJSONObject("param_v2");
        assertFalse(pausedPayload.has("actions"));
        JSONObject card = pausedPayload.getJSONObject("chatInfo");
        assertFalse(card.has("timerInfo"));
        assertEquals("30 s left", card.getString("content"));
    }

    @Test public void theLockScreenAndXiaomiCardUseTheSameAvailableSetAction() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot training = resting("Private next set").withRest(RestSnapshot.IDLE, 0, 0, 0);
        publishSet("set-1");
        Notification notification = LiveUpdateNotificationAdapter.build(context, training);
        assertEquals("Bench press · Set 2", notification.publicVersion.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("80 kg × 8", text(notification.publicVersion));
        PendingIntent log = notification.publicVersion.actions[0].actionIntent;
        assertEquals("Log set", notification.publicVersion.actions[0].title.toString());

        Bundle focus = XiaomiFocus.extras(context, training, now, null, NotificationSetLogging.offer(training, now), log);
        JSONObject v2 = new JSONObject(focus.getString(XiaomiFocus.EXTRA_PARAM)).getJSONObject("param_v2");
        assertEquals("80 kg × 8", v2.getJSONObject("chatInfo").getString("content"));
        String key = v2.getJSONArray("actions").getJSONObject(0).getString("action");
        assertEquals(log, focus.getBundle(XiaomiFocus.EXTRA_ACTIONS).getParcelable(key, Notification.Action.class).actionIntent);
        assertEquals("set-1", Shadows.shadowOf(log).getSavedIntent().getStringExtra(NotificationSetLogging.TOKEN));
    }

    @Test public void aSetActionCanBeClaimedOnceAndOnlyFromTheCurrentTrainingCard() throws Exception {
        long now = System.currentTimeMillis();
        RestSnapshot rest = resting(null);
        RestSnapshot training = rest.withRest(RestSnapshot.IDLE, 0, 0, 0);
        publishSet("set-1");
        PendingIntent stale = NotificationSetLogging.offer(training, now).intent(context);
        publishSet("set-2");
        assertFalse(stale.equals(NotificationSetLogging.offer(training, now).intent(context)));
        assertFalse(NotificationSetLogging.claim(training, "set-1", now));
        assertFalse(NotificationSetLogging.claim(rest, "set-2", now));
        assertTrue(NotificationSetLogging.claim(training, "set-2", now));
        publishSet("set-2");
        assertFalse(NotificationSetLogging.claim(training, "set-2", now));
    }

    private static void publishSet(String token) throws Exception {
        NotificationSetLogging.publish("workout-1", new JSONObject()
                .put("token", token).put("title", "Bench press · Set 2").put("values", "80 kg × 8"));
    }
}
