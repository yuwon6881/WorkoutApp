# Wear OS Companion

The standalone Wear OS companion (`wear/`) provides on-wrist logging and rest timer alerts for an active strength training session started from WorkoutApp.

## Core capabilities

- **Active workout pairing & discovery**: Discovers the active workout started on phone or web via a short 5-minute approval code.
- **Manual strength logging**: Interactive entry and crown-adjusted editing of reps, load (kg/lb), and RIR with undo of the last logged set.
- **Rest timer & ongoing activity**: Tracks prescribed rest intervals, presents an active ongoing activity chip on the watch face, and buzzes with a single vibration when rest completes.
- **Offline queue & conflict safeguards**: Queues watch edits in local SQLite for ordered replay. Revision-only server bumps rebase cleanly; concurrent edits to the same set or external edits during session finish are held for user review.

## Manual-logging use case and foreground service review

WorkoutApp on Wear OS is strictly an **interactive manual workout logger** and rest interval timer:
- The user taps or rotates the crown to record completed sets, weights, and reps.
- The app does **not** read continuous biosensors (optical PPG heart rate, skin temperature, SpO2) or stream raw sensor telemetry via Android Health Services.
- Between sets, the app times rest periods and triggers a haptic buzz so the lifter knows when to begin their next set.

Android's foreground-service guide lists long-running fitness uses, including exercise trackers, under the `health` type. That type also has prerequisites: declare `HIGH_SAMPLING_RATE_SENSORS`, or request and receive one of the listed runtime permissions (`BODY_SENSORS` on API 35 and lower, or an eligible health/activity permission). Body-sensor and sensor-reading permissions have additional background restrictions. The current manual logger does not read sensors or activity-recognition data, so adding an unrelated permission solely to satisfy a type prerequisite would misrepresent the feature.

The manifest currently declares `specialUse` with the subtype `Active strength workout logging and rest timer`. Android describes this type for valid foreground-service uses not covered by the other types and says the declared subtype is reviewed in Play Console. Since the `health` description also names fitness trackers, neither Android's documentation nor this source inspection guarantees that Play will accept `specialUse` for this manual-logging use case. Before release, review the actual ongoing activity and alert behavior against current Android and Play requirements, and submit an accurate declaration. Do not claim approval until Play has reviewed it. See [Android foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

For that review, demonstrate the manual workflow: start or discover an active workout, log a set, show the watch-face ongoing activity, and receive a rest-completion alert. The service does not stream sensor data; the watch's workout snapshot and queued edits remain local-first and sync through the existing account-scoped API outbox.

## Rest wake lock lifecycle

Wear OS suspends the CPU when the screen dims or turns off. To ensure the end-of-rest vibration fires promptly:
- `WorkoutOngoingService` holds a bounded `PARTIAL_WAKE_LOCK` (`deadline - now + 10s grace`, capped at 15 minutes).
- The wake lock is strictly bounded to the active rest interval.
- It is immediately released when:
  - Rest expires and the completion vibration is triggered.
  - A rest timer is replaced or adjusted.
  - The rest timer is cancelled or cleared.
  - The workout session is paused or finished.
  - The service is destroyed.
- Alert claims are guarded by generation IDs (`store.claimRestAlert(generation)`), ensuring exactly-once vibration per rest period.

## Physical-watch power and timing check

Robolectric tests verify service replacement, cancellation, pause, finish, destruction, stale-generation handling, and one vibration for a claimed generation. They do not measure battery use or alert timing on a watch. When a physical Wear OS watch is available, run a reproducible 20-set workout with the screen off during rests and record:

- Watch model, Wear OS version, app build, battery percentage before and after, and workout duration.
- Each rest duration, wake-lock acquire/release timestamps, scheduled deadline, and observed vibration time.
- Alert lateness relative to the deadline, plus screen-on versus screen-off conditions and any interrupted rests.

Repeat the same procedure after any change to the service, wake-lock bound, or alert mechanism. No physical-watch measurement has been recorded for this build.
