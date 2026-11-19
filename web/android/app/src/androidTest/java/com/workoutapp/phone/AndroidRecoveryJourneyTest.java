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

    @Test public void setNotificationBroadcastReachesTheOpenWebViewOnce() throws Exception {
        assumeWebViewRunsTheBundle();
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            assertTrue(awaitPageResult(scenario, "Boolean(window.Capacitor?.nativeCallback)", "true"));
            String sessionId = "instrumentation-set-session";
            String token = "instrumentation-set-token";
            evaluate(scenario, """
                    window.setNotificationTaps = [];
                    Capacitor.nativeCallback('WorkoutPlugin', 'addListener', { eventName: 'logSet' },
                        tap => window.setNotificationTaps.push(tap.token));
                    Capacitor.nativePromise('WorkoutPlugin', 'syncWorkout', {
                        sessionId: 'instrumentation-set-session', epoch: 'instrumentation-set-page',
                        sequence: 1, setCard: { token: 'instrumentation-set-token', title: 'Bench · Set 1', values: '60 kg × 8' }
                    }).then(() => { window.setNotificationReady = true; });
                    """);
            assertTrue(awaitPageResult(scenario, "window.setNotificationReady", "true"));
            RestSnapshot snapshot = WorkoutRecoveryStore.get(context).getRestSnapshot();
            assertNotNull(snapshot);
            assertEquals(sessionId, snapshot.sessionId);
            NotificationSetLogging.Card card = NotificationSetLogging.offer(snapshot, System.currentTimeMillis());
            assertNotNull(card);
            card.intent(context).send();
            card.intent(context).send();
            assertTrue(awaitPageResult(scenario, "window.setNotificationTaps.length", "1"));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertEquals("\"" + token + "\"", evaluate(scenario, "window.setNotificationTaps.join(',')"));
        } finally {
            NotificationSetLogging.publish(null, null);
            WorkoutRecoveryStore.get(context).clearRestSnapshot();
            WorkoutForegroundService.stop(context);
        }
    }

    private static boolean awaitPageResult(ActivityScenario<MainActivity> scenario, String script, String expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15_000;
        do {
            if (expected.equals(evaluate(scenario, script))) return true;
            SystemClock.sleep(100);
        } while (SystemClock.elapsedRealtime() < deadline);
        return false;
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue(done.await(5, TimeUnit.SECONDS));
        return value.get();
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
