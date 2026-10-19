package com.workoutapp.phone;

import android.app.Activity;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

final class RendererRecovery {
    private static final RendererRecoveryPolicy POLICY = new RendererRecoveryPolicy();

    static boolean handle(Activity activity, WebView view) {
        // The terminated renderer cannot be reused. Storage and the workout service are independent.
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
        view.destroy();
        if (POLICY.allowAutomatic(SystemClock.elapsedRealtime())) {
            activity.recreate();
        } else {
            LinearLayout layout = new LinearLayout(activity);
            layout.setOrientation(LinearLayout.VERTICAL);
            layout.setGravity(Gravity.CENTER);
            int padding = Math.round(24 * activity.getResources().getDisplayMetrics().density);
            layout.setPadding(padding, padding, padding, padding);
            TextView message = new TextView(activity);
            message.setText("The app display stopped again. Your saved work remains on this device.");
            Button retry = new Button(activity);
            retry.setText("Retry");
            retry.setOnClickListener(ignored -> activity.recreate());
            layout.addView(message);
            layout.addView(retry);
            activity.setContentView(layout);
            if (activity instanceof androidx.activity.ComponentActivity) {
                androidx.activity.ComponentActivity owner = (androidx.activity.ComponentActivity) activity;
                owner.getOnBackPressedDispatcher().addCallback(owner, new androidx.activity.OnBackPressedCallback(true) {
                    @Override public void handleOnBackPressed() { activity.moveTaskToBack(true); }
                });
            }
            message.announceForAccessibility(message.getText());
        }
        return true;
    }
}
