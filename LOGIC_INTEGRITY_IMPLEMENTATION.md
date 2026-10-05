# Workout logic integrity implementation

Implemented on 2026-10-05 in the local checkout. This records the fixes from the normal-use logic audit; it does not claim every possible application action has been proven correct.

## Audit fixes

| # | Problem | Implemented behavior | Regression evidence |
|---|---|---|---|
| 1 | Exercise restore omitted changed notes and rest | Restore compares and restores those fields from the session baseline while preserving logged sets | `WorkoutDefaultsTests` |
| 2 | Whole-workout restore reconstructed removed exercises from the current template | New sessions store an immutable start-plan snapshot; removed exercises restore from that snapshot with their original identity and suggested values | `WorkoutDefaultsTests` |
| 3 | Applying workout edits to a program could partially save days before finish failed | Server-owned preview identifies changed fields and revisions; scoped updates and finish commit atomically under the existing mutation lock and receipt. Review waits for saves even if the last response's restore flag is still false. Other days retain unchanged prescription fields. A rejected, demonstrably uncommitted finish can be reviewed again | `WorkoutFinishPlanTests`, `workoutOutbox.test.ts`, `useFinishPlanUpdate.test.ts`, browser finish-review workflow |
| 4 | Failed import saves could be treated as flushed and allow creation from stale data | Failed drafts remain dirty, dependent mutations and creation are blocked, full-draft retry retains current edits, and acceptance checks the reviewed revision | `ImportEditDaysTests`, `useImportDraftSaver.test.ts` |
| 5 | Clearing the save queue could permit overlapping writes or apply obsolete failures | Generation invalidation retains physical request serialization; failed intent stays unsaved until its own successful retry or explicit reversion | `queue.test.ts` |
| 6 | Preference failures were swallowed or shown as saved | Failed preferences retain the desired choice with explicit retry/revert; refresh preserves pending choices, device persistence rejects failures, and unit-dependent refresh waits for success | `workoutDevicePreferences.test.ts`, browser failed-preferences workflow |
| 7 | Watch edits could reopen conflicts after the phone finished/discarded a session | Terminal server state releases pending watch edits and ongoing activity with notice; pending projection cannot overlay completed history | `WorkoutSyncCoordinatorTest` |
| 8 | Timed sets continued through pause or lost timer state | Phone and watch timers freeze, persist, and shift their start/deadline on resume. Finish clears timer recovery; phone timing operations persist timer transitions atomically | `setStopwatch.test.ts`, `workoutRecoveryCrash.test.ts`, `SetTimerSnapshotTest` |
| 9 | History removal left stale strength progression and remote workout summaries | Session deletion rebuilds affected progression from surviving chronological evidence in the transaction. Exercise-history clearing queues revised Google Health summaries and invalidates session details | `WorkoutLogicIntegrityTests`, `GoogleHealthWorkoutSyncTests` |
| 10 | Heaviest-set reps could come from another set; timed records polluted rep analytics | Heaviest load/reps/date come from the same set. Timed sets still count as working sets but cannot contribute kilogram volume, estimated strength, rep records or unknown-load warnings. Cached read-model versions are advanced | `WorkoutLogicIntegrityTests`, `training.test.ts` |
| 11 | Set-save endpoints accepted incompatible reps/time/effort payloads | Catalog tracking mode is authoritative for patch and whole-session saves: timed sets require seconds and reject reps/effort; rep sets reject seconds and require reps when completed | `WorkoutLogicIntegrityTests` |

Additional review fixes protect current-account workout callbacks and preference writes from late responses belonging to a previous account, make displayed training duration exclude paused time, surface timed-set recovery persistence failures, and label active session details as in progress.

## Compatibility and rollout

- The additive EF migration `20261005024118_SessionStartPlanSnapshot` adds the session start-plan column. It has not been applied to a live database. Deploy through the repository's normal migration/release process.
- A session started before the snapshot existed can restore surviving exercise baselines, but cannot recover already removed exercises from an unavailable start snapshot. The restore dialog explains this limitation.
- Existing finish clients without a scoped update retain their current contract. Import acceptance remains compatible with clients without a revision; the updated client always supplies it.
- Existing mixed historical tracking data remains readable; new saves enforce the correct tracking contract. The PR/progress cache version changes rebuild affected derived views.
- No live data rewrite or manual deployment was performed. The additive migration follows the normal release process.

## Validation

- API: 1,202 tests passed, zero failed or skipped.
- Web: 600 tests passed across 95 test files. Final production build passed.
- Wear: 73 unit/UI tests passed; debug APK assembly passed with the compatible JDK 21 runtime.
- Documentation synchronization, source standards, and `git diff --check` passed.
- Browser: 103 checks passed, zero failed; two intentional skips for desktop-only settings section links on phone/tablet. The final run exercised real API saves and imports on desktop, phone and tablet, plus touch controls and recovery/error screens.
- Responsive: all 44 checks passed at 320, 390, 640, 768, 1024, 1440 and 1920 px in dark/light themes, covering active logging, views/dialogs and populated history.

The first browser run exposed a dirty-draft guard regression when an exercise mutation waited behind a successful autosave. The successful save now clears dirty state by edit version independently of the queue length; an additional regression test covers that ordering. A later run exposed an obsolete calendar fixture whose wildcard supplied an activity array to a session-detail request and expected an earlier day-dialog interface. The fixture now supplies complete sessions and checks the current direct-detail behavior. Both partial runs were stopped; the corrected build passed the complete browser and responsive suites.

After those broad UI suites, a final finish-review timing improvement removed reliance on a potentially stale client restore flag. It changes review coordination, without changing layout. The final 600-test unit run and production build passed. The focused browser run then passed all five checks (two authentication setup checks and one real-API program-finish regression on each of desktop, phone and tablet). Its initial fixture assumptions about an already open workout and program activation were corrected before the successful rerun.

Browser suites use disposable data and local identity/model stand-ins. They do not establish production identity, Google Health delivery, physical phone/watch behavior, OEM notification delivery, or live deployment correctness. Phone native code was unchanged; an installable phone APK containing the updated UI still requires the normal packaging process.

PDF extraction and source reconstruction rules were not changed; the PDF corpus was not rerun for the draft-save and acceptance changes.
