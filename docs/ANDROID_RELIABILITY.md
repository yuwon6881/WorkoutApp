# Android reliability and signed APK distribution

## Retained notification actions

`WorkoutRecoveryStore` stores the timer and each accepted notification action together in SQLite under `noBackupFilesDir`. Action JSON schema 2 carries a UUID, account/session ownership, original occurrence time, source generation and resulting generation. Legacy actions receive identities once on read, in their stored order; ambiguous ownership is discarded. Invalid unreadable action JSON fails closed rather than being replaced by an empty list.

`readRestActions` is non-destructive. `importRestActions` compares the exact serialized recovery revision and, in one SQLite transaction, replaces recovery and removes only the selected action IDs. A stale revision changes neither record. JavaScript retries inside the same account serializer used by ordinary recovery writes. Pending conflicts and unavailable baselines retain actions and report a retry warning.

Projection starts from durable recovery, never from the native notification snapshot which already includes the changes. The action UUID becomes the existing outbox/server mutation identity; the original time and resulting generation travel through the existing rest endpoint. The visible timer and notification are synchronized only after the import commits. Replaced rests and finished workouts are explicitly superseded. Stopping the notification on an account switch preserves actions; deleting that account's workout recovery clears its actions atomically. There is no pending-action count eviction.

On startup, pending recovery's committed rest overrides the advisory local timer snapshot before native synchronization. A crash after import but before the display/localStorage write therefore restores the committed absolute deadline without applying the delta again.

## Renderer and Back recovery

The activity handles renderer termination separately from network errors. It detaches and destroys the terminated WebView, then recreates a fresh Capacitor activity. Account cookies, IndexedDB, SQLite and queued operations are retained. The workout foreground service and deadline alarm are independent of the display. One automatic recreation is allowed per 60 seconds within the application process; another termination shows a native Retry screen. This is not recovery from Android force-stop or whole-process death.

Native Back consumes app-owned history and top sheets. At the document root it calls `App.minimizeApp()`, preserving the activity and workout. A new document establishes its own history boundary so authentication and notification entry cannot reopen obsolete WebView entries.

## Diagnostics

Settings has a collapsed Android diagnostics disclosure with Refresh and Copy diagnostics. It reads APK/build/channel, Android/WebView version, device connectivity, last confirmed mutation synchronization, current-account pending edits and notification actions, and existing alert/service capabilities. Missing checks remain unknown. Copy uses a fixed field allowlist; it excludes account identity, credentials, workout names and raw recovery records. It never uploads telemetry.

`renderer_terminated` means the display process stopped; `rest_action_save_failed` means a notification action could not be persisted. A service failure is copied only as `service_unavailable`, never as a raw exception. A missing sync/check time means no successful result has been recorded on this installation.

## APK update channels

The embedded channels are `device-test` for debug APKs and `release` for release APKs. Keep their existing signing keys unchanged. The application ID is `com.workoutapp.phone`.

Each channel uses a manual GitHub Release tag:

- `android-device-test`: device-test APK and `android-release.json`.
- `android-release`: release APK and `android-release.json`.

The native client reads only the fixed repository/channel metadata URL, over HTTPS, with at most three redirects to GitHub asset hosts, a ten-second overall deadline and a 64 KiB response limit. It validates schema, application, channel, integer version code, APK destination, digests and publication time, then compares the installed signing certificate. Certificate mismatch is incompatible; uninstalling is never an update path. Update checks run once per foreground day, with a manual Settings action and last successful check time. The release page opens externally; no automatic installation permission or mandatory update gate exists.

Manifest schema 1 fields are `schemaVersion`, `applicationId`, `channel`, `versionName`, `versionCode`, `apkUrl`, `apkSha256`, `signingCertificateSha256`, and `publishedAt`. CI adds `sourceCommit` and `sourceDirty` for traceability.

CI builds and tests signed release APKs alongside AABs. Set `ANDROID_RELEASE_SIGNING_CERT_SHA256` to the existing release certificate fingerprint; the existing device-test fingerprint remains `ANDROID_DEBUG_SIGNING_CERT_SHA256`. The generator verifies the actual APK certificate, package/version and embedded channel, then hashes that exact APK. A missing fingerprint fails the release artifact gate. CI uploads draft artifacts only; publication is a separate manual action after acceptance and explicit authorization.

## Verification and release acceptance

Run frontend typecheck, standards/docs checks, full tests/build, visual tests and responsive tests. Sync the tested web bundle to Capacitor, compare bundled asset hashes, then run Android lint, JVM tests, instrumented tests and APK signature/package inspection. The CI instrumentation matrix covers API 24, 33 and 36; actual renderer termination is available from API 29 and is skipped on API 24.

Record automated, emulator, physical-device, provider and Wear evidence separately. Browser native-bridge fixtures validate UI contracts, not Android providers. Local emulator APKs signed with a temporary/default debug key are test artifacts, not an in-place upgrade candidate for an installation using another key.

Physical acceptance remains required before publication:

- Record phone model, Android/OEM build, APK version/code and certificate SHA-256.
- Run 30 consecutive short rests with locked-screen actions, sound/vibration and permissions changed mid-session.
- Test process loss, reboot, force-stop/reopen and phone/Wear reconciliation. Delivery after force-stop is not required.
- Verify offline edits, airplane-mode cold launch, keyboard/insets, gesture and three-button Back separately.
- Upgrade in place using the same installed signing identity and confirm that pending work survives.

Google Play distribution, authentication redesign, widgets, Health Connect, new background sync services and additional Xiaomi features are outside this work.
