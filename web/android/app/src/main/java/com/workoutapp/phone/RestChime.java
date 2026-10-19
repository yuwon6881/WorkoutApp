package com.workoutapp.phone;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.atomic.AtomicBoolean;

/// The rest chime, played as a short spoken-prompt style cue rather than as a notification sound.
/// A notification sound plays at the ringer's volume, is silenced whenever the phone is on
/// vibrate or silent (which is how most phones sit in a gym), and HyperOS may drop it for apps it
/// files as unimportant. A navigation-guidance cue plays at the media volume, through the same
/// headphones as the music, and briefly ducks whatever is playing, the way a running app's voice
/// prompts do. The app's own Sound switch turns it off, and Do Not Disturb still silences it.
final class RestChime {
    // The chime lasts under a second; this only guarantees focus and the player are released.
    private static final long RELEASE_AFTER_MS = 4000L;

    private RestChime() {}

    static AudioAttributes attributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
    }

    /// Plays the chime once and calls `done` when it has finished or could not play.
    static void play(Context context, Runnable done) {
        Context app = context.getApplicationContext();
        AudioManager audio = app.getSystemService(AudioManager.class);
        AudioAttributes attributes = attributes();
        MediaPlayer player;
        try {
            player = audio == null ? null
                    : MediaPlayer.create(app, R.raw.rest_chime, attributes, audio.generateAudioSessionId());
        } catch (RuntimeException e) {
            player = null;
        }
        if (player == null) {
            done.run();
            return;
        }
        Object focus = requestFocus(audio, attributes);
        AtomicBoolean finished = new AtomicBoolean(false);
        MediaPlayer playing = player;
        Runnable finish = () -> {
            if (finished.getAndSet(true)) return;
            try { playing.release(); } catch (RuntimeException ignored) { /* already released */ }
            abandonFocus(audio, focus);
            done.run();
        };
        player.setOnCompletionListener(p -> finish.run());
        player.setOnErrorListener((p, what, extra) -> {
            finish.run();
            return true;
        });
        new Handler(Looper.getMainLooper()).postDelayed(finish, RELEASE_AFTER_MS);
        try {
            player.start();
        } catch (RuntimeException e) {
            finish.run();
        }
    }

    // Transient ducking: music lowers under the chime and comes straight back, never pauses.
    private static Object requestFocus(AudioManager audio, AudioAttributes attributes) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attributes)
                    .build();
            audio.requestAudioFocus(request);
            return request;
        }
        AudioManager.OnAudioFocusChangeListener listener = change -> { };
        audio.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        return listener;
    }

    private static void abandonFocus(AudioManager audio, Object focus) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focus instanceof AudioFocusRequest) {
            audio.abandonAudioFocusRequest((AudioFocusRequest) focus);
        } else if (focus instanceof AudioManager.OnAudioFocusChangeListener) {
            audio.abandonAudioFocus((AudioManager.OnAudioFocusChangeListener) focus);
        }
    }
}
