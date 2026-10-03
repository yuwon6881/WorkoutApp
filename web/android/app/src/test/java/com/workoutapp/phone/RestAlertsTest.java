package com.workoutapp.phone;

import static org.junit.Assert.*;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioManager;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class RestAlertsTest {
    private Context context;
    private NotificationManager manager;

    @Before public void setUp() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(NotificationManager.class);
    }

    @Test public void readyChannelReportsSoundAndDelivery() {
        RestAlerts.createChannels(context);
        assertTrue(RestAlerts.restChannelEnabled(context));
        assertTrue(RestAlerts.restSoundEnabled(context));
    }

    @Test public void blockedChannelDoesNotReportReadyOrPost() {
        manager.createNotificationChannel(new NotificationChannel(RestAlerts.CHANNEL_ALERT, "Blocked", NotificationManager.IMPORTANCE_NONE));
        assertTrue(RestAlerts.notificationsEnabled(context));
        assertFalse(RestAlerts.restChannelEnabled(context));
        assertFalse(RestAlerts.restSoundEnabled(context));
        RestAlerts.post(context, "session", true, false);
        assertEquals(0, manager.getActiveNotifications().length);
    }

    @Test public void vibrationFollowsSilentModeAndDoNotDisturb() {
        RestAlerts.createChannels(context);
        AudioManager audio = context.getSystemService(AudioManager.class);
        audio.setRingerMode(AudioManager.RINGER_MODE_NORMAL);
        manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
        assertTrue(RestAlerts.vibrationAllowed(context));
        audio.setRingerMode(AudioManager.RINGER_MODE_SILENT);
        assertFalse(RestAlerts.vibrationAllowed(context));
        audio.setRingerMode(AudioManager.RINGER_MODE_VIBRATE);
        assertTrue(RestAlerts.vibrationAllowed(context));
        manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        assertFalse(RestAlerts.vibrationAllowed(context));
    }

    @Test public void aNewRestClearsTheLastFinishedAlert() {
        RestAlerts.createChannels(context);
        RestAlerts.post(context, "session", true, false);
        assertEquals(1, manager.getActiveNotifications().length);
        RestAlerts.clearFinished(context);
        assertEquals(0, manager.getActiveNotifications().length);
    }

    @Test public void silentChannelCanDeliverWithoutReportingSound() {
        NotificationChannel channel = new NotificationChannel(RestAlerts.CHANNEL_ALERT, "Silent", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
        assertTrue(RestAlerts.restChannelEnabled(context));
        assertFalse(RestAlerts.restSoundEnabled(context));
    }
}
