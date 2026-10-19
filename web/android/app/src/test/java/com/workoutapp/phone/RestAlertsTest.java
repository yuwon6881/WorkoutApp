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
        // The chime is the app's own, so a blocked channel does not silence it.
        assertTrue(RestAlerts.restSoundEnabled(context));
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

    @Test public void theChannelIsSilentBecauseTheAppPlaysTheChime() {
        RestAlerts.createChannels(context);
        NotificationChannel channel = manager.getNotificationChannel(RestAlerts.CHANNEL_ALERT);
        assertNull(channel.getSound());
        assertEquals(NotificationManager.IMPORTANCE_HIGH, channel.getImportance());
        // The channels that played the chime as their own sound are gone.
        assertNull(manager.getNotificationChannel("workout_rest_complete"));
    }

    @Test public void theChimePlaysInSilentModeButNotUnderDoNotDisturb() {
        RestAlerts.createChannels(context);
        AudioManager audio = context.getSystemService(AudioManager.class);
        audio.setRingerMode(AudioManager.RINGER_MODE_SILENT);
        manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
        assertTrue(RestAlerts.chimeAllowed(context));
        manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
        assertFalse(RestAlerts.chimeAllowed(context));
        assertFalse(RestAlerts.restSoundEnabled(context));
    }

    @Test public void anAlertWithoutChimeReportsDoneAtOnce() {
        RestAlerts.createChannels(context);
        boolean[] done = {false};
        RestAlerts.post(context, "session", false, false, false, () -> done[0] = true);
        assertTrue(done[0]);
        assertEquals(0, manager.getActiveNotifications().length);
    }
}
