package com.workoutapp.phone;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AndroidRecoveryJourneyTest {
    // The web bundle targets es2022 (Chrome 94); the API 24 google_apis image ships Chrome 52 and
    // cannot run it, so tests that need the page to boot are skipped there, not failed.
    private static final int MIN_BUNDLE_WEBVIEW_MAJOR = 94;

    private static void assumeWebViewRunsTheBundle() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.util.regex.Matcher chrome = java.util.regex.Pattern.compile("Chrome/(\\d+)")
            .matcher(android.webkit.WebSettings.getDefaultUserAgent(context));
        int major = chrome.find() ? Integer.parseInt(chrome.group(1)) : 0;
        org.junit.Assume.assumeTrue("WebView " + major + " cannot run the bundled web app", major >= MIN_BUNDLE_WEBVIEW_MAJOR);
    }

    @Test public void rootBackMinimizesWithoutFinishingTheActivity() throws Exception {
        assumeWebViewRunsTheBundle();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> original = new AtomicReference<>();
            java.lang.reflect.Method hasListeners = com.getcapacitor.Plugin.class.getDeclaredMethod("hasListeners", String.class);
            hasListeners.setAccessible(true);
            java.util.concurrent.atomic.AtomicBoolean ready = new java.util.concurrent.atomic.AtomicBoolean();
            long deadline = SystemClock.elapsedRealtime() + 30000;
            while (!ready.get() && SystemClock.elapsedRealtime() < deadline) {
                scenario.onActivity(activity -> {
                    original.set(activity);
                    try { ready.set((Boolean) hasListeners.invoke(activity.getBridge().getPlugin("App").getInstance(), "backButton")); }
                    catch (Exception failure) { throw new AssertionError(failure); }
                });
                SystemClock.sleep(100);
            }
            assertTrue("The bundled web app installed its Back handler", ready.get());
            // pressBack() throws NoActivityResumedException when the app minimizes, which is the
            // behavior under test.
            androidx.test.espresso.Espresso.pressBackUnconditionally();
            long backgroundDeadline = SystemClock.elapsedRealtime() + 5000;
            while (scenario.getState() == androidx.lifecycle.Lifecycle.State.RESUMED && SystemClock.elapsedRealtime() < backgroundDeadline)
                SystemClock.sleep(100);
            assertFalse(original.get().isFinishing());
            assertNotEquals(androidx.lifecycle.Lifecycle.State.RESUMED, scenario.getState());
            assertNotEquals(androidx.lifecycle.Lifecycle.State.DESTROYED, scenario.getState());
        }
    }
    @Test public void notificationEntryAndActivityRecreationPreserveNativePendingWork() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.workoutapp.phone", context.getPackageName());
        WorkoutRecoveryStore store = WorkoutRecoveryStore.get(context);
        String account = "instrumentation-only";
        store.saveRecovery(account, "instrumentation-session", "{\"fixture\":true}");
        Intent intent = new Intent(context, MainActivity.class).putExtra(MainActivity.EXTRA_WORKOUT_ID, "instrumentation-session");
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(intent)) {
            activity.recreate();
            assertEquals("{\"fixture\":true}", store.getRecovery(account));
        } finally { store.deleteRecovery(account); }
    }

    @Test public void actualRendererTerminationCreatesAFreshWebViewAndPreservesRecovery() throws Exception {
        org.junit.Assume.assumeTrue(Build.VERSION.SDK_INT >= 29);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        WorkoutRecoveryStore store = WorkoutRecoveryStore.get(context);
        store.saveRecovery("renderer-fixture", "renderer-session", "{\"pending\":true}");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> original = new AtomicReference<>();
            CountDownLatch loaded = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                original.set(view);
                view.evaluateJavascript("document.readyState", ignored -> loaded.countDown());
            });
            assertTrue(loaded.await(20, TimeUnit.SECONDS));
            scenario.onActivity(activity -> {
                assertNotNull(original.get().getWebViewRenderProcess());
                assertTrue(original.get().getWebViewRenderProcess().terminate());
            });
            long deadline = SystemClock.elapsedRealtime() + 20000;
            AtomicReference<WebView> restored = new AtomicReference<>(original.get());
            while (restored.get() == original.get() && SystemClock.elapsedRealtime() < deadline) {
                SystemClock.sleep(100);
                try { scenario.onActivity(activity -> restored.set(activity.getBridge().getWebView())); }
                catch (IllegalStateException recreating) { /* Wait for the new activity's RESUMED state. */ }
            }
            assertNotSame(original.get(), restored.get());
            assertEquals("{\"pending\":true}", store.getRecovery("renderer-fixture"));
        } finally { store.deleteRecovery("renderer-fixture"); }
    }
}
