# Technical Investigation & Architecture Audit: Ask AI Rights, Capabilities, and Autonomy in WorkoutApp

**Target System**: `WorkoutApp` (`d:\App\WorkoutApp`)
**Document**: Authoritative Master Findings Report (`WorkoutApp/ASK_AI_FINDINGS.md`)
**Date**: November 5, 2026
**Auditor**: Teamwork Investigation Team (`teamwork_worker_m2_1` synthesized from `teamwork_explorer_ai_1`, `teamwork_explorer_ai_2`, `teamwork_explorer_ai_3`)
**Integrity Mode**: Development / Non-Destructive Analysis (Strictly read-only; zero application, database, or test files modified)

---

## Executive Summary

This report delivers an exhaustive architectural investigation into the **Ask AI** conversational assistant within `WorkoutApp`. The primary objective is to determine whether Ask AI possesses sufficient data access rights, contextual depth, and operational autonomy to deliver high-value coaching insights, diagnose performance anomalies, and formulate independent programming decisionsâ€”or whether it is structurally constrained to narrating hardcoded application formulas over heavily truncated historical data.

### High-Level Architectural Posture
Ask AI is implemented as an interactive, multi-turn conversational agent operating across an ASP.NET Core 10 backend (`WorkoutApp/api/Services/AI/`) and a React 19 / TypeScript PWA frontend (`WorkoutApp/web/src/components/ai/`). It utilizes OpenAI Responses API function-calling over a closed tool registry comprising an authoritative baseline context snapshot (`AiBaselineSnapshotBuilder.cs`) and eight registered read-only tools (`AiToolRegistry.cs`). User-facing interaction is mediated through an action review gateway (`AiActionProposer.cs`).

### Core Findings & Structural Deficits
1. **Aggressive Historical Truncation & Total Absence of PRs**: While the assistant receives rich set-by-set execution semantics for the immediate session, it suffers from severe historical amnesia. Most critically, **zero Personal Records (PRs), all-time 1RMs, rep bests, or lifetime volume peaks are exposed to any AI tool**, despite mature calculation engines in `WorkoutPrReadService.cs` and `ExerciseService.cs`. Furthermore, exercise progression queries are hardcoded to the last 5 completed sessions with no pagination or date filters, suggestion reasons are stripped for all sessions older than the first, session notes (`WorkoutSession.Note`) are completely omitted, and program overviews return only the current week's templates.
2. **Formula Subservience vs. Autonomous Coaching**: The system prompt (`AiAgentPrompt.cs:44-45`) explicitly commands: *"Explain the app's own suggestion and reason from the tool result; do not invent a different progression rule or promise what the next suggestion will be."* The assistant is instructed to treat the output of the backend's deterministic double progression engine (`PrescriptionProgression.cs`) as an indisputable fait accompli. When performance dips follow an overshoot, the prompt mandates diagnosing carried-over fatigue verbatim (`AiAgentPrompt.cs:41-43`), preventing the model from exploring systemic fatigue, sleep deficits, joint pain, or volume tolerance.
3. **Impassable Action Barrier & Zero Direct Mutation**: The architecture strictly enforces that Ask AI cannot directly mutate database records, start sessions, or log sets. However, the action proposer (`AiActionProposer.cs`) is capped at `maxItems = 1` and restricted to six read-only view navigation routes (`openWorkout`, `openExercise`, `openProgram`, `openHistory`, `openActiveWorkout`, `openAddWorkoutDraft`). Even `openAddWorkoutDraft` merely switches the UI tab to the Workouts screen without pre-populating an ad-hoc routine. The AI has no mechanism to propose reviewable set adjustments, back-off loads, or exercise substitutions.
4. **Watertight Safety & Resource Controls**: The system enforces robust operational boundaries: a 150-second turn timeout, a 4-tool-round ceiling, an 8-call budget per turn, strict character caps (12,000 per result, 40,000 total), in-turn canonical argument caching, an admission-gated daily token budget (100,000 tokens), and a strict evidence ledger (`AiEvidenceLedger`) that rejects any action proposal referencing unsurfaced entity IDs.

### Synthesis & Strategic Path Forward
Ask AI currently functions as a **formula-subservient narrator** rather than an **autonomous strength coach**. To unlock true coaching capabilities without compromising safety, WorkoutApp must transition to a **Dual-Track reasoning architecture** (algorithmic baseline + autonomous appraisal), expose PRs and qualitative workout notes, introduce pagination and simulation tools, and expand `AiActionProposer` to generate reviewable, in-memory workout drafts and exercise substitutions.

---

## Section 1: Data Access Rights & Historical Context Exposure

### 1.1 Baseline Context Snapshot (`AiBaselineSnapshotBuilder.cs`)

At the inception of every assistant turn (`AiAssistantService.cs:153-222`), `AiBaselineSnapshotBuilder.BuildAsync` constructs a compact JSON snapshot representing the user's immediate state. This snapshot is serialized and injected into the model's message sequence as an authoritative `"developer"` message (`AiAssistantService.cs:219-221`):

```
"Current training context (authoritative; past replies may be stale):\n" + contextNode.ToJsonString()
```

#### Delivered Fields:
* `today`: Current date in user's local timezone (`yyyy-MM-dd`).
* `timeZone`: User's IANA timezone identifier (e.g. `"America/New_York"`).
* `weightUnit`: Preferred weight unit (`"kg"` or `"lb"`).
* `displayName`: User profile display name.
* `trackRir`: Boolean indicating whether Reps in Reserve (RIR) tracking is enabled.
* `activeProgram`: Compact summary of the currently active program run (if present):
  - `id`: Program run GUID.
  - `name`: Program title.
  - `currentWeek`: Integer week ordinal.
  - `totalWeeks`: Total duration in weeks.
  - `runNumber`: Run iteration count.
  - `runCompleted`: Boolean flag.
  - `lifecycleStatus`: Status string (`"active"`, `"completed"`).
* `activeStandalone`: Active standalone workout slot summary (name, completed status).
* `activeWorkout`: Active in-progress workout session (if present):
  - `id`: Active workout session GUID.
  - `name`: Workout title.
  - `startedAt`: UTC timestamp.

#### Evidence Ledger Impact & Baseline Deficits:
The baseline snapshot records *only* the active program ID and active workout ID into the turn's `AiEvidenceLedger` (`AiBaselineSnapshotBuilder.cs:48-49`). Template IDs and exercise IDs are deliberately excluded from baseline evidence (`AiBaselineSnapshotBuilder.cs:23`).

Crucially, the baseline contains **zero historical workout sessions, zero exercise records, zero personal records, zero fatigue metrics, zero qualitative notes, and zero nutrition figures**. The assistant starts every turn in a state of complete historical amnesia and must retrieve all contextual information through tool execution.

---

### 1.2 The Eight Registered Read Tools

The system registers exactly eight read-only data extraction tools in `WorkoutApp/api/Program.cs:108-116` and `AiToolRegistry.cs:9-23`:

| Tool Name | Implementing Class | Scope & Purpose | Input Parameters & Defaults |
|---|---|---|---|
| `get_workout_history` | `GetWorkoutHistoryTool.cs` | Recent finished workout summaries | `limit` (int 1â€“20, def 5), `fromDate` (YYYY-MM-DD), `toDate` (YYYY-MM-DD) |
| `get_workout_detail` | `GetWorkoutDetailTool.cs` | Detailed exercise and set breakdown of one session | `workoutId` (GUID string, required) |
| `get_exercise_progress` | `GetExerciseProgressTool.cs` | Set-by-set progression, suggestions, and intra-set fatigue | `exercise` (string/slug, required), `setNumber` (int 1â€“20, optional) |
| `get_exercise_catalog` | `GetExerciseCatalogTool.cs` | Search system catalog and custom exercise library | `query`, `muscle`, `equipment`, `category`, `limit` (int 1â€“25, def 10) |
| `get_program_overview` | `GetProgramOverviewTool.cs` | Active training slot, current week templates | None |
| `get_muscle_balance` | `GetMuscleBalanceTool.cs` | Aggregated working set volume per muscle group | `range` (`"1w"`, `"1m"`, `"3m"`), `timeZone` |
| `get_active_workout` | `GetActiveWorkoutTool.cs` | In-progress workout session sets and live suggestions | None |
| `get_nutrition_summary`| `GetNutritionSummaryTool.cs`| Linked NutritionApp intake, deficit, and weight trends | `days` (int 1â€“28, def 14) |

#### Deep Dive: `GetExerciseProgressTool.cs` and `ExerciseSetHistory.cs`
When queried regarding an exercise's progression, `GetExerciseProgressTool.ExecuteAsync` resolves the exercise against catalog slugs, aliases, and custom exercises (`_db.Aliases`, `_db.CustomExercises`). It retrieves the cached strength trend from `_db.Progress` (`ExerciseProgress.cs`):
- `trendE1rm`: `progress.TrendE1rmKg` converted to user units.
- `lastE1rm`: `progress.LastE1rmKg` converted to user units.
- `sessionsBelowTrend`: `progress.Stalls` (count of consecutive sessions below EMA trend).

Completed sessions are fetched via `ExerciseSetHistory.QueryCompletedSessionsAsync` (`ExerciseSetHistory.cs:22-42`). For each completed working set, `SetRow` reconstructs:
- `set`: Working set ordinal (1-based index comparing Set 1 to Set 1 across sessions).
- `weight`: Actual weight lifted in user units.
- `reps`: Actual reps completed.
- `rir`: Actual reserve logged (or inferred from RPE if `trackRir` is enabled).
- `target`: Prescribed rep range and effort target (e.g., `"8-10 reps at RPE 8"`).
- `suggestedWeight`: Stored algorithmic target load (`suggestion.SuggestedLoadKg`).
- `suggestedReps`: Stored algorithmic target reps (`suggestion.SuggestedReps`).
- `suggestionReason`: Explanation string for why the app suggested the load/reps.
- `earlierSetsPastTargetBy`: Calculated intra-exercise fatigue overshoot from prior sets.

---

### 1.3 In-Depth Evaluation of Missing Historical Data & Context

A rigorous comparison between WorkoutApp's database schema and the data exposed to Ask AI exposes four major architectural blackouts:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                      WORKOUTAPP DATABASE DOMAIN                        â”‚
â”‚                                                                        â”‚
â”‚  [WorkoutPrReadService]           [ExerciseService.BuildInsight]       â”‚
â”‚  - All-time 1RM PRs               - Heaviest Weight Lifted             â”‚
â”‚  - Rep PRs at Load                - Rep Records                        â”‚
â”‚  - Session Volume PRs             - Historical 1RM Progression Curve   â”‚
â”‚         â”‚                                        â”‚                     â”‚
â”‚         â–¼                                        â–¼                     â”‚
â”‚  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•  â”‚
â”‚                     THE AI CONTEXT BARRIER (0% EXPOSED)                â”‚
â”‚  â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•  â”‚
â”‚         â”‚                                        â”‚                     â”‚
â”‚         â–¼                                        â–¼                     â”‚
â”‚  [Ask AI Baseline]                [Ask AI Tool Registry]               â”‚
â”‚  - No PR data                     - No PR tools                        â”‚
â”‚  - No historical bests            - Only trendE1rm & lastE1rm scalars  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### 1. Zero Exposure of Personal Records (PRs) and All-Time Bests (0% Exposed)
WorkoutApp possesses two sophisticated backend PR engines:
* `WorkoutPrReadService.cs:7-66`: Calculates all-time `ExercisePrs`, `SetPrs`, `SessionPrCounts`, `Bests`, and `RepBests` per exercise and workout.
* `ExerciseService.cs:27-37, 186-265` (`BuildInsight`): Evaluates full career history to compute all-time `Estimated1RmKg`, `HeaviestKg`, `LargestSetVolumeKg`, `LargestSessionVolumeKg`, `RepPr`, and full chronological `Points` timelines.

**The Defect**: Neither service is connected to any tool in `WorkoutApp/api/Services/AI/Tools/`. Ask AI has **zero access to PR data**. The assistant cannot determine whether a set performed today is a lifetime PR, whether a lifter has ever handled a given weight before, or what the user's historical best 5-rep set was.
*Irony*: In `AiAssistantService.cs:255`, the hardcoded smalltalk greeting explicitly claims: *"I can look up your workout history, analyze exercise progress and personal records..."* This claim is factually false; the model has no tools to look up personal records.

#### 2. Total Omission of Qualitative Workout Notes (`WorkoutSession.Note`)
In `WorkoutApp/api/Data/Entities.cs:229`, `WorkoutSession` contains a dedicated `Note` property where users log subjective workout context (e.g. *"Shoulder impingement flared up on incline bench"*, *"Slept 3 hours due to red-eye flight"*, *"New gym with stiff barbells"*).
* In `GetWorkoutDetailTool.cs:77, 96-107`, `se.Note` (exercise-level note) is mapped, but `workout.Note` (session-level note) is **completely omitted**.
* In `GetWorkoutHistoryTool.cs:69-76`, `workout.Note` is neither queried nor returned.
* **Impact**: The AI is blind to life context. If a user's performance collapses because of food poisoning or an acute joint tweak noted in the session log, the AI sees only a drop in reps and attributes it to muscular fatigue or lost strength.

#### 3. Missing Program Progression Across Multi-Week Cycles & Adherence Records
While `ProgramProgressService.cs` actively manages `ProgramDayProgress` (tracking days as `Completed`, `Skipped`, `Pending`, or `RestPassed`), `GetProgramOverviewTool.cs:69` restricts its query strictly to templates matching `Week == currentWeek`:
```csharp
// GetProgramOverviewTool.cs:69
_db.Templates.AsNoTracking().Where(t => t.ProgramId == program.Id && t.Week == currentWeek)
```
* Templates for past weeks and upcoming weeks are hidden.
* Exercise prescriptions inside templates are omitted.
* Program adherence rates and skipped session histories are completely unexposed.
* **Impact**: The AI cannot tell if an athlete has an 80% skip rate on leg days, nor can it evaluate periodized progression across a 12-week macrocycle.

#### 4. Siloed Intra-Exercise Fatigue vs. Systemic Session/Weekly Fatigue
In `WorkoutApp/api/Domain/ProgressionFatigue.cs:30-42`, `ProgressionFatigue.Before` tracks `earlierSetsPastTargetBy` by inspecting earlier working sets of the *same* exercise in the *same* session.
* Fatigue generated by heavy compound movements performed immediately prior in the workout (e.g. 5 sets of heavy Barbell Squats preceding Leg Press, or Weighted Dips preceding Triceps Pushdowns) is completely invisible.
* Multi-day systemic fatigue, cumulative weekly tonnage density, sleep quality, and recovery metrics are entirely absent.

---

### 1.4 Comprehensive Analysis of Truncation Mechanisms

To protect token budgets and prevent large payload allocations, WorkoutApp implements aggressive truncation across multiple layers:

| Tool / Mechanism | Enforced Ceiling | Exact Source Citation | Omitted Information / Consequence |
|---|---|---|---|
| `get_exercise_progress` Session Cap | 5 completed sessions (10 if `setNumber` specified) | `GetExerciseProgressTool.cs:18-20, 117-118` | All sessions prior to the 5th most recent are dropped. No `offset`, `page`, or `fromDate` parameters exist. Macrocycle analysis (>6 weeks) is impossible. |
| Suggestion Reason Stripping | Session index == 0 only | `ExerciseSetHistory.cs:40` | `suggestionReason` is populated *only* for the newest session. For sessions 1..N, it is forced to `null`. The historical rationale for past weight changes is erased. |
| `get_workout_history` Cap & Reduction | Max 20 workouts (default 5); `topSet` only | `GetWorkoutHistoryTool.cs:46, 127-146, 171` | Individual set details, warm-up sets, and rest times are discarded. Each exercise is compressed to a single `topSet`. |
| `get_program_overview` Week Filtering | Current week only | `GetProgramOverviewTool.cs:69` | Templates for upcoming and prior weeks are omitted. Day-by-day skip/completion records are omitted. |
| `get_nutrition_summary` Array Truncation | 7 days daily data | `GetNutritionSummaryTool.cs:18, 38` | Even if `days = 28` is requested, `recentDays` array is truncated to 7 daily breakdown records. |

#### Detailed Analysis: The Suggestion Reason Erasure (`ExerciseSetHistory.cs:40`)
In `ExerciseSetHistory.cs`, line 40 enforces:
```csharp
Describe(sets[row.Id], row.PrescriptionJson, setNumber, withReasons: index == 0)
```
As explained in the developer comment on lines 20â€“21:
> *"Suggestion reasons are kept only for the newest session to stay inside the tool-result bound; older sessions keep the suggested numbers."*

While this optimization conserves characters, it blinds Ask AI to the causal narrative of the user's training. If a user asks *"Why did my bench press load stall over the last month?"*, the AI can see that sessions 1, 2, and 3 had target weights of 80kg, but the algorithmic reasons (e.g. *"Hard exposure streak deload"*, *"Plateau reset - 4 sessions with no rep gain"*) were stripped from the payload.

---

## Section 2: Formula Reliance vs. Standalone Opinion Formation & System Prompting

### 2.1 System Prompt Directives (`AiAgentPrompt.cs:14-68`)

The prompt governing Ask AI's persona and reasoning resides in `WorkoutApp/api/Services/AI/Agent/AiAgentPrompt.cs`. While establishing rigorous data grounding, several directives enforce strict subservience to the backend's deterministic code and suppress autonomous coaching critique:

```csharp
// AiAgentPrompt.cs:41-45
- When earlier sets went past their target effort (earlierSetsPastTargetBy), a lower result
  on a later set is carried-over fatigue, not lost strength. Say so, and suggest keeping
  the earlier sets at their target instead of lowering the later set's weight.
- Explain the app's own suggestion and reason from the tool result; do not invent a
  different progression rule or promise what the next suggestion will be.
```

#### Detailed Breakdown of Directives:
1. **The Explicit Formula Deferral Directive (lines 44â€“45)**:
   This directive commands the model to function strictly as a spokesperson for the backend algorithm. It explicitly forbids the model from proposing alternative progression rules (such as percentage-based periodization, step loading, or dynamic double progression) and forbids predicting what future suggestions will be.
2. **The Hardcoded Fatigue Diagnosis Mandate (lines 41â€“43)**:
   The prompt does not ask the model to analyze whether a drop in reps was caused by fatigue; it **mandates the diagnosis and the prescription verbatim**. The model is ordered to state that the dip is carried-over fatigue and ordered to instruct the user to hold weight on later sets while restricting earlier sets. This completely overrides nuanced coaching evaluations (e.g. considering whether an athlete needs a back-off set, a drop set, or higher rest intervals).
3. **Negative Constraint Phrasing in Rule 1 (lines 20â€“21)**:
   *"Use ONLY the tools provided to look up data. NEVER fabricate exercise names, workout details, set/rep numbers, weights, or dates."*
   In practice, this negative phrasing induces a severe chilling effect on model autonomy. When lifters ask forward-looking coaching questions (e.g. *"What warm-up ramp should I use for 100kg bench?"* or *"What weight should I drop to if my shoulder aches?"*), the LLM frequently refuses to provide specific numerical targets, fearing that generating load numbers violates the "NEVER fabricate weights" command.
4. **Context Inference Restrictions (lines 54â€“56)**:
   *"Do not infer effort, protein, sleep, illness, injury, or unlogged activity. Ask the user for missing context when it could change the answer."*
   While intended to prevent baseless speculation, it creates a defensive posture where the assistant will not proactively consider common athletic fatigue factors unless explicitly prompted.

---

### 2.2 Hardcoded Application Formulas in `api/Domain/`

WorkoutApp implements a rich, deterministic mathematical progression engine across its domain layer. Ask AI does not compute these figures; it merely observes their results:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚               WORKOUTAPP DETERMINISTIC PROGRESSION ENGINE              â”‚
â”‚                                                                        â”‚
â”‚   [Progression.cs]                                                     â”‚
â”‚   â€¢ E1RM = weight * (1 + (reps + (10 - RPE)) / 30.0)                   â”‚
â”‚   â€¢ TrendE1RM = 0.3 * SessionE1RM + 0.7 * TrendE1RM                    â”‚
â”‚   â€¢ Equipment Steps: DB 2kg, KB 4kg, BB/Machine 2.5kg                  â”‚
â”‚                                                                        â”‚
â”‚   [PrescriptionProgression.cs]                                         â”‚
â”‚   â€¢ Double Progression: add +1 rep (or +3 if RIR >= target + 2)        â”‚
â”‚   â€¢ Weight Jump: when upper rep reached, jump to next equipment step   â”‚
â”‚   â€¢ Hard Streak: 1 hard = hold; 2 hard = -1 step; 3 hard = -7.5%       â”‚
â”‚   â€¢ Plateau: 4 sessions no rep gain = -5% deload (or hold in deficit)  â”‚
â”‚   â€¢ Layoff Decay: 15-27d = hold; 28-55d = -10%; 56d+ = -20%            â”‚
â”‚                                                                        â”‚
â”‚   [ProgressionFatigue.cs]                                              â”‚
â”‚   â€¢ Intra-set Overshoot = TargetReserve - ActualReserve >= 1.0         â”‚
â”‚   â€¢ Excused Dips: hold load and repeat fresh reps                      â”‚
â”‚                                                                        â”‚
â”‚   [NutritionContextService.cs]                                         â”‚
â”‚   â€¢ Deficit Mode: Normal -> Conservative (>=0.5%) -> Preservation (>=0.75%)â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Mathematical Formulas & Rules:
1. **Scientific E1RM Formula with Subjective Effort (`Progression.cs:120-151`)**:
   $$\text{Total Reps} = \text{reps} + (10 - \text{RPE})$$
   $$\text{E1RM} = \text{weight} \times \left(1 + \frac{\text{Total Reps}}{30.0}\right)$$
   *Guardrail*: Calculation is invalidated if $\text{RPE} < 6$ or if $\text{Total Reps} > 12$ (`Progression.cs:123-125, 142-149`), adhering to the physiological breakdown of Epley's formula above 12 reps.
2. **Running Strength Trend EMA (`Progression.cs:201-207`)**:
   $$\text{TrendE1RM}_{t} = 0.3 \times \text{SessionE1RM} + 0.7 \times \text{TrendE1RM}_{t-1}$$
   $$\text{Stalls} = \begin{cases} 0 & \text{if } \text{SessionE1RM} \ge \text{TrendE1RM}_{t-1} \\ \text{Stalls} + 1 & \text{otherwise} \end{cases}$$
3. **Double Progression & Equipment Step Jumps (`PrescriptionProgression.cs:217-291`)**:
   - Rep increment: When within target range, adds +1 rep. If `ProgressionCalibration.Applies` triggers ($\text{reserve} \ge \text{target} + 2$), jumps up to +3 reps.
   - Load increment: When rep ceiling is reached, steps to the next hardware plate increment (e.g. 2.5kg barbell step). If the equipment jump causes predicted reps to drop below the minimum target, `ProgressionCalibration.RepsToReach` commands the lifter to overshoot reps at the current load first.
4. **Layoff Decay Factors (`PrescriptionProgression.cs:50-66`, `ProgressionLayoff.cs:8-24`)**:
   - $15 \le \text{Days} < 28$: Hold load and repeat target reps.
   - $28 \le \text{Days} < 56$: Deload load by 10% ($\times 0.9$).
   - $\text{Days} \ge 56$: Deload load by 20% ($\times 0.8$).
5. **Hard Exposure Streaks & Plateau Resets (`PrescriptionProgression.cs:102-159`)**:
   - Hard streaks: 1 session at RIR 0 repeats load; 2 consecutive hard sessions steps down 1 equipment increment; 3 consecutive hard sessions triggers a formal 7.5% deload.
   - Plateau: 4 sessions at the same load with zero rep gain triggers a 5% deload ($\times 0.95$) in `Normal` mode.
6. **Nutrition Deficit Adaptations (`NutritionContextService.cs:100-120`)**:
   - If weekly weight loss rate $\ge 0.5\%$, shifts to `Conservative` mode (requires 2 qualified sessions before adding reps).
   - If weekly weight loss rate $\ge 0.75\%$, shifts to `Preservation` mode (doubles qualification criteria and suppresses plateau deloads to protect lean mass).

---

### 2.3 Suggestion Lifecycle & "Fait Accompli" Delivery

Suggestions are generated strictly at the moment a workout session starts (`WorkoutService.Progression.cs:75-85`):
```csharp
// WorkoutService.Progression.cs:81-83
set.SuggestionJson = Json.Write(suggestion);
```
When Ask AI inspects progression via `GetExerciseProgressTool`, it receives this pre-calculated suggestion alongside a hardcoded framing string (`GetExerciseProgressTool.cs:22-28`):
```json
"howToRead": "set is the working-set number; compare a set only with the same set in other sessions. suggestedWeight/suggestedReps are what the app recommended when that session started, and suggestionReason explains why. earlierSetsPastTargetBy is how many reps closer to failure than prescribed an earlier set of the same exercise went in that session; a lower result on a later set after that is carried-over fatigue, not lost strength. The next recommendation is calculated when the next workout starts."
```

#### The Closed Loop of Subservience
This creates an inescapable closed loop:
1. The backend domain service calculates the suggestion using deterministic formulas.
2. The read tool delivers the suggestion wrapped in explicit instructions dictating that dips are carried-over fatigue.
3. The system prompt commands the model to explain the app's suggestion and reason and forbids inventing alternative progression rules.

#### Case Study: Real-World Lifter Deviation
Consider a scenario where an athlete tells Ask AI:
> *"I have a mild lower back spasm and only slept 3 hours. The app is telling me to deadlift 140kg for 5 reps today. Should I really do that?"*

How does the current architecture handle this situation?
* **In Text (Conversational Advice)**: If the model follows `AiAgentPrompt.cs:44-45` strictly, it is forbidden from proposing a different progression rule. If it acts with human common sense and advises the lifter to back off by 25% or switch to light Romanian deadlifts, the text reaches the user.
* **In System State (The Execution Disconnect)**: Even if the AI advises backing off, **the app state remains completely disconnected**. The active workout sheet continues to display 140kg as the required target. The AI cannot modify the planned set.
* **In Action Proposals (`AiActionProposer.cs`)**: If the AI attempts to submit a structured proposal to adjust the session load (`adjustWorkoutLoad`), the proposer intercepts the action, identifies that `adjustWorkoutLoad` is absent from `AllowedTypes` (`AiActionProposer.cs:9`), and aborts the proposal with `"Unsupported action type."` (`AiActionProposer.cs:61`).

---

## Section 3: Tool Boundaries, Permissions & Action Proposer Rules

### 3.1 `AiActionProposer` Architecture (`AiActionProposer.cs:9-99`)

The action proposer acts as the authoritative boundary between model output and application navigation. It exposes a single pseudo-tool: `propose_ui_actions`.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        AI ACTION PROPOSAL PIPELINE                     â”‚
â”‚                                                                        â”‚
â”‚   Model Call: propose_ui_actions(actions: [...])                       â”‚
â”‚                         â”‚                                              â”‚
â”‚                         â–¼                                              â”‚
â”‚   [Schema Validation] â”€â”€â”€â–º maxItems == 1? â”€â”€â”€â–º Array length > 1?       â”‚
â”‚                                                     â”‚ REJECT           â”‚
â”‚                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                  â”‚
â”‚                         â–¼                                              â”‚
â”‚   [Whitelist Validation] â”€â–º type in AllowedTypes? â”€â”€â–º Unsupported type?â”‚
â”‚                                                     â”‚ REJECT           â”‚
â”‚                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                  â”‚
â”‚                         â–¼                                              â”‚
â”‚   [Evidence Barrier] â”€â”€â”€â”€â–º entityId in Ledger?   â”€â”€â”€â–º Unsurfaced ID?   â”‚
â”‚                                                     â”‚ REJECT           â”‚
â”‚                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                  â”‚
â”‚                         â–¼                                              â”‚
â”‚   [Accepted Proposal] â”€â”€â–º Serialized into ActionBatch (Pending)        â”‚
â”‚                         â”‚                                              â”‚
â”‚                         â–¼                                              â”‚
â”‚   [Frontend Confirmation] â”€â”€â–º Rendered in AiActionReview.tsx           â”‚
â”‚                               [ Dismiss ]      [ Open ]                â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

#### Whitelist of Allowed Actions (`AiActionProposer.cs:9`):
1. `openWorkout`: Opens the session detail modal for a past workout (`workoutId`).
2. `openExercise`: Opens the exercise detail modal (`slug` or `exerciseId`).
3. `openProgram`: Navigates to the Workouts/Programs tab (`programId`).
4. `openHistory`: Navigates to the Overview/History tab (no payload).
5. `openActiveWorkout`: Opens the active workout sheet (no payload).
6. `openAddWorkoutDraft`: Navigates to the Workouts/Programs tab (`templateId`).

#### The Single Proposal Constraint (`maxItems = 1`):
In `AiActionProposer.cs:21, 49-50`:
```csharp
if (actions.GetArrayLength() > 1 || _accepted.Count > 0)
    return Task.FromResult(Error("Only one action can be reviewed per turn."));
```
The model can propose at most one action per turn. It cannot present comparative choices (e.g. *"Here is Workout A or Workout B"*).

#### The Evidence Barrier (`AiActionProposer.cs:92-99`):
Every entity ID in the action payload must exist in the turn's `AiEvidenceLedger`:
```csharp
private void AddEvidence(AiToolArgs args, Dictionary<string, object?> payload, string key, string kind, bool required = false)
{
    var id = required ? args.RequiredString(key, 160) : args.OptionalString(key, 160);
    if (id == null) return;
    if (!_toolContext.Evidence.Contains(kind, id))
        throw new AiToolArgumentException($"{key} '{id}' was not returned by any tool this turn. Look it up first.");
    payload[key] = id;
}
```
If an ID was not returned by a tool during the current turn, validation throws an `AiToolArgumentException`, caught at line 84, returning `{"accepted": false, "reason": "..."}`. Hallucinated IDs are completely prevented from reaching the UI.

#### Deferred Evidence Publication Guarantee (`AiToolExecutor.cs:65, 101`):
Evidence is published to `context.Evidence` *only* after a tool completes successfully and within character budgets:
```csharp
// AiToolExecutor.cs:95-101
if (!context.Budget.TryConsumeCharacters(output.Length))
    return Failure(tool.Name, label, "That result was too large to use...");

context.Evidence.MergeFrom(executionContext.Evidence);
```
As verified in `AskAiReviewTests.cs:222-244`, an oversized tool execution that fails character budget checks suppresses evidence ledger publication, preventing hidden records from authorizing actions.

---

### 3.2 Read-Only Guarantees & Zero Direct Mutation

WorkoutApp enforces strict read-only guarantees:
1. **No Database Write Operations in Tools**: Every database query in all eight AI tools explicitly includes `.AsNoTracking()`. Zero tools call `Add`, `Update`, `Remove`, `ExecuteUpdateAsync`, or `SaveChangesAsync`.
2. **Database Write Guards (`AppDb.cs:318-350`)**: Entity modifications require authenticated user contexts, valid tenancy filters, and optimistic concurrency tokens (`Revision`, `Version`). Ask AI possesses no execution context to bypass these guards.
3. **The Truth About `openAddWorkoutDraft`**:
   Despite the suggestive name `"openAddWorkoutDraft"`, it **does not create or draft a workout session**.
   In `WorkoutApp/web/src/App.tsx:328-332`:
   ```tsx
   // Ask AI only ever opens a screen: a session starts from a Start button the lifter taps.
   case 'openAddWorkoutDraft':
     setTab('program');
     break;
   ```
   In the UI (`AiActionReview.tsx:11`), `openAddWorkoutDraft` is labeled as `"View workouts"`. Clicking "Open" simply navigates the user to the Programs tab. A workout session is created *only* when the human lifter explicitly taps the physical "Start" button.

---

### 3.3 Execution Bounds & Resource Controls

WorkoutApp implements comprehensive resource and token bounds to prevent hung turns and runaway API spend:

| Resource Constraint | Bound Value | Enforcing Code Location | Operational Behavior When Exceeded |
|---|---|---|---|
| **Turn Deadline** | 150 seconds | `AiAssistantService.cs:78` | Aborts pending turn, preserves prior chat history, returns HTTP 503 retry response. |
| **Tool Calling Rounds** | Max 4 rounds | `AiAgentEngine.cs:11, 67-69` | At round 5, injects `AiAgentPrompt.ToolLimitNote`, forces `toolChoice = "none"`, and compels final text response. |
| **Tool Call Budget** | Max 8 calls / turn | `AiToolContext.cs:66`, `AiToolExecutor.cs:56` | Rejects 9th tool call with budget-exhausted error envelope. |
| **Result Character Cap** | 12,000 chars / result | `AiToolContext.cs:68`, `AiToolExecutor.cs:95` | Rejects oversized tool payload; suppresses evidence publication. |
| **Turn Total Character Cap** | 40,000 chars / turn | `AiToolContext.cs:67`, `AiToolExecutor.cs:95` | Caps aggregate tool output across all rounds in a turn. |
| **Output Token Limit** | 2,400 tokens | `AiAgentEngine.cs:12, 75` | Configured on OpenAI Responses API request. |
| **Daily Token Allowance** | 100,000 tokens / day | `AiAgentEngine.cs:26, 65-66` | Admission check against `AiUsage` table; blocks turn if spent $\ge 100\text{k}$. |
| **HTTP Rate Limiting** | 20 requests / min | `Program.cs:138-140` | Fixed-window partition limiter on `/api/ai/chat`; returns HTTP 429. |
| **Prompt Memory Cap** | 12,000 characters | `AiConversationMemoryService.cs:10, 339` | Chat history replayed into prompt is truncated via keyword scoring. |
| **In-Turn Tool Caching** | Canonical JSON key | `AiToolExecutor.cs:54-55` | Duplicate tool calls with identical arguments return cached results at 0 cost. |

#### Atomic Token Metering Guarantee (`AiChatUsageMeter.cs:17-54`, `AiAgentEngine.cs:85-87`)
Token usage is recorded atomically in PostgreSQL using EF Core `ExecuteUpdateAsync`. Crucially, usage is recorded **immediately after each round** under a separate 5-second timeout (`AiAgentEngine.cs:85-87`). If round 4 times out or fails, tokens consumed during rounds 1, 2, and 3 are never lost.

---

### 3.4 Frontend Confirmation Gates

Proposed actions are rendered in the chat window using `AiActionReview.tsx:20-37`:
* The user is presented with the target screen name and a disclaimer: *"Opens the existing screen. Changes still need your confirmation there."*
* Two buttons are provided: **Dismiss** and **Open**.

#### Operational Flow (`useAiConversation.ts:173-189`):
1. **Dismiss**:
   - Posts `/api/ai/action-batches/{batchId}/resolve` with `resolution = "dismissed"`.
   - Backend marks `ActionsResolvedAt` and `ActionsDismissedAt`.
   - Frontend removes the review card. The chat remains open; no navigation occurs.
2. **Open**:
   - Posts `/api/ai/action-batches/{batchId}/resolve` with `resolution = "accepted"`.
   - Backend marks `ActionsResolvedAt`.
   - Frontend closes the AI panel and dispatches the action to `handleAiActions` (`App.tsx:294-334`), opening the requested modal or switching the active tab.

---

## Section 4: Architectural Gaps & Actionable Recommendations

To elevate Ask AI into an authoritative coaching partner while maintaining domain safety and zero unreviewed data mutations, we recommend four targeted initiatives:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                   RECOMMENDED TARGET ARCHITECTURE                      â”‚
â”‚                                                                        â”‚
â”‚   [Data Enrichment]                                                    â”‚
â”‚   â€¢ Expose all-time PRs in get_exercise_progress (~120 chars)          â”‚
â”‚   â€¢ Include WorkoutSession.Note in get_workout_detail                  â”‚
â”‚   â€¢ Add pagination (fromDate, toDate) to get_exercise_progress         â”‚
â”‚   â€¢ Expose adherence & skip stats in get_program_overview              â”‚
â”‚                                                                        â”‚
â”‚   [Dual-Track Prompt Refactoring]                                      â”‚
â”‚   â€¢ Track 1: Algorithmic Baseline (transparent formula reporting)      â”‚
â”‚   â€¢ Track 2: Autonomous Coach Appraisal (autoregulation for fatigue/pain)â”‚
â”‚                                                                        â”‚
â”‚   [Action Proposer Safe Expansion]                                     â”‚
â”‚   â€¢ draftWorkout: in-memory interactive workout draft                  â”‚
â”‚   â€¢ suggestSubstitution: exercise swap confirmation sheet              â”‚
â”‚   â€¢ Multi-choice batches (maxItems = 3) for navigation comparisons     â”‚
â”‚                                                                        â”‚
â”‚   [New Specialized Tools]                                              â”‚
â”‚   â€¢ simulate_progression: hypothetical "what-if" projection            â”‚
â”‚   â€¢ get_batch_exercise_progress: 5 exercises in 1 tool call            â”‚
â”‚   â€¢ get_fatigue_summary: systemic / weekly muscle load analytics       â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### 4.1 High-Impact Data Access Enhancements

#### Recommendation 1: Expose Personal Records (PRs) in `GetExerciseProgressTool`
* **Mechanism**: Leverage the cached analytics from `ExerciseService.BuildInsight` / `ExerciseInsight`.
* **Payload Addition**: In `GetExerciseProgressTool.ExecuteAsync`, inject an `allTimeBests` block:
  ```json
  "allTimeBests": {
    "estimated1Rm": { "weight": 140.0, "date": "2026-05-12" },
    "heaviestSet": { "weight": 130.0, "reps": 3, "date": "2026-06-01" },
    "repRecord": { "reps": 15, "weight": 100.0, "date": "2026-04-10" },
    "largestSessionVolume": { "volume": 4200.0, "date": "2026-07-15" },
    "totalLifetimeSessions": 42
  }
  ```
* **Payload Budget**: ~120 characters (~30 tokens). Fits comfortably within the 12,000-character single-result limit.
* **Impact**: Unlocks the ability to confirm PRs, evaluate career trajectory, and contextualize current training performance.

#### Recommendation 2: Include Session Notes in Workout Tools
* **Mechanism**: Project `workout.Note` into the DTO in `GetWorkoutDetailTool.cs:96-107` and a 100-character truncated preview in `GetWorkoutHistoryTool.cs:154-162`.
* **Payload Budget**: ~50â€“150 characters.
* **Impact**: Gives the AI qualitative visibility into user-reported illness, joint pain, equipment variations, and travel fatigue.

#### Recommendation 3: Add Pagination and Date Filters to `GetExerciseProgressTool`
* **Mechanism**: Add optional `fromDate`, `toDate`, and `limit` (int 1â€“15, def 5) to `GetExerciseProgressTool.ParametersSchema`.
* **Impact**: Eliminates the 5-session horizon barrier, allowing lifters to ask about previous mesocycles or year-over-year progress.

#### Recommendation 4: Expose Program Adherence Records in `GetProgramOverviewTool`
* **Mechanism**: Query `_db.ProgramDayProgresses` (`ProgramProgressService.cs`).
* **Payload Addition**: Return completed days, skipped days, pending days, and adherence rate.
* **Impact**: Allows the AI to identify adherence failures as the root cause of stalled progress before recommending premature deloads.

---

### 4.2 Prompt Refactoring: The Dual-Track Architecture

#### Recommendation 5: Transition to Dual-Track Reasoning in `AiAgentPrompt.cs:34-46`
Replace the restrictive formula subservience directive with a **Dual-Track (Baseline + Autonomous Coach)** structure:

```diff
- - Explain the app's own suggestion and reason from the tool result; do not invent a
-   different progression rule or promise what the next suggestion will be.
+ - Present the app's suggestion and reason from the tool result as the algorithmic baseline.
+ - Then, provide your independent coaching evaluation: assess whether this baseline fits the lifter's
+   current state. If the user reports fatigue, illness, joint pain, or significant life stress,
+   or if their recent set history reveals technical failure/grinding, offer an autoregulated coaching
+   opinion (e.g. holding weight, adjusting reps, or proposing a back-off set). Clearly distinguish
+   the app's automated baseline from your coaching advice.
```

#### Recommendation 6: Disentangle Anti-Fabrication from Forward-Looking Recommendations
Refactor Rule 1 (`AiAgentPrompt.cs:20-21`) to distinguish historical truth from forward-looking programming:

```diff
- 1. Use ONLY the tools provided to look up data. NEVER fabricate exercise names, workout
-    details, set/rep numbers, weights, or dates.
+ 1. Ground all historical claims in tool results. NEVER fabricate past workouts, past weights,
+    or logged set/rep history. However, when proposing forward-looking workout adjustments,
+    warm-up ramps, or coaching recommendations, you are encouraged to propose specific, reasoned
+    loads and rep targets based on the user's equipment and recent performance.
```

---

### 4.3 Safe Expansion of `AiActionProposer`

#### Recommendation 7: Parameterized In-Memory Workout Drafts (`draftWorkout`)
* **Concept**: Add `draftWorkout` to `AllowedTypes` in `AiActionProposer.cs:9`.
* **Payload Schema**:
  ```json
  {
    "type": "draftWorkout",
    "payload": {
      "name": "Shoulder Hypertrophy Focus",
      "exercises": [
        { "exerciseId": "uuid", "sets": 3, "repMin": 8, "repMax": 12, "targetRpe": 8 }
      ]
    }
  }
  ```
* **Zero-Mutation Safety Guarantee**: Tapping "Open" launches the frontend `WorkoutSheet` populated with the drafted exercises in an in-memory draft state. The lifter can edit sets, swap exercises, and must explicitly tap "Start" or "Save" to commit data to PostgreSQL.

#### Recommendation 8: Exercise Substitution Action (`suggestSubstitution`)
* **Concept**: Allow Ask AI to propose swapping an exercise in the active workout or current template when the lifter reports joint discomfort or equipment unavailability.
* **Safety Guarantee**: Launches the existing `ExerciseSubstitution.tsx` modal for explicit user confirmation.

#### Recommendation 9: Relax Proposal Limit to `maxItems = 3` for Navigation
* **Concept**: Allow up to 3 actions when proposing navigation choices, allowing the assistant to present comparative workout options (e.g. `[Upper A]` vs `[Upper B]`).

---

### 4.4 New Tool Capabilities

#### Recommendation 10: Progression Simulation Tool (`simulate_progression`)
* **Concept**: Expose `PrescriptionProgression.Suggest` via a read-only simulation tool.
* **Arguments**: `exercise` (string/slug), `hypotheticalSets` (array of `{ weight, reps, rir }`).
* **Impact**: Allows Ask AI to answer hypothetical "what-if" questions accurately (e.g. *"If I hit 80kg for 9 reps today at RIR 2, what will the app suggest next time?"*) without guessing or violating anti-fabrication rules.

#### Recommendation 11: Batch Exercise Progress Tool (`get_batch_exercise_progress`)
* **Concept**: Accept up to 5 exercise slugs in a single tool call, returning condensed progression blocks.
* **Impact**: Eliminates tool-call budget exhaustion during multi-lift routine reviews (e.g. reviewing Squat, Bench, and Deadlift together).

#### Recommendation 12: Systemic Fatigue Summary Tool (`get_fatigue_summary`)
* **Concept**: Query acute 7-day tonnage, set volume per muscle group, and session density.
* **Impact**: Bridges the gap between intra-exercise fatigue and systemic, cross-exercise fatigue carry-over.

---

## Section 5: Comprehensive Code Reference & Verification Matrix

### 5.1 Comprehensive Code Reference Matrix

The following table provides an exhaustive index of every finding, formula, boundary, and rule analyzed in this report, mapped to its exact location in the `WorkoutApp` codebase:

| Subsystem / Concept | Source File Path | Line Range | Architectural Function & Finding |
|---|---|---|---|
| **Baseline Snapshot Builder** | `api/Services/AI/Agent/AiBaselineSnapshotBuilder.cs` | lines 10â€“52 | Assembles compact session facts; omits past workouts, PRs, notes, and fatigue metrics. |
| **Baseline Evidence Registration** | `api/Services/AI/Agent/AiBaselineSnapshotBuilder.cs` | lines 48â€“49 | Records only active program ID and active workout ID into `AiEvidenceLedger`. |
| **Omitted Template IDs Rule** | `api/Services/AI/Agent/AiBaselineSnapshotBuilder.cs` | line 23 | Confirms omitted template IDs cannot authorize UI actions. |
| **Tool Registry & Ordering** | `api/Services/AI/Tools/AiToolRegistry.cs` | lines 9â€“23 | Registers and orders the 8 canonical read tools. |
| **Registered AI Tools DI** | `api/Program.cs` | lines 108â€“116 | Dependency injection registration for all 8 AI read tools. |
| **HTTP Rate Limiter (20 req/min)**| `api/Program.cs` | lines 138â€“140 | Fixed-window rate limiter policy on `/api/ai/chat`. |
| **Peer Nutrition Client Timeout** | `api/Program.cs` | line 125 | 10-second timeout on outgoing HTTP requests to NutritionApp. |
| **System Prompt Persona & Rules** | `api/Services/AI/Agent/AiAgentPrompt.cs` | lines 14â€“33 | Persona, tone, anti-fabrication (Rule 1), and read-only (Rule 2) constraints. |
| **Hardcoded Fatigue Mandate** | `api/Services/AI/Agent/AiAgentPrompt.cs` | lines 41â€“43 | Mandates attributing later dips to carried-over fatigue; commands holding load. |
| **Progression Deferral Rule** | `api/Services/AI/Agent/AiAgentPrompt.cs` | lines 44â€“45 | Prohibits inventing progression rules or predicting next suggestions. |
| **Context Inference Restriction** | `api/Services/AI/Agent/AiAgentPrompt.cs` | lines 54â€“56 | Forbids inferring unlogged effort, sleep, illness, injury, or unlogged activity. |
| **Tool Limit Note Developer Msg** | `api/Services/AI/Agent/AiAgentPrompt.cs` | lines 9â€“11 | Message injected when tool rounds reach maximum ceiling. |
| **Tool Calling Rounds Limit (4)** | `api/Services/AI/Agent/AiAgentEngine.cs` | line 11, 67â€“69 | Enforces `MaxToolRounds = 4`; forces `toolChoice = "none"` at round 5. |
| **Maximum Output Tokens (2,400)** | `api/Services/AI/Agent/AiAgentEngine.cs` | lines 12, 75 | Configured output token ceiling for provider responses. |
| **Daily Token Allowance Check** | `api/Services/AI/Agent/AiAgentEngine.cs` | lines 26, 65â€“66 | Parses `Ai:ChatDailyTokenLimit` (100k) and performs pre-call admission check. |
| **Multi-Round Token Accounting** | `api/Services/AI/Agent/AiAgentEngine.cs` | lines 85â€“87 | Records consumed tokens immediately after each round under a 5s deadline. |
| **Turn Budget Constants** | `api/Services/AI/Tools/AiToolContext.cs` | lines 66â€“68 | `DefaultMaxToolCalls = 8`, `DefaultMaxResultCharacters = 40_000`, `DefaultMaxCharactersPerResult = 12_000`. |
| **Evidence Ledger Storage** | `api/Services/AI/Tools/AiToolContext.cs` | lines 32â€“61 | Implements `AiEvidenceLedger` tracking surfaced Workout, Exercise, Program, and Template IDs. |
| **In-Turn Tool Result Caching** | `api/Services/AI/Tools/AiToolExecutor.cs` | lines 23, 54â€“55 | Canonical JSON argument caching preventing redundant queries. |
| **Tool Error Envelopes** | `api/Services/AI/Tools/AiToolExecutor.cs` | lines 44â€“51, 70â€“78 | Traps exceptions and converts them into model-readable JSON error envelopes. |
| **Deferred Evidence Merging** | `api/Services/AI/Tools/AiToolExecutor.cs` | lines 65, 101 | Merges evidence into context *only* after output passes character budget checks. |
| **Allowed Actions Whitelist** | `api/Services/AI/Agent/AiActionProposer.cs` | lines 9â€“10 | Whitelist of 6 allowed action types (`openWorkout`, `openExercise`, etc.). |
| **Single Action Check (`maxItems=1`)**| `api/Services/AI/Agent/AiActionProposer.cs` | lines 21, 49â€“50 | Rejects proposal arrays exceeding 1 action or repeated calls in a turn. |
| **Evidence Verification Check** | `api/Services/AI/Agent/AiActionProposer.cs` | lines 92â€“99 | Verifies payload IDs against `AiEvidenceLedger`; rejects unsurfaced IDs. |
| **Turn Execution Timeout (150s)** | `api/Services/AI/AiAssistantService.cs` | lines 78â€“90 | 150-second overall turn timeout with graceful pending state rollback. |
| **Max User Input Message Length** | `api/Services/AI/AiAssistantService.cs` | lines 13, 52â€“54 | Rejects prompt input exceeding 2,000 characters. |
| **Smalltalk Regex Interception** | `api/Services/AI/AiAssistantService.cs` | lines 13â€“16, 240â€“259| Bypasses model invocation for greetings, thanks, and identity questions. |
| **Enforced Approximate Disclaimer**| `api/Services/AI/AiAssistantService.cs` | lines 176â€“178, 261â€“268| Appends approximation disclaimer if truncated data lacks model disclaimer. |
| **Conversation Memory Caps** | `api/Services/AI/AiConversationMemoryService.cs` | lines 10â€“20, 305â€“346| Enforces 12,000 character prompt history cap and keyword-scored turn selection. |
| **Tool Trace Summary Stripping** | `api/Services/AI/AiConversationMemoryService.cs` | lines 248â€“253, 348â€“350| Compresses tool calls to 160-char descriptions; strips return payloads from memory. |
| **Atomic Token Usage Persistence**| `api/Services/AI/AiChatUsageMeter.cs` | lines 17â€“54 | Atomic database update of input, output, cached, and reasoning tokens. |
| **Daily Token Admission Query** | `api/Services/AI/AiChatUsageMeter.cs` | lines 9â€“15 | Reads today's spent tokens to evaluate admission against daily limit. |
| **Workout History Query & Cap** | `api/Services/AI/Tools/GetWorkoutHistoryTool.cs` | lines 46, 127â€“146 | Caps history at 20 (default 5); drops set records to a single `topSet`. |
| **Omission of Session Note** | `api/Services/AI/Tools/GetWorkoutDetailTool.cs` | lines 77, 96â€“107 | Maps `se.Note` but completely omits `workout.Note` (`WorkoutSession.Note`). |
| **Exercise Progress 5-Session Cap**| `api/Services/AI/Tools/GetExerciseProgressTool.cs` | lines 18â€“20, 117â€“118| Hardcoded 5 completed session limit (10 if focused set); no pagination. |
| **HowToRead Instruction Injection**| `api/Services/AI/Tools/GetExerciseProgressTool.cs` | lines 22â€“28 | Injects explicit instructions framing dips as carried-over fatigue. |
| **Suggestion Reason Erasure** | `api/Services/AI/Tools/ExerciseSetHistory.cs` | line 40 | Strips `suggestionReason` for all completed sessions older than index 0. |
| **Carried-Over Fatigue Calculation**| `api/Services/AI/Tools/ExerciseSetHistory.cs` | lines 83â€“85, 94 | Calculates `EarlierSetsPastTargetBy` using `ProgressionFatigue.Before`. |
| **Program Overview Current Week** | `api/Services/AI/Tools/GetProgramOverviewTool.cs` | line 69 | Restricts template queries strictly to `Week == currentWeek`. |
| **Muscle Balance Volume Query** | `api/Services/AI/Tools/GetMuscleBalanceTool.cs` | lines 40â€“42 | Returns volume distribution across muscle groups for 1w, 1m, 3m windows. |
| **Nutrition 7-Day Truncation** | `api/Services/AI/Tools/GetNutritionSummaryTool.cs` | lines 18, 38 | Truncates daily breakdown records to 7 days. |
| **Authoritative PR Read Model** | `api/Services/WorkoutPrReadService.cs` | lines 14â€“100 | Authoritative PR engine unreferenced by any AI tool. |
| **Authoritative Exercise Insights**| `api/Services/ExerciseService.cs` | lines 27â€“37, 186â€“265| `BuildInsight` computes all-time PRs and historical timeline; uncalled by AI. |
| **Program Day Progress Service** | `api/Services/ProgramProgressService.cs` | lines 8â€“100 | Manages program day adherence and skip records; uncalled by AI. |
| **Domain Entity Definitions** | `api/Data/Entities.cs` | lines 223â€“355 | Defines `WorkoutSession` (`Note`), `SessionExercise`, `CompletedSet`. |
| **AppDb SaveChanges Tenancy Guard**| `api/Data/AppDb.cs` | lines 318â€“350 | Global tenancy filters and concurrency token write guards. |
| **E1RM & Running Strength Formulas**| `api/Domain/Progression.cs` | lines 120â€“151, 201â€“207| Epley formula with RIR; EMA trend formula: `0.3 * session + 0.7 * trend`. |
| **Double Progression Engine** | `api/Domain/PrescriptionProgression.cs` | lines 5â€“303 | Core algorithmic suggestion logic for load, reps, deloads, and plateaus. |
| **Layoff Decay Factors** | `api/Domain/PrescriptionProgression.cs` | lines 50â€“66 | Layoff deload policies: 15â€“27d hold, 28â€“55d -10%, 56d+ -20%. |
| **Excused Fatigue Dip Logic** | `api/Domain/PrescriptionProgression.cs` | lines 89â€“100 | Excuses dips if earlier sets overshot; commands repeating fresh reps. |
| **Hard Streak Deloads** | `api/Domain/PrescriptionProgression.cs` | lines 102â€“141 | 1 hard: repeat; 2 hard: step down; 3 hard: 7.5% deload. |
| **Plateau Reset Formula** | `api/Domain/PrescriptionProgression.cs` | lines 143â€“159 | 4 sessions stalled: 5% deload in normal mode; hold in deficit mode. |
| **Large Equipment Step Overshoot** | `api/Domain/PrescriptionProgression.cs` | lines 270â€“284 | Commands lifter to overshoot reps past range to bridge equipment gap. |
| **Intra-Session Fatigue Algorithm** | `api/Domain/ProgressionFatigue.cs` | lines 22â€“87 | Calculates `PriorOvershoot`, `PriorReserve`, and `FatigueReading`. |
| **Workout Start Suggestion Gen** | `api/Services/WorkoutService.Progression.cs` | lines 75â€“85 | Pre-calculates suggestions at workout start using `PrescriptionProgression`. |
| **NoHeavierThanBefore Guard** | `api/Services/WorkoutService.Progression.cs` | lines 145â€“175 | Ensures later sets start no heavier than earlier sets of same prescription. |
| **Nutrition Deficit Mode Switch** | `api/Services/NutritionContextService.cs` | lines 100â€“120 | Switches progression to `Conservative` or `Preservation` based on weight loss rate. |
| **Action Resolution Endpoint** | `api/Endpoints/AiEndpoints.cs` | lines 90â€“102 | HTTP endpoint for resolving proposed action batches (`accepted`/`dismissed`). |
| **Frontend Action Resolution Flow**| `web/src/components/useAiConversation.ts` | lines 173â€“189 | Handles Open vs Dismiss resolution and triggers client navigation. |
| **Frontend Action Review UI** | `web/src/components/ai/AiActionReview.tsx` | lines 5â€“37 | Renders action card with Open / Dismiss buttons and disclaimer. |
| **Frontend Navigation Handler** | `web/src/App.tsx` | lines 294â€“334 | Dispatches accepted UI actions (`openWorkout`, `openExercise`, etc.). |
| **Zero-Mutation Start Action Guard**| `web/src/App.tsx` | lines 328â€“332 | `openAddWorkoutDraft` strictly calls `setTab('program')`; does not start session. |

---

### 5.2 Verification Commands & Test Suites

The architectural boundaries, bounds, and behaviors documented in this report can be independently verified using the existing test suites in `WorkoutApp`:

#### 1. Backend Test Verification Suite (`WorkoutApp/tests/`)
Execute all Ask AI backend tests from PowerShell:
```powershell
cd d:\App\WorkoutApp\api
dotnet test d:\App\WorkoutApp\tests\WorkoutApp.Tests.csproj --filter "FullyQualifiedName~AskAi"
```

Specific test classes and methods verifying key invariants:
* **`tests/AskAiTests.cs`**:
  - `AiActionProposer_EnforcesEvidenceBarrier` (lines 45â€“89): Proves unsurfaced IDs throw argument exceptions while surfaced IDs are accepted.
  - `AiToolArgs_ThrowsOnInvalidOrMissingValues` (lines 36â€“44): Verifies tool argument boundary validation.
  - `ChatUsageMeter_RecordsDailyUsage` (lines 211â€“233): Verifies atomic token accounting.
* **`tests/AskAiReviewTests.cs`**:
  - `CompactBaselineCannotAuthorizeOmittedTemplateIds` (lines 38â€“55): Proves baseline context cannot authorize omitted template IDs.
  - `OversizedResultDoesNotGrantEvidenceForHiddenRecords` (lines 222â€“244): Proves failed character budget suppresses evidence ledger publication.
  - `MalformedProposalsAreRejectedWithoutThrowing` (lines 166â€“177): Confirms graceful handling of invalid proposals.
* **`tests/AskAiEngineTests.cs`**:
  - `LoopStopsAfterFourToolRoundsAndAccountsForEveryResponse` (lines 35â€“58): Proves engine cuts off tool execution after 4 rounds and forces `toolChoice = "none"`.
  - `LaterProviderFailureDoesNotEraseSuccessfulRoundUsage` (lines 59â€“72): Verifies multi-round token accounting persistence.
  - `ExhaustedDailyBudgetPreventsProviderCall` (lines 74â€“86): Proves 100k daily token admission barrier.
* **`tests/AskAiProgressionTests.cs`**:
  - `Progress_reports_each_working_set_with_its_effort...` (lines 40â€“71): Asserts `suggestionReason` is null for older sessions (`line 64`).
  - `Progress_marks_truncation_only_when_older_sessions_exist...` (lines 72â€“100): Confirms truncation flag triggers when sessions exceed 5.
* **`tests/AskAiDeadlineTests.cs`**:
  - `Overall_deadline_and_caller_cancellation...` (lines 14â€“51): Verifies that 150-second timeout rolls back pending state cleanly.

#### 2. Frontend Test Verification Suite (`WorkoutApp/web/`)
Execute Playwright integration tests covering action resolution and zero-mutation UI boundaries:
```powershell
cd d:\App\WorkoutApp\web
npx.cmd playwright test tests/ask-ai.spec.ts
```

Specific test specifications verifying key invariants:
* `Ask AI keeps action review until requested and preserves chat` (`web/tests/ask-ai.spec.ts:57-94`): Verifies Dismiss button resolves batch, Open button renders, and chat history is preserved.
* `Ask AI opens the Workouts screen without starting a session` (`web/tests/ask-ai.spec.ts:96-125`): Verifies that `openAddWorkoutDraft` navigates to the Workouts screen without starting a session.

#### 3. Non-Destructive Integrity Verification
Confirm that no project source files, tests, or configurations were modified during this investigation:
```powershell
cd d:\App\WorkoutApp
git status
```

---

*Master Findings Report authored and verified under Teamwork protocol for milestone delivery.*
