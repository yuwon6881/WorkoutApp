package com.workoutapp.phone;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/// Shown when the app's pages cannot load (no connection) while a workout is saved on this phone.
/// It only reads: the saved sets, the edits still waiting to sync, the workout's elapsed time, and
/// the rest countdown. Retry reopens the app, which picks the saved work up where it left off.
public class WorkoutOfflineRecoveryActivity extends AppCompatActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView clock;
    private RestSnapshot snapshot;

    static boolean hasSavedWorkout(Context context) {
        WorkoutRecoveryStore store = WorkoutRecoveryStore.get(context);
        String accountId = store.getLastAccountId();
        return accountId != null && store.getRecovery(accountId) != null;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WorkoutRecoveryStore store = WorkoutRecoveryStore.get(this);
        String accountId = store.getLastAccountId();
        String json = accountId == null ? null : store.getRecovery(accountId);
        snapshot = store.getRestSnapshot();

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(ContextCompat.getColor(this, R.color.ayu_bg));
        int pad = Math.round(24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad, pad, pad);

        layout.addView(text("Your workout is saved on this phone", 20, R.color.ayu_text));
        layout.addView(text(summary(json), 15, R.color.ayu_muted));
        clock = text("", 15, R.color.ayu_text);
        layout.addView(clock);
        layout.addView(text("The app needs a connection to open. Nothing saved here is changed or discarded.", 13, R.color.ayu_muted));

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setTextColor(ContextCompat.getColor(this, R.color.ayu_bg));
        retry.setBackgroundColor(ContextCompat.getColor(this, R.color.ayu_accent));
        retry.setMinHeight(Math.round(48 * getResources().getDisplayMetrics().density));
        retry.setOnClickListener(view -> {
            startActivity(new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
        });
        layout.addView(retry);
        setContentView(layout);
    }

    @Override
    protected void onResume() {
        super.onResume();
        tick();
    }

    @Override
    protected void onPause() {
        handler.removeCallbacksAndMessages(null);
        super.onPause();
    }

    private void tick() {
        long now = System.currentTimeMillis();
        String line = "";
        if (snapshot != null && snapshot.isRunning() && snapshot.deadlineMs > now) {
            line = "Rest: " + duration(snapshot.deadlineMs - now) + " left";
        } else if (snapshot != null && snapshot.isPaused()) {
            line = "Rest paused: " + duration(snapshot.pausedRemainingMs) + " left";
        } else if (snapshot != null && snapshot.startedAtMs > 0) {
            long end = snapshot.pausedAtMs > 0 ? snapshot.pausedAtMs : now;
            line = "Workout time: " + duration(end - snapshot.startedAtMs - snapshot.pausedSeconds * 1000L);
        }
        clock.setText(line);
        handler.postDelayed(this::tick, 1000);
    }

    private String summary(String json) {
        if (json == null) return "";
        try {
            JSONObject root = new JSONObject(json);
            JSONObject draft = root.optJSONObject("draft");
            JSONArray exercises = draft == null ? null : draft.optJSONArray("exercises");
            int done = 0;
            for (int i = 0; exercises != null && i < exercises.length(); i++) {
                JSONArray sets = exercises.optJSONObject(i) == null ? null : exercises.optJSONObject(i).optJSONArray("sets");
                for (int j = 0; sets != null && j < sets.length(); j++) if (sets.optJSONObject(j).optBoolean("done")) done++;
            }
            JSONArray operations = root.optJSONArray("operations");
            int pending = operations == null ? 0 : operations.length();
            String sets = done == 1 ? "1 set completed" : done + " sets completed";
            String sync = pending == 0 ? "Everything is synced." : pending == 1 ? "1 change waiting to sync." : pending + " changes waiting to sync.";
            return sets + "\n" + sync;
        } catch (Exception e) {
            return "";
        }
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(ContextCompat.getColor(this, color));
        view.setGravity(Gravity.CENTER);
        int pad = Math.round(8 * getResources().getDisplayMetrics().density);
        view.setPadding(0, pad, 0, pad);
        return view;
    }

    private static String duration(long ms) {
        long seconds = Math.max(0, ms / 1000);
        return seconds >= 3600
                ? String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
                : String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }
}
