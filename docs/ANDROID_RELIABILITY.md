# Android reliability and signed APK distribution

## Retained notification actions

`WorkoutRecoveryStore` stores the timer and each accepted notification action together in SQLite under `noBackupFilesDir`. Action JSON schema 2 carries a UUID, account/session ownership, original occurrence time, source generation and resulting generation. Legacy actions receive identities once on read, in their stored order; ambiguous ownership is discarded. Invalid unreadable action JSON fails closed rather than being replaced by an empty list.

`readRestActions` is non-destructive. `importRestActions` compares the exact serialized recovery revision and, in one SQLite transaction, replaces recovery and removes only the selected action IDs. A stale revision changes neither record. JavaScript retries inside the same account serializer used by ordinary recovery writes. Pending conflicts and unavailable baselines retain actions and report a retry warning.

Projection starts from durable recovery, never from the native notification snapshot which already includes the changes. The action UUID becomes the existing outbox/server mutation identity; the original time and resulting generation travel through the existing rest endpoint. The visible timer and notification are synchronized only after the import commits. Replaced rests and finished workouts are explicitly superseded. Stopping the notification on an account switch preserves actions; deleting that account's workout recovery clears its actions atomically. There is no pending-action count eviction.

On startup, pending recovery's committed rest overrides the advisory local timer snapshot before native synchronization. A crash after import but before the display/localStorage write therefore restores the committed absolute deadline without applying the delta again.

## Xiaomi Back Display test

On HyperOS devices that grant Workout Focus notification access, the active rest's Focus card requests one **+30 s** button. It sends the same generation-scoped broadcast as the Android notification button. HyperOS determines where the Focus card and its buttons appear.

While the active logger is open, **Log set** is automatically available for the first unlogged rep set with valid values on the selected exercise. The Android notification and Xiaomi Focus card both show the set values alongside the same single-use action, including on the lock screen where the system shows the notification. The action waits until rest ends and uses the logger's durable save before starting the next rest. Timed sets use the regular logger. Offers expire when the logger closes or the app process is lost. A tap that cannot reach the page promptly is ignored.

1. Install the test APK on a Xiaomi 18 Pro or 18 Pro Max. In Workout Settings, check that notifications and Super Island are enabled. Enable Back Display notifications and activities in the phone settings if available.
2. Start a workout with a rest of at least 60 seconds and log the first set. Check for the countdown and **+30 s** in the expanded Super Island while the front screen is on.
3. Lock the phone and wake the Back Display. Record whether it shows the countdown and whether it offers **+30 s**. If the button appears, tap it once. The timer should gain about 30 seconds without opening the app. Reopen Workout and check that its timer agrees.
4. Keep the workout logger open and leave a set with reps ready. After rest, check the displayed exercise, set, load and reps in the Android notification, then on the rear screen with the phone locked.
5. Tap **Log set** on the rear display and check that the shown set completes once and that its rest starts, if prescribed, without opening the front screen. Repeat with the phone offline, then check the logger and confirm sync after reconnecting. Verify that an old button cannot log a set after its inputs change, and that pausing, finishing or closing the logger removes the offer.
6. Record the model, region, HyperOS build, and which displays actually accepted the tap. A visible rear countdown confirms display only.

## Renderer and Back recovery

The activity handles renderer termination separately from network errors. It detaches and destroys the terminated WebView, then recreates a fresh Capacitor activity. Account cookies, IndexedDB, SQLite and queued operations are retained. The workout foreground service and deadline alarm are independent of the display. One automatic recreation is allowed per 60 seconds within the application process; another termination shows a native Retry screen. This is not recovery from Android force-stop or whole-process death.

Native Back consumes app-owned history and top sheets. At the document root it calls `App.minimizeApp()`, preserving the activity and workout. A new document establishes its own history boundary so authentication and notification entry cannot reopen obsolete WebView entries.

## Installed version

Settings end with an About card naming the web version and, in the Android app, the APK version and build. There is no in-app diagnostics disclosure or update check.

## APK update channels

The embedded channels are `device-test` for debug APKs and `release` for release APKs. Keep their existing signing keys unchanged. The application ID is `com.workoutapp.phone`.

Each channel uses a manual GitHub Release tag:

- `android-device-test`: device-test APK and `android-release.json`.
- `android-release`: release APK and `android-release.json`.

The installed app does not read this metadata; updates are installed from the release page by hand, and uninstalling is never an update path.

Manifest schema 1 fields are `schemaVersion`, `applicationId`, `channel`, `versionName`, `versionCode`, `apkUrl`, `apkSha256`, `signingCertificateSha256`, and `publishedAt`. CI adds `sourceCommit` and `sourceDirty` for traceability.

CI builds and tests signed release APKs alongside AABs. Set `ANDROID_RELEASE_SIGNING_CERT_SHA256` to the existing release certificate fingerprint; the existing device-test fingerprint remains `ANDROID_DEBUG_SIGNING_CERT_SHA256`. The generator verifies the actual APK certificate, package/version and embedded channel, then hashes that exact APK. A missing fingerprint fails the release artifact gate. CI uploads draft artifacts only; publication is a separate manual action after acceptance and explicit authorization.

## Verification and release acceptance

Run frontend typecheck, standards/docs checks, full tests/build, visual tests and responsive tests. Sync the tested web bundle to Capacitor, compare bundled asset hashes, then run Android lint, JVM tests, instrumented tests and APK signature/package inspection. The CI instrumentation matrix covers API 24, 33 and 36; actual renderer termination is available from API 29 and is skipped on API 24, whose stock WebView (Chrome 52) cannot run the es2022 bundle, so the root-Back test is skipped there too.

Record automated, emulator, physical-device, provider and Wear evidence separately. Browser native-bridge fixtures validate UI contracts, not Android providers. Local emulator APKs signed with a temporary/default debug key are test artifacts, not an in-place upgrade candidate for an installation using another key.

Physical acceptance remains required before publication:

- Record phone model, Android/OEM build, APK version/code and certificate SHA-256.
- Run 30 consecutive short rests with locked-screen actions, sound/vibration and permissions changed mid-session.
- Test process loss, reboot, force-stop/reopen and phone/Wear reconciliation. Delivery after force-stop is not required.
- Verify offline edits, airplane-mode cold launch, keyboard/insets, gesture and three-button Back separately.
- Upgrade in place using the same installed signing identity and confirm that pending work survives.

Google Play distribution, authentication redesign, widgets, Health Connect and new background sync services are outside this work.
