# Exhaustive Technical Audit Report: WorkoutApp AI Program Import Feature

**Target System**: WorkoutApp (`WorkoutApp/api` & `WorkoutApp/web`)
**Audit Scope**: AI Prompt Instructions, Schema Specifications, Transport Envelope Parsing, Set/Rep Handling, Duration Tracking, Weight Modalities, Catalog Matching, and Domain Model Ingestion
**Audit Status**: Complete (Version 2.0.0 — Post-Gate Remediation)
**Date of Audit**: November 10, 2026
**Integrity Mode**: Full Technical Inspection (Zero Fabrication, 100% Empirical Verification)

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
   - [1.1 Flawlessness Assessment](#11-flawlessness-assessment)
   - [1.2 High-Level Severity Breakdown](#12-high-level-severity-breakdown)
   - [1.3 Architecture Overview of Dual Import Pipelines](#13-architecture-overview-of-dual-import-pipelines)
   - [1.4 Core Architectural Gaps & Findings Overview](#14-core-architectural-gaps--findings-overview)
2. [Comprehensive Findings Catalog](#2-comprehensive-findings-catalog)
   - [Section A: AI Prompt Instructions, Contradictions, and Fidelity Loss](#section-a-ai-prompt-instructions-contradictions-and-fidelity-loss)
     - [Finding A.1: Superset Labeling Direct Contradiction Causes Fatal Validation Rejection](#finding-a1-superset-labeling-direct-contradiction-causes-fatal-validation-rejection)
     - [Finding A.2: System Prompt Mandate to Strip "Weighted" Causes Bodyweight Modality Erasure](#finding-a2-system-prompt-mandate-to-strip-weighted-causes-bodyweight-modality-erasure)
     - [Finding A.3: Forced Integer Snapping in Pipeline B Destroys Half-Point RPE Precision](#finding-a3-forced-integer-snapping-in-pipeline-b-destroys-half-point-rpe-precision)
     - [Finding A.4: Prompt Instruction Misleads Model to Emit Unsupported Set Types (e.g. Cluster Sets)](#finding-a4-prompt-instruction-misleads-model-to-emit-unsupported-set-types-eg-cluster-sets)
   - [Section B: JSON Detection, Extraction, & Syntax Fragility](#section-b-json-detection-extraction--syntax-fragility)
     - [Finding B.1: Rejection of Markdown Code Fences Without Sanitization](#finding-b1-rejection-of-markdown-code-fences-without-sanitization)
     - [Finding B.2: Rejection of Conversational Preambles and Postambles](#finding-b2-rejection-of-conversational-preambles-and-postambles)
     - [Finding B.3: Intolerance to Trailing Commas and Inline Comments](#finding-b3-intolerance-to-trailing-commas-and-inline-comments)
     - [Finding B.4: Deserialization Intolerance to Non-Numeric Strings (Ranges, Word Numbers, Units) in Numeric Fields](#finding-b4-deserialization-intolerance-to-non-numeric-strings-ranges-word-numbers-units-in-numeric-fields)
     - [Finding B.5: Schema Property Whitelist Over-Strictness Rejects Common Fitness Metadata](#finding-b5-schema-property-whitelist-over-strictness-rejects-common-fitness-metadata)
   - [Section C: Sets, Reps, and Set Types](#section-c-sets-reps-and-set-types)
     - [Finding C.1: Case-Sensitive String Switch Crashes on Standard Acronyms ("AMRAP") and Capitalized Types](#finding-c1-case-sensitive-string-switch-crashes-on-standard-acronyms-amrap-and-capitalized-types)
     - [Finding C.2: Missing Native Domain Support for Common Set Variations (Failure, Rest-Pause, Cluster)](#finding-c2-missing-native-domain-support-for-common-set-variations-failure-rest-pause-cluster)
     - [Finding C.3: Pipeline B Schema Lacks Warmup Property, Silently Converting Warmup Sets to Working Sets](#finding-c3-pipeline-b-schema-lacks-warmup-property-silently-converting-warmup-sets-to-working-sets)
     - [Finding C.4: Rejection of Single Rep Bounds and 0-Rep Isometric Prescriptions](#finding-c4-rejection-of-single-rep-bounds-and-0-rep-isometric-prescriptions)
     - [Finding C.5: Inverted Pyramid Rep Ranges Trigger Domain Validation Exception](#finding-c5-inverted-pyramid-rep-ranges-trigger-domain-validation-exception)
   - [Section D: Exercise Types & Duration-Based Exercises](#section-d-exercise-types--duration-based-exercises)
     - [Finding D.1: Total Absence of Duration and Tracking Mode in Import Schemas](#finding-d1-total-absence-of-duration-and-tracking-mode-in-import-schemas)
     - [Finding D.2: Pipeline A Bypasses Duration Normalization, Converting Timed Holds to High Rep Counts](#finding-d2-pipeline-a-bypasses-duration-normalization-converting-timed-holds-to-high-rep-counts)
     - [Finding D.3: Custom/Unmapped Timed Exercises Default to Reps, Triggering Validation Failures](#finding-d3-customunmapped-timed-exercises-default-to-reps-triggering-validation-failures)
     - [Finding D.4: Compound Duration Regex Failure on Natural Time Expressions](#finding-d4-compound-duration-regex-failure-on-natural-time-expressions)
   - [Section E: Weight Modalities (Pure Weight, Bodyweight, Added Weight, Assisted Weight)](#section-e-weight-modalities-pure-weight-bodyweight-added-weight-assisted-weight)
     - [Finding E.1: Absolute Prescribed Loads in `loadText` Ignored by Progression and Hidden in Workout UI](#finding-e1-absolute-prescribed-loads-in-loadtext-ignored-by-progression-and-hidden-in-workout-ui)
     - [Finding E.2: Bodyweight Movements with Added Load Misclassified as Pure Bodyweight](#finding-e2-bodyweight-movements-with-added-load-misclassified-as-pure-bodyweight)
     - [Finding E.3: Assisted Bodyweight Sign Inversion and Modality Classification Discrepancies](#finding-e3-assisted-bodyweight-sign-inversion-and-modality-classification-discrepancies)
   - [Section F: Domain Model Mapping, Catalog Matching & Edge Cases](#section-f-domain-model-mapping-catalog-matching--edge-cases)
     - [Finding F.1: Deceptive UI Banner Assures Unmapped Exercises Can Be Logged While Backend 409 Hard-Blocks Creation](#finding-f1-deceptive-ui-banner-assures-unmapped-exercises-can-be-logged-while-backend-409-hard-blocks-creation)
     - [Finding F.2: Single-Exercise Lettering Crashes Superset Validator](#finding-f2-single-exercise-lettering-crashes-superset-validator)
     - [Finding F.3: Active Recovery Rest Days Containing Mobility Exercises Rejected with HTTP 400](#finding-f3-active-recovery-rest-days-containing-mobility-exercises-rejected-with-http-400)
     - [Finding F.4: Strict Numeric RIR Regex Rejects Common Natural Fitness Formats](#finding-f4-strict-numeric-rir-regex-rejects-common-natural-fitness-formats)
     - [Finding F.5: String Length Limits and Unchecked Technique Concatenation Trigger Note Length Failures](#finding-f5-string-length-limits-and-unchecked-technique-concatenation-trigger-note-length-failures)
     - [Finding F.6: Exact Whitespace Validation on Superset SequenceGroup Rejects Trailing Spaces](#finding-f6-exact-whitespace-validation-on-superset-sequencegroup-rejects-trailing-spaces)
3. [Master Defect Inventory & Impact Matrix](#3-master-defect-inventory--impact-matrix)
4. [Remediation & Actionable Recommendations Roadmap](#4-remediation--actionable-recommendations-roadmap)
   - [4.1 Pipeline A Transport & JSON Sanitization Layer](#41-pipeline-a-transport--json-sanitization-layer)
   - [4.2 Prompt Template Harmonization](#42-prompt-template-harmonization)
   - [4.3 Pipeline B Schema & Conversion Corrections](#43-pipeline-b-schema--conversion-corrections)
   - [4.4 Domain Model & Weight Modality Enhancements](#44-domain-model--weight-modality-enhancements)
   - [4.5 UI Honesty & Validation Alignment](#45-ui-honesty--validation-alignment)
5. [Verification & Testing Protocol](#5-verification--testing-protocol)
   - [5.1 Test Execution Suite Commands](#51-test-execution-suite-commands)
   - [5.2 Empirical Regression Test Matrix](#52-empirical-regression-test-matrix)
6. [Document Revision History & Changelog](#6-document-revision-history--changelog)

---

## 1. Executive Summary

### 1.1 Flawlessness Assessment
WorkoutApp's AI program import feature is **NOT flawless**. It exhibits severe, systemic fragility, internal prompt contradictions, schema omissions, and domain mapping flaws that prevent successful program ingestion and corrupt workout data.

When tested against realistic outputs generated by contemporary Large Language Models (LLMs) such as Claude 3.5 Sonnet, GPT-4o, and Gemini 1.5 Pro, an unassisted copy-paste or upload fails in the majority of real-world scenarios. The system suffers from fatal crashes on standard fitness notation (such as uppercase `"AMRAP"` or lettered exercises), completely erases prescribed added weights from bodyweight movements, converts duration-based exercises into absurd rep counts (e.g. 60 repetitions of Plank), silently converts warm-up sets into working sets, and displays deceptive UI messaging promising that unmapped exercises can be logged while the backend rejects program creation with HTTP 409 Conflict.

### 1.2 High-Level Severity Breakdown
A total of **27 distinct technical defects** were identified, categorized across four severity tiers:

```
+-------------------------------------------------------------------------+
| TOTAL IDENTIFIED DEFECTS: 27                                            |
|                                                                         |
|  [ CRITICAL ]   4 Issues  (14.8%) - Near-universal submission failures  |
|  [ HIGH ]      10 Issues  (37.0%) - Fatal import crashes / Data loss     |
|  [ MEDIUM ]    11 Issues  (40.7%) - Feature degradation / Misleading UI |
|  [ LOW ]        2 Issues  (7.5%)  - String edge cases / Formatting friction|
+-------------------------------------------------------------------------+
```

- **Critical (4 issues)**: Syntax envelope and type deserialization intolerance (markdown code fences, conversational preambles/postambles, trailing commas/inline comments, non-numeric strings in numeric fields) causing immediate HTTP 400 rejection on standard LLM completions.
- **High (10 issues)**: Superset prompt contradiction blocking import; case-sensitive switch crashing on `"AMRAP"`; Pipeline B schema lacking `warmup` property (converting warmups to working sets); duration exercises converted to rep counts; absolute weights in `loadText` ignored and hidden; weighted bodyweight movements misclassified as pure bodyweight (erasing added weight); deceptive UI banner claiming unmapped exercises can be logged while backend blocks program creation with HTTP 409.
- **Medium (11 issues)**: Schema property whitelist over-strictness rejecting standard fitness metadata (`equipment`); assisted bodyweight sign inversion validation failure; missing set types (`failure`, `rest-pause`, `cluster`); single rep bound rejection (`"repMin": 10`); 0 reps for isometrics rejection; compound duration regex failure (`1 min 30 sec`); active recovery rest day rejection; single-exercise lettering superset crash (`A. Squat`); RIR regex crashing on `"RIR 2"`; forced loss of half-point RPE precision in Pipeline B; prompt instruction misleading model on cluster sets.
- **Low (2 issues)**: Trailing whitespace rejection on `sequenceGroup`; note overflow caused by unchecked technique string concatenation.

### 1.3 Architecture Overview of Dual Import Pipelines
WorkoutApp maintains two completely distinct architectural pipelines for AI-driven program ingestion:

```
+-----------------------------------------------------------------------------------------------+
| PIPELINE A: External AI Assistant Import                                                     |
|                                                                                               |
| User Browser                   External LLM                     WorkoutApp Backend            |
| +-------------------------+    +-----------------------+        +--------------------------+  |
| | 1. Fetch Prompt Template|--->| User provides PDF/Doc |        | GET /api/imports/external|  |
| |   (ExternalImportPrompt)|    | + Prompt Template     |        |      /prompt             |  |
| +-------------------------+    +-----------------------+        +--------------------------+  |
|              |                             |                                                  |
|              v                             v                                                  |
| +-------------------------+    +-----------------------+        +--------------------------+  |
| | 2. Paste JSON / Upload  |    | Returns raw JSON      |------->| POST /api/imports/       |  |
| |   (ImportExternalPanel) |    | (often with fences)   |        |      external            |  |
| +-------------------------+    +-----------------------+        +--------------------------+  |
|                                                                              |                |
|                                                                              v                |
|                                                                 +--------------------------+  |
|                                                                 | Strict Envelope Parser   |  |
|                                                                 | (ExternalImportEnvelope) |  |
|                                                                 +--------------------------+  |
|                                                                              |                |
|                                                                              v                |
|                                                                 +--------------------------+  |
|                                                                 | Strict Whitelist Schema  |  |
|                                                                 | (ExternalImportSchema)   |  |
|                                                                 +--------------------------+  |
|                                                                              |                |
|                                                                              v                |
|                                                                 +--------------------------+  |
|                                                                 | Ingestion Orchestrator   |  |
|                                                                 | (ImportService.External) |  |
|                                                                 +--------------------------+  |
+-----------------------------------------------------------------------------------------------+

+-----------------------------------------------------------------------------------------------+
| PIPELINE B: In-App Automated PDF AI Extraction                                                |
|                                                                                               |
| Mobile / Web Client                     WorkoutApp Backend                 OpenAI API         |
| +-------------------------+             +----------------------+           +---------------+  |
| | 1. Upload PDF Document  |------------>| Extract Text Chunks  |---------->| Responses API |  |
| |    (PDF Ingestion)      |             | (PdfPageTextExtract) |           | json_schema   |  |
| +-------------------------+             +----------------------+           | strict: true  |  |
|                                                    |                       +---------------+  |
|                                                    v                               |          |
|                                         +----------------------+                   |          |
|                                         | Draft Conversion     |<------------------+          |
|                                         | (DraftConversion.cs) | Structured JSON Response     |
|                                         +----------------------+                              |
|                                                    |                                          |
|                                                    v                                          |
|                                         +----------------------+                              |
|                                         | Normalization Engine |                              |
|                                         | (ImportNormalization)|                              |
|                                         +----------------------+                              |
|                                                    |                                          |
|                                                    v                                          |
|                                         +----------------------+                              |
|                                         | Set Kinds & Hold Heur|                              |
|                                         | (ImportSetKinds.cs)  |                              |
|                                         +----------------------+                              |
+-----------------------------------------------------------------------------------------------+
```

#### Pipeline Comparison Table
| Feature / Characteristic | Pipeline A: External AI Assistant | Pipeline B: In-App Direct PDF Extraction |
|---|---|---|
| **Entry Point** | `POST /api/imports/external` | `POST /api/imports` + `POST /api/imports/{id}/extract` |
| **Model Hosting** | External third-party LLM (ChatGPT, Claude, etc.) | Backend OpenAI API invocation (`WorkoutAi.cs`) |
| **Prompt Delivery** | `ExternalImportPrompt.cs` (`external-json-v1`) | `WorkoutAiSchemas.cs` (`workout-import-v46...`) |
| **Schema Enforcement** | Manual property whitelist (`ExternalImportSchema.cs`) | OpenAI Structured Outputs (`json_schema`, `strict: true`) |
| **Syntax Sanitization** | **None**; strictly rejects fences/preambles | Guaranteed valid JSON by OpenAI token engine |
| **Draft Conversion** | `ImportService.External.cs` | `ImportService.DraftConversion.cs` |
| **Duration Normalization**| **Bypassed** (raw `repMin`/`repMax` preserved) | Invokes `ImportNormalization.Reps` / `IsDuration` |
| **Warmup Set Mapping** | Set-level property `warmup: true` or `type: "warmup"`| **Missing set-level schema field**; all sets `Warmup = false` |
| **RPE / RIR Rules** | Allows half-point RPE; string RIR | System prompt forces integer snapping of RIR/RPE |

### 1.4 Core Architectural Gaps & Findings Overview
1. **Zero-Tolerance Parsing vs Non-Deterministic LLMs**: Pipeline A assumes that external consumers receive pristine, naked JSON. In reality, modern chat LLMs wrap outputs in Markdown code fences and conversational pleasantries. Because `ExternalImportEnvelope.cs` refuses to trim fences or slice boundaries, out-of-the-box user experience is crippled.
2. **Schema Rigidity**: The manual property whitelist rejects any unknown attribute (`equipment`, `workingSets`, `targetMuscles`, `duration`). LLMs attempting to provide rich exercise context are penalized with HTTP 400 errors.
3. **Domain Representation Mismatch**: WorkoutApp's domain model (`SetPrescription`) has no numeric `DurationSeconds` or `WeightKg` field. It relies entirely on string `RepsText` and string `LoadText`. Consequently, downstream execution engines (progression, workout logger, timer) fail to identify target loads or durations unless secondary heuristics succeed.
4. **Modality Misclassification**: The resistance variant engine (`ResistanceVariant.cs`) derives loading mode (External vs Bodyweight vs Added vs Assistance) solely from the exercise name. It completely ignores `loadText` and set notes. Stripping the word "weighted" from an exercise name irreversibly strips the user's ability to log added weight during training.

---

## 2. Comprehensive Findings Catalog

### Section A: AI Prompt Instructions, Contradictions, and Fidelity Loss

---

#### Finding A.1: Superset Labeling Direct Contradiction Causes Fatal Validation Rejection
- **Component Affected**:
  - `api/Services/ExternalImportPrompt.cs`: Lines 23 vs 43
  - `api/Services/ImportService.External.cs`: Lines 57–65
- **Severity**: High (Fatal Import Blocker)
- **Description & Root Cause Mechanism**:
  `ExternalImportPrompt.cs` contains an irreconcilable contradiction regarding how supersets must be labeled:
  - Line 23 states: *"Use the same sequenceGroup for consecutive members of a superset; each group needs at least 2 exercises."* (This implies labeling both paired exercises with the exact same group key, e.g. `sequenceGroup: "A"`).
  - Line 43 states: *"- Superset labels such as A1, A2 or B1 are not part of an exercise name: use sequenceGroup."* (This explicitly instructs the LLM to write `sequenceGroup: "A1"` and `sequenceGroup: "A2"`).

  When an external LLM encounters a workout with exercises labeled "A1" and "A2", it follows line 43 and outputs:
  - Exercise 1: `"sequenceGroup": "A1"`
  - Exercise 2: `"sequenceGroup": "A2"`

  In `ImportService.External.cs`, lines 57–65 group exercises by `SequenceGroup`:
  ```csharp
  foreach (var group in exercises.Select((exercise, index) => (exercise, index))
      .Where(item => !string.IsNullOrWhiteSpace(item.exercise.SequenceGroup))
      .GroupBy(item => item.exercise.SequenceGroup, StringComparer.OrdinalIgnoreCase))
  {
      var positions = group.Select(item => item.index).ToList();
      Validation.Require(positions.Count >= ExternalImportLimits.MinSupersetExercises,
          "Each superset must contain at least two exercises.");
      ...
  }
  ```
  Because `"A1"` has `positions.Count == 1` and `"A2"` has `positions.Count == 1`, both fail the requirement `positions.Count >= 2`.
- **Triggering Workout Scenario**: Any standard workout program utilizing supersets or paired agonist/antagonist exercises transcribed with conventional fitness notation (e.g., A1 / A2, B1 / B2).
- **Impact**: The entire program is rejected with HTTP 400 `DomainException`. The user cannot import the workout without manually editing the JSON to rename "A1" and "A2" to "A".
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "Upper Superset Blast",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Upper Day",
          "exercises": [
            {
              "sourceName": "Incline Dumbbell Press",
              "sequenceGroup": "A1",
              "sets": [{ "repMin": 10, "repMax": 10 }]
            },
            {
              "sourceName": "Chest-Supported Row",
              "sequenceGroup": "A2",
              "sets": [{ "repMin": 10, "repMax": 10 }]
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request with error:
  `"Each superset must contain at least two exercises."` at path `$.program.days[0].exercises`
- **Expected Behavior**:
  The system should either recognize paired superset tags sharing a common prefix (A1, A2 -> Group A) or the prompt should be unified to eliminate the contradictory instruction.

---

#### Finding A.2: System Prompt Mandate to Strip "Weighted" Causes Bodyweight Modality Erasure
- **Component Affected**:
  - `api/Services/WorkoutAiSchemas.cs`: Line 22
  - `api/Domain/ResistanceVariant.cs`: Lines 17–27
  - `api/Services/WorkoutService.cs`: Lines 656–663
  - `web/src/components/WorkoutSetRow.tsx`: Lines 141–142
- **Severity**: High (Data Corruption & Feature Breakage)
- **Description & Root Cause Mechanism**:
  `WorkoutAiSchemas.Instructions` (line 22) commands the extraction LLM:
  > *"Do not fold a set method into sourceName: phrases such as lengthened partials, two drop sets, weighted static hold, extend set, or a parenthetical percentage describe how the set is performed. Put that technique in notes or coachingNotes and return the underlying movement in sourceName so the server can match it safely."*

  When processing movements such as "Weighted Dips (+20kg)" or "Weighted Chin-Ups (+25 lbs)", an LLM obeying this directive strips the modifier "Weighted" and outputs `sourceName: "Dip"` or `"Chin-Up"`, placing the load in `loadText` or `notes`.

  However, WorkoutApp's domain architecture in `ResistanceVariant.cs` (lines 17–27) determines whether a bodyweight exercise permits added load exclusively by inspecting the exercise name:
  ```csharp
  if (loadModel == LoadModels.FullBodyweight)
  {
      var name = exerciseName ?? "";
      if (Assisted().IsMatch(name)) return ResistanceModes.Assistance;
      return Weighted().IsMatch(name) ? ResistanceModes.Added : ResistanceModes.Bodyweight;
  }
  ```
  Because "Dip" and "Chin-Up" do not match the `Weighted()` regex (`\bweighted\b`), the exercise resolves to `ResistanceModes.Bodyweight`.

  During workout execution, `WorkoutService.ComputeSystemLoad` (lines 656–663) evaluates the load:
  ```csharp
  return resistanceMode switch
  {
      ResistanceModes.Bodyweight => reference,
      ResistanceModes.Added when input is { } added => reference + added,
      ...
  };
  ```
  For `ResistanceModes.Bodyweight`, the user's added weight `input` is completely discarded and replaced with `reference` (bodyweight only). Furthermore, in `WorkoutSetRow.tsx` (lines 141–142), the weight input field is disabled (`disabled={!loadEditable}`), locking the input cell to an empty dash.
- **Triggering Workout Scenario**: Any calisthenics or strength program prescribing weighted pull-ups, weighted dips, or weighted push-ups.
- **Impact**: The prescribed added weight is erased from system load calculations, progressive overload volume tracking is corrupted, and the user is blocked from logging added weight during live training.
- **Concrete Reproduction Prompt & Input**:
  A PDF table row: `Weighted Pull-Up | 3 sets | 5 reps | +20 kg`
  The LLM generates:
  ```json
  {
    "sourceName": "Pull-Up",
    "sets": [{ "repMin": 5, "repMax": 5, "loadText": "+20 kg", "notes": "Weighted" }]
  }
  ```
- **Observed Behavior**:
  1. `CatalogMatching.Find` matches `pull-up` (LoadModel: `full_bodyweight`).
  2. `ResistanceVariant.For` resolves `ResistanceModes.Bodyweight`.
  3. Active workout disables the weight input cell; system load ignores the +20 kg.
- **Expected Behavior**:
  The system should inspect `loadText`, set notes, or preserve "Weighted" in the exercise title, classifying the exercise as `ResistanceModes.Added`.

---

#### Finding A.3: Forced Integer Snapping in Pipeline B Destroys Half-Point RPE Precision
- **Component Affected**:
  - `api/Services/WorkoutAiSchemas.cs`: Line 25
  - `api/Domain/Validation.cs`: Lines 29–33, 88–92
- **Severity**: Medium (Fidelity Loss)
- **Description & Root Cause Mechanism**:
  WorkoutApp's core domain (`Validation.cs:29-33, 91`) explicitly supports half-point RPE precision (e.g. 6.5, 7.5, 8.5, 9.5):
  ```csharp
  public static void Rpe(double value, string name = "RPE")
  {
      Number(value, 6, 10, name);
      Require(Math.Abs(value * 2 - Math.Round(value * 2)) < 1e-9, $"{name} must use whole or half points.");
  }
  ```
  However, in Pipeline B's system instructions (`WorkoutAiSchemas.cs:25`), the prompt instructs the model to destroy this precision:
  > *"Target effort is measured in whole Reps in Reserve (RIR)... Do not allow partial .5 values for RIR; always snap to the nearest whole integer. When a table specifies RPE (such as RPE 8 or LSRPE 9), convert RPE to integer RIR: RIR = round(10 - RPE) (for example RPE 8 becomes RIR 2, RPE 9 becomes RIR 1, RPE 10 becomes RIR 0); set rir to that whole number string and targetRpe = 10 - rir."*

  When an authoritative strength program (such as Reactive Training Systems, Barbell Medicine, or Stronger By Science) prescribes `RPE 7.5` or `RPE 8.5`, the model computes:
  - For RPE 7.5: $10 - 7.5 = 2.5 \xrightarrow{\text{round}} 2$ or $3 \implies \text{targetRpe} = 8$ or $7$.
  - For RPE 8.5: $10 - 8.5 = 1.5 \xrightarrow{\text{round}} 1$ or $2 \implies \text{targetRpe} = 9$ or $8$.
- **Triggering Workout Scenario**: Any powerlifting or autoregulated strength program utilizing standard half-point RPE prescriptions (e.g. `Top Single @ RPE 8.5`).
- **Impact**: The prescribed training intensity is systematically altered by $\pm 0.5$ RPE (equivalent to approximately $\pm 2.5\%$ to $4\%$ 1RM intensity drift), distorting auto-regulation and progression recommendations.
- **Concrete Reproduction Input**:
  A PDF prescribing: `Competition Squat: 1 rep @ RPE 8.5`
- **Observed Behavior**:
  Model emits `"targetRpe": 8` or `"targetRpe": 9`, with `"rir": "1"` or `"rir": "2"`.
- **Expected Behavior**:
  Model should emit `"targetRpe": 8.5`, preserving the author's exact prescribed intensity.

---

#### Finding A.4: Prompt Instruction Misleads Model to Emit Unsupported Set Types (e.g. Cluster Sets)
- **Component Affected**:
  - `api/Services/ExternalImportPrompt.cs`: Lines 24 vs 42
  - `api/Services/ImportService.External.cs`: Lines 189–196
- **Severity**: Medium (Import Rejection)
- **Description & Root Cause Mechanism**:
  `ExternalImportPrompt.cs` (line 42) explicitly tells the model:
  > *"...and a technique label in brackets ("Cluster sets", "Myo-rep") belongs to that exercise's set type or notes, not to a new exercise."*

  This direct instruction implies that `"cluster"` is an acceptable value for `set.Type`.
  However, in line 24, the prompt enumerates the strict list of allowed set types:
  > *"The set type, when present, must be one of normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause."*

  Notice that `cluster` is completely missing from line 24. Furthermore, in `ImportService.External.cs` (lines 189–196), the backend switch throws a `DomainException` if `set.Type` is `"cluster"`.
- **Triggering Workout Scenario**: Any athletic or strength program utilizing cluster sets (e.g. `4 x (2+2+2)` cluster).
- **Impact**: When the model sets `"type": "cluster"`, the entire import is rejected with HTTP 400.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Power Clean",
    "sets": [{ "repMin": 3, "repMax": 3, "type": "cluster" }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause."`
- **Expected Behavior**:
  Either `"cluster"` should be supported as a valid set technique, or the prompt instruction should clarify that cluster sets must be placed in `notes`, not `type`.

---

### Section B: JSON Detection, Extraction, & Syntax Fragility

---

#### Finding B.1: Rejection of Markdown Code Fences Without Sanitization
- **Component Affected**:
  - `api/Services/ExternalImportEnvelope.cs`: Lines 18, 50–51
  - `web/src/lib/externalImport.ts`: Lines 25–28
- **Severity**: Critical (High Failure Rate for End Users)
- **Description & Root Cause Mechanism**:
  When users interact with web LLMs (ChatGPT, Claude, Gemini, DeepSeek), the assistant virtually always wraps structured code outputs in Markdown code fences:
  ````markdown
  ```json
  { "version": 1, ... }
  ```
  ````
  In `web/src/lib/externalImport.ts`, no client-side sanitization is performed; the raw text is sent directly to the server.

  In `ExternalImportEnvelope.cs`:
  ```csharp
  public static JsonDocument Parse(string input)
  {
      ...
      try
      {
          document = JsonDocument.Parse(input, new JsonDocumentOptions { MaxDepth = 64 });
      }
      catch (JsonException error)
      {
          throw new DomainException(ParseFailure(input, error), 400);
      }
  ```
  `JsonDocument.Parse` fails immediately on the leading backtick character (`'``'`). In `ParseFailure`, the code detects the backtick:
  ```csharp
  if (text.StartsWith("```", StringComparison.Ordinal))
      return "The file starts with a Markdown code fence (three backticks). Save only the JSON, from the opening { to the closing }.";
  ```
  Instead of stripping the fence with a simple regex or string trim, the server aggressively rejects the request with HTTP 400.
- **Triggering Workout Scenario**: Any user copying the response directly from ChatGPT or Claude into the "Paste the JSON" textarea or saving the assistant response as a file.
- **Impact**: Immediate import failure. Technical friction forces non-technical users to manually inspect and edit raw JSON.
- **Concrete Reproduction Payload**:
  ````text
  ```json
  {"version":1,"program":{"name":"Push Day","days":[{"key":"d1","week":1,"name":"Push","exercises":[{"sourceName":"Bench press","sets":[{"repMin":5,"repMax":5}]}]}]}}
  ```
  ````
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"The file starts with a Markdown code fence (three backticks). Save only the JSON, from the opening { to the closing }."`
- **Expected Behavior**:
  The parser should automatically strip leading ` ```json `, ` ``` `, and trailing ` ``` ` delimiters before parsing.

---

#### Finding B.2: Rejection of Conversational Preambles and Postambles
- **Component Affected**:
  - `api/Services/ExternalImportEnvelope.cs`: Lines 52–56
- **Severity**: Critical (High Failure Rate)
- **Description & Root Cause Mechanism**:
  Conversational assistants frequently prepend and append friendly commentary:
  > *"Sure! Here is your 4-day hypertrophy program in the requested WorkoutApp JSON format:"*
  > `{"version": 1, ...}`
  > *"Let me know if you would like me to adjust the volume or exercise selection!"*

  In `ExternalImportEnvelope.cs`, lines 52–56 enforce that the text must begin with `{` and contain no trailing characters:
  ```csharp
  if (text[0] != '{')
      return "The file does not start with {. It must contain only the JSON object, with no text before or after it.";
  var where = error.LineNumber is { } line ? $" near line {line + 1}, column {(error.BytePositionInLine ?? 0) + 1}" : "";
  return $"The file is not complete, valid JSON{where}. It may have been cut off, or have text outside the JSON. Ask the assistant to produce the whole file again.";
  ```
  Because the parser parses the entire raw string rather than extracting the JSON substring bounded between the first `{` and the last `}`, any conversational prose crashes the parser.
- **Triggering Workout Scenario**: Direct copy-pasting from chat interfaces without careful manual cropping.
- **Impact**: Immediate import failure with HTTP 400.
- **Concrete Reproduction Payload**:
  ```text
  Here is your requested program:
  {"version":1,"program":{"name":"PPL","days":[{"key":"d1","week":1,"name":"Push","exercises":[{"sourceName":"Bench press","sets":[{"repMin":8,"repMax":10}]}]}]}}
  Hope you enjoy the workout!
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"The file does not start with {. It must contain only the JSON object, with no text before or after it."`
- **Expected Behavior**:
  The parser should locate the outer JSON object boundaries (`IndexOf('{')` and `LastIndexOf('}')`) and extract the payload.

---

#### Finding B.3: Intolerance to Trailing Commas and Inline Comments
- **Component Affected**:
  - `api/Services/ExternalImportEnvelope.cs`: Line 18
- **Severity**: Critical (Syntax Fragility / Fatal Parsing Failure)
- **Description & Root Cause Mechanism**:
  In `ExternalImportEnvelope.cs`, line 18 initializes `JsonDocumentOptions`:
  ```csharp
  document = JsonDocument.Parse(input, new JsonDocumentOptions { MaxDepth = 64 });
  ```
  By default in .NET `System.Text.Json`, `JsonDocumentOptions.AllowTrailingCommas` is `false`, and `CommentHandling` is `JsonCommentHandling.Disallow`.

  LLMs frequently emit trailing commas when serializing arrays or objects (e.g. `[1, 2, 3,]` or `{"a": 1,}`), or emit inline developer comments (e.g. `// Working sets`). `System.Text.Json` throws a `JsonException`, and `ExternalImportEnvelope` returns an unhelpful syntax failure error.
- **Triggering Workout Scenario**: LLM generation with trailing commas in set/exercise lists or explanatory comments.
- **Impact**: HTTP 400 parsing failure.
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "Leg Day",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Squat Day",
          // Main compound movement
          "exercises": [
            {
              "sourceName": "Barbell Squat",
              "sets": [
                { "repMin": 5, "repMax": 5, }
              ],
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"The file is not complete, valid JSON near line 10, column 11..."`
- **Expected Behavior**:
  `JsonDocumentOptions` should enable `AllowTrailingCommas = true` and `CommentHandling = JsonCommentHandling.Skip`.

---

#### Finding B.4: Deserialization Intolerance to Non-Numeric Strings (Ranges, Word Numbers, Units) in Numeric Fields
- **Component Affected**:
  - `api/Services/Json.cs`: Line 5
  - `api/Services/ImportService.External.cs`: Lines 16–22
  - `api/Services/ExternalImportContracts.cs`: Lines 14, 43–46
  - `api/Services/ExternalImportFieldHints.cs`: Lines 27–28, 42–51
- **Severity**: Critical (Contract Type Inflexibility & Field Hint Misdirection)
- **Description & Root Cause Mechanism**:
  In `WorkoutApp/api/Services/Json.cs`, the shared JSON serializer options are configured with web defaults:
  ```csharp
  public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
  ```
  In modern .NET (`System.Text.Json`), `JsonSerializerDefaults.Web` explicitly configures `NumberHandling = JsonNumberHandling.AllowReadingFromString`. Consequently, quoted numeric digits (such as `"repMin": "8"`, `"repMax": "10"`, `"targetRpe": "8.5"`, `"restSeconds": "90"`, or `"week": "1"`) deserialize into their target numeric types (`int`, `int?`, `double?`) without throwing an exception.

  However, when an external LLM produces non-numeric string representations for numeric properties, deserialization fails catastrophically:
  1. **Range Strings in Numeric Bounds**: LLMs frequently populate rep bounds with range strings, such as `"repMin": "8-10"` (conflating `repsText` with `repMin`).
  2. **Written Word Numbers**: Tokenizers and LLM completions frequently write numbers phonetically, such as `"repMin": "eight"` or `"week": "one"`.
  3. **Duration Strings with Unit Suffixes**: LLMs often output rest intervals with units, such as `"restSeconds": "90s"` or `"60 sec"`.
  4. **Qualitative Tokens**: Prompts that do not strictly guard against qualitative targets can lead models to output `"repMin": "AMRAP"` or `"targetRpe": "max"`.

  When `System.Text.Json` attempts to deserialize these non-numeric string values into C# contract types (`int?`, `int`, `double?`), it throws a `JsonException`:
  `"The JSON value could not be converted to System.Nullable'1[System.Int32]. Path: $.days[0].exercises[0].sets[0].repMin"`

  In `ImportService.External.cs` (lines 17–22), this exception is caught and passed to `ExternalImportFieldHints.Describe`:
  ```csharp
  catch (JsonException error)
  {
      var (path, message) = ExternalImportFieldHints.Describe("$.program" + (error.Path is null or "$" ? "" : error.Path[1..]));
      throw ExternalImportPath.WithPath(new DomainException(message, 400), path);
  }
  ```
  `ExternalImportFieldHints` matches `repMin` (or `restSeconds`, `week`, etc.) and produces the user-facing diagnostic string:
  ```csharp
  hints[name] = $"{name} must be a whole number such as 8, written without quotes.";
  ```
  This error message is partially misleading: the rejection did not occur because the string was quoted (quoted integers like `"8"` deserialize cleanly), but because the string contained non-numeric characters (hyphens, words, or unit letters). The entire import is aborted with HTTP 400.
- **Triggering Workout Scenario**:
  - LLM transcribes a rep range by placing `"8-10"` into `repMin` instead of splitting lower/upper bounds into `repMin` and `repMax` or using `repsText`.
  - LLM adds units to rest durations (e.g. `"restSeconds": "90s"`).
  - LLM writes number words (e.g. `"repMin": "eight"`).
- **Impact**: Immediate HTTP 400 Bad Request rejection for programs with intelligible workout data.
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "Non-Numeric Property Value Test",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Upper Body",
          "exercises": [
            {
              "sourceName": "Dumbbell Press",
              "sets": [
                {
                  "repMin": "8-10",
                  "repMax": 10,
                  "targetRpe": 8
                }
              ]
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"repMin must be a whole number such as 8, written without quotes."` at path `$.program.days[0].exercises[0].sets[0].repMin`
  *(Similarly, passing `"restSeconds": "90s"` returns `"restSeconds must be a whole number such as 8, written without quotes."` at path `$.program.days[0].exercises[0].sets[0].restSeconds`, and passing `"repMin": "eight"` returns `"repMin must be a whole number such as 8, written without quotes."`)*.
- **Expected Behavior**:
  1. **Prompt Template Guidance**: `ExternalImportPrompt.cs` should explicitly instruct external models that `repMin` and `repMax` must be distinct numeric bounds, that range strings belong in `repsText`, and that `restSeconds` must be a pure integer without unit letters (`"s"` or `"sec"`).
  2. **Lenient Contract Converters**: Introduce custom `JsonConverter` implementations or DTO preprocessing for numeric contract properties to gracefully parse range strings (e.g. taking the lower bound from `"8-10"`) and strip unit suffixes (e.g. stripping `"s"` from `"90s"`).
  3. **Accurate Diagnostic Guidance**: Update `ExternalImportFieldHints.cs` so that the message accurately advises the user/assistant on non-numeric strings rather than claiming quotes are forbidden.

---

#### Finding B.5: Schema Property Whitelist Over-Strictness Rejects Common Fitness Metadata
- **Component Affected**:
  - `api/Services/ExternalImportSchema.cs`: Lines 29, 34, 142–151
- **Severity**: Medium (Extensibility Blocker)
- **Description & Root Cause Mechanism**:
  `ExternalImportSchema.ValidateProgram` uses a rigid whitelist:
  ```csharp
  private static void Object(JsonElement value, string name, string[] fields)
  {
      ...
      var allowed = new HashSet<string>(fields, StringComparer.OrdinalIgnoreCase);
      var errors = value.EnumerateObject()
          .Where(property => !allowed.Contains(property.Name) && !Ignored.Contains(property.Name))
          .Take(MaxErrors)
          .Select(property => new ExternalImportPath.FieldError($".{property.Name}",
              $"Remove the unsupported {name} field: {property.Name}."))
          .ToList();
      ThrowErrors(errors);
  }
  ```
  `Ignored` only contains database-assigned IDs (`id`, `exerciseId`, `programId`, etc.).

  If an LLM provides helpful and standard workout metadata such as `"equipment": "Barbell"`, `"category": "Chest"`, `"targetMuscles": ["Pectorals"]`, `"workingSets": 3`, or `"warmupSets": 2`, `ExternalImportSchema` rejects the file. Notably, `workingSets` and `warmupSets` are **required** in Pipeline B (`WorkoutAiSchemas.Content`), but **rejected** in Pipeline A (`ExternalImportSchema.cs`)!
- **Triggering Workout Scenario**: Advanced LLMs that attempt to enrich workout programs with equipment, category, muscle group, or set count metadata.
- **Impact**: HTTP 400 rejection.
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "Strict Whitelist Test",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Chest Day",
          "exercises": [
            {
              "sourceName": "Bench Press",
              "equipment": "Barbell",
              "workingSets": 3,
              "sets": [{ "repMin": 5, "repMax": 5 }]
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Remove the unsupported exercise field: equipment."` at path `$.program.days[0].exercises[0].equipment`
- **Expected Behavior**:
  The schema should ignore unknown harmless properties or store them in an extension dictionary, rather than aborting the import.

---

### Section C: Sets, Reps, and Set Types

---

#### Finding C.1: Case-Sensitive String Switch Crashes on Standard Acronyms ("AMRAP") and Capitalized Types
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Lines 189–196
- **Severity**: High (Fatal Import Blocker)
- **Description & Root Cause Mechanism**:
  In `ImportService.External.cs`, `ConvertExternalSet` handles `set.Type` via an exact C# pattern-matching switch:
  ```csharp
  var technique = ExternalImportPath.At(path + ".type", () => set.Type switch
  {
      null or "normal" or "warmup" => null,
      "dropset" => "Dropset", "amrap" => "AMRAP", "myoreps" => "Myo-reps",
      "partials" => "Partial reps", "lengthenedPartials" => "Lengthened partials",
      "integratedPartials" => "Integrated partials", "pause" => "Pause set",
      _ => throw new DomainException("Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause.")
  });
  ```
  The C# string switch is strictly ordinal and case-sensitive. It does **not** perform `.ToLowerInvariant()` or `.Trim()`.

  In strength and conditioning literature, **AMRAP** is virtually always capitalized. Similarly, models frequently emit capitalized titles like `"Dropset"`, `"Normal"`, `"Warmup"`, or camelCase variations like `"dropSet"`. Every one of these values falls through to the default branch `_` and throws a `DomainException`.
- **Triggering Workout Scenario**: Any workout where the LLM capitalizes `"AMRAP"`, `"Dropset"`, or `"Warmup"`.
- **Impact**: Immediate HTTP 400 import rejection on completely valid training programs.
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "AMRAP Test",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Day 1",
          "exercises": [
            {
              "sourceName": "Push-up",
              "sets": [{ "type": "AMRAP", "repsText": "AMRAP" }]
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause."` at path `$.program.days[0].exercises[0].sets[0].type`
- **Expected Behavior**:
  The switch should normalize input via `.Trim().ToLowerInvariant()` or use case-insensitive string comparisons.

---

#### Finding C.2: Missing Native Domain Support for Common Set Variations (Failure, Rest-Pause, Cluster)
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Line 195
  - `api/Services/ExternalImportPrompt.cs`: Lines 24, 42
- **Severity**: Medium (Expressiveness Limitation)
- **Description & Root Cause Mechanism**:
  WorkoutApp only recognizes 7 active set techniques: `dropset`, `amrap`, `myoreps`, `partials`, `lengthenedPartials`, `integratedPartials`, `pause`.

  Standard hypertrophy and strength methods such as:
  - `"failure"` (taking a set to absolute failure)
  - `"rest-pause"` (e.g. Doggcrapp training)
  - `"cluster"` (inter-rep rest sets)
  - `"eccentric"` / `"negative"`
  are completely absent from the allowed set types list. If an LLM transcribes a routine specifying `"type": "rest-pause"` or `"type": "failure"`, `ImportService.External.cs` throws an HTTP 400 error.
- **Triggering Workout Scenario**: High-intensity training (HIT) or powerbuilding programs prescribing rest-pause sets or sets to technical failure.
- **Impact**: Import failure unless the user manually removes the `type` property and moves it to `notes`.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Leg Press",
    "sets": [{ "repMin": 15, "repMax": 15, "type": "rest-pause" }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Choose a supported set type: normal, warmup, dropset, amrap, myoreps, partials, lengthenedPartials, integratedPartials, or pause."`
- **Expected Behavior**:
  The parser should map common synonyms (`"rest-pause"`, `"failure"`, `"cluster"`) into either recognized domain techniques or cleanly fold them into set notes without throwing an exception.

---

#### Finding C.3: Pipeline B Schema Lacks Warmup Property, Silently Converting Warmup Sets to Working Sets
- **Component Affected**:
  - `api/Services/WorkoutAiSchemas.cs`: Lines 77–90 (`WorkoutAiSchemas.Content`)
  - `api/Services/ImportService.DraftConversion.cs`: Line 248
  - `api/Services/ImportValidation.cs`: Line 68
- **Severity**: High (Silent Data Corruption & Fatigue Miscalculation)
- **Description & Root Cause Mechanism**:
  In Pipeline B, `WorkoutAiSchemas.Instructions` (line 34) instructs the LLM:
  > *"Separately printed warm-up rows keep their stated rep, load, and tempo prescriptions."*

  However, the JSON schema `WorkoutAiSchemas.Content` (`properties.days.items.properties.exercises.items.properties.sets.items`) defines **no `warmup` and no `type` property**.

  In `ImportService.DraftConversion.cs` (line 248), `ToDraftSet` converts each `AiSet`:
  ```csharp
  return new DraftSet(..., rirText, false, ImportNormalization.Page(set.SourcePage ?? exerciseSourcePage));
  ```
  The boolean `Warmup` parameter passed to `DraftSet` is **hardcoded to `false`**!

  When a PDF table specifies individual warmup sets with weights and reps (e.g., Set 1: 60kg x 5 [Warmup], Set 2: 80kg x 3 [Warmup], Set 3: 100kg x 5 [Working]), the LLM emits three set objects. All three sets are assigned `Warmup = false`.
- **Triggering Workout Scenario**: PDF workout programs (e.g. Starting Strength, 5/3/1, RTS) that explicitly list detailed warmup sets with ramped loads and reps.
- **Impact**:
  1. In `ImportValidation.cs` (line 68), the warmup sets trigger `rpe_unread` review warnings because working sets without RPE are flagged as unread.
  2. In active workout logging and progression analysis, warmups are recorded as full working sets, corrupting effective working volume, fatigue scores, and strain metrics.
- **Concrete Reproduction Scenario**:
  A PDF table:
  ```
  Barbell Squat:
  Set 1 (Warmup): 60 kg x 5
  Set 2 (Warmup): 80 kg x 3
  Set 3 (Work): 100 kg x 5 @ RPE 8
  ```
- **Observed Behavior**:
  All 3 sets are converted as working sets (`Warmup = false`).
- **Expected Behavior**:
  `WorkoutAiSchemas.Content` should include `"warmup": {"type": "boolean"}` in `sets`, and `DraftConversion.cs` should map `set.Warmup` into `DraftSet`.

---

#### Finding C.4: Rejection of Single Rep Bounds and 0-Rep Isometric Prescriptions
- **Component Affected**:
  - `api/Domain/Validation.cs`: Lines 82, 85
- **Severity**: Medium (Domain Validation Rejection)
- **Description & Root Cause Mechanism**:
  In `Validation.cs` (lines 82–85):
  ```csharp
  Require(set!.RepMin is null == set.RepMax is null, "Give both rep bounds or leave both empty.");
  if (set.RepMin is { } repMin && set.RepMax is { } repMax)
  {
      Require(repMin is > 0 and <= 1000 && repMax is > 0 and <= 1000, "Reps must be between 1 and 1000.");
      Require(repMin <= repMax, "The lowest rep target cannot exceed the highest.");
  }
  ```
  This creates two distinct failure modes:
  1. **Single Rep Bound**: If an LLM transcribes a fixed 10-rep target by emitting `"repMin": 10` and omitting `repMax`, line 82 throws `"Give both rep bounds or leave both empty."`.
  2. **0 Reps for Isometrics**: If an LLM transcribes an isometric hold or timed stretch as 0 reps (`"repMin": 0, "repMax": 0`), line 85 throws `"Reps must be between 1 and 1000."`.
- **Triggering Workout Scenario**:
  - LLMs that emit single-target rep counts as `repMin` only.
  - Isometric or static hold exercises represented with 0 repetitions.
- **Impact**: HTTP 400 import rejection.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Plank",
    "sets": [{ "repMin": 0, "repMax": 0, "repsText": "60 sec hold" }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Reps must be between 1 and 1000."` at path `$.program.days[0].exercises[0].sets[0]`
- **Expected Behavior**:
  If only one rep bound is provided, the system should duplicate it to both `repMin` and `repMax`. For isometrics, `repMin: 0` should either be allowed or automatically cleared to `null`.

---

#### Finding C.5: Inverted Pyramid Rep Ranges Trigger Domain Validation Exception
- **Component Affected**:
  - `api/Domain/Validation.cs`: Line 86
- **Severity**: Medium (Validation Crash)
- **Description & Root Cause Mechanism**:
  `Validation.cs` (line 86) mandates:
  ```csharp
  Require(repMin <= repMax, "The lowest rep target cannot exceed the highest.");
  ```
  In strength training, reverse pyramid routines are frequently written as descending ranges, for example: "Perform 12-10 reps" (meaning 12 reps on early sets, tapering to 10 reps as fatigue sets in).
  If an LLM transcribes this literally as `"repMin": 12, "repMax": 10`, line 86 triggers and aborts the entire import with HTTP 400.
- **Triggering Workout Scenario**: Reverse pyramid or descending repetition notation in workout PDFs.
- **Impact**: HTTP 400 import rejection.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Dumbbell Curl",
    "sets": [{ "repMin": 12, "repMax": 10 }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"The lowest rep target cannot exceed the highest."`
- **Expected Behavior**:
  The parser should automatically normalize inverted ranges (`Math.Min` and `Math.Max`) rather than crashing.

---

### Section D: Exercise Types & Duration-Based Exercises

---

#### Finding D.1: Total Absence of Duration and Tracking Mode in Import Schemas
- **Component Affected**:
  - `api/Services/ExternalImportSchema.cs`: Line 34
  - `api/Services/WorkoutAiSchemas.cs`: Lines 77–90
  - `api/Services/ExternalImportContracts.cs`: Lines 40–56
- **Severity**: High (Architectural Schema Omission)
- **Description & Root Cause Mechanism**:
  WorkoutApp's underlying execution layer explicitly supports duration tracking:
  `IntegrationContracts.TrackingModes` defines `reps` and `duration`, and `CompletedSet` has `DurationSeconds`.

  However, **neither import schema includes duration fields**:
  - `ExternalImportSchema.cs` (line 34) allowed set fields: `["type", "repMin", "repMax", "targetRpe", "restSeconds", "tempo", "loadText", "notes", "repsText", "restText", "rir", "warmup", "sourceReference", "uncertainty"]`.
  - `WorkoutAiSchemas.Content` (lines 77–90) set properties: `repMin`, `repMax`, `repsText`, `targetRpe`, `rir`, `restSeconds`, `restText`, `tempo`, `loadText`, `notes`, `repsSource`, `rpeSource`, `restSource`, `sourcePage`.

  There is no `duration`, `durationSeconds`, `targetSeconds`, or `trackingMode` property on `set` or `exercise`. If an external LLM attempts to output `"duration": 60` or `"durationSeconds": 60`, `ExternalImportSchema` rejects the import with `"Remove the unsupported set field: duration."`.
- **Triggering Workout Scenario**: Any workout program containing planks, dead bugs, wall sits, L-sits, or cardio intervals.
- **Impact**: Inability to explicitly represent duration targets in imported JSON.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Plank",
    "sets": [{ "durationSeconds": 60 }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Remove the unsupported set field: durationSeconds."`
- **Expected Behavior**:
  `durationSeconds` should be a first-class citizen in both import schemas and contracts.

---

#### Finding D.2: Pipeline A Bypasses Duration Normalization, Converting Timed Holds to High Rep Counts
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Line 211
  - `api/Services/ImportNormalization.cs`: Lines 52–53
  - `api/Services/ImportService.DraftConversion.cs`: Line 217
- **Severity**: High (Data Corruption & Absurd Exercise Prescriptions)
- **Description & Root Cause Mechanism**:
  In Pipeline B (PDF import), `ImportService.DraftConversion.cs` (line 217) invokes:
  ```csharp
  var (repMin, repMax, repTotal) = ImportNormalization.Reps(set.RepsText, set.RepMin, set.RepMax);
  ```
  `ImportNormalization.Reps` checks `IsDuration(repsText)`. If the text represents a duration (e.g. `"60s"` or `"60 seconds"`), it resets `repMin` and `repMax` to `null` so the set does not demand repetitions.

  In Pipeline A (External import), `ImportService.External.cs` (line 211) **bypasses `ImportNormalization.Reps` entirely**:
  ```csharp
  return new DraftSet(set.RepMin, set.RepMax, targetRpe, restSeconds, set.Tempo, set.LoadText, notes,
      Source(set.RepMin is not null || set.RepMax is not null), Source(targetRpe is not null), Source(restSeconds is not null),
      set.RepsText, set.RestText, rir, set.Warmup || set.Type == "warmup");
  ```
  When an external LLM converts "Plank: 3 sets of 60 seconds" by providing:
  `"repMin": 60, "repMax": 60, "repsText": "60 seconds"`,
  `ConvertExternalSet` keeps `repMin: 60, repMax: 60`.

  When the user opens the workout, WorkoutApp prescribes **60 repetitions of Plank**, calculating volume and estimated 1RM off 60 reps!
- **Triggering Workout Scenario**: Any timed exercise imported through Pipeline A where the LLM populated both numeric bounds and `repsText`.
- **Impact**: Timed holds become absurd repetition goals (e.g., doing 60 planks instead of a 60-second hold).
- **Concrete Reproduction Payload**:
  ```json
  {
    "version": 1,
    "program": {
      "name": "Core Routine",
      "days": [
        {
          "key": "d1",
          "week": 1,
          "name": "Abs",
          "exercises": [
            {
              "sourceName": "Plank",
              "sets": [{ "repMin": 60, "repMax": 60, "repsText": "60 seconds" }]
            }
          ]
        }
      ]
    }
  }
  ```
- **Observed Behavior**:
  Import succeeds, but creates a draft with `RepMin = 60, RepMax = 60`. In the workout logger, the set row demands 60 reps.
- **Expected Behavior**:
  Pipeline A should invoke `ImportNormalization.Reps` to clear rep counts for duration-based sets.

---

#### Finding D.3: Custom/Unmapped Timed Exercises Default to Reps, Triggering Validation Failures
- **Component Affected**:
  - `api/Services/WorkoutSetValidation.cs`: Lines 7–20
  - `api/Domain/IntegrationContracts.cs`: Lines 82–88
  - `web/src/lib/setDuration.ts`: Lines 7–8
- **Severity**: High (Workout Logging Blocker)
- **Description & Root Cause Mechanism**:
  In WorkoutApp, whether an exercise is timed depends solely on its catalog entry:
  `isTimedExercise = exercise.trackingMode === 'duration'`.

  When an imported exercise is unmapped or linked to a newly created custom exercise, the custom exercise defaults to `TrackingMode = TrackingModes.Reps`.

  When the lifter subsequently logs the workout session, `WorkoutSetValidation.Tracking` strictly enforces:
  ```csharp
  if (isTimed)
  {
      Require(reps is null, "A timed exercise cannot record reps.");
      Require(rpe is null && rir is null, "A timed exercise records duration alone, without RPE or RIR.");
      Require(!done || seconds is not null, "A completed timed set needs its duration.");
  }
  else
  {
      Require(seconds is null, "This exercise records reps, not seconds.");
      Require(!done || reps is not null, "A completed set needs its reps.");
  }
  ```
  If the lifter uses the timer stopwatch to record seconds on an unmapped timed exercise, the backend rejects the save with:
  `"This exercise records reps, not seconds."`!
- **Triggering Workout Scenario**: Any timed exercise not already present in WorkoutApp's static seed catalog (e.g. "Copenhagen Plank", "Banded Pallof Hold", "Chinese Plank").
- **Impact**: The user is blocked from logging duration during live workouts.
- **Observed Behavior**:
  API returns HTTP 400 Bad Request: `"This exercise records reps, not seconds."`
- **Expected Behavior**:
  Imported exercises with duration prescriptions should automatically configure `TrackingMode = TrackingModes.Duration`.

---

#### Finding D.4: Compound Duration Regex Failure on Natural Time Expressions
- **Component Affected**:
  - `web/src/lib/setDuration.ts`: Lines 32, 43–49
- **Severity**: Medium (Countdown Target Dropped)
- **Description & Root Cause Mechanism**:
  In `web/src/lib/setDuration.ts`, `timedTargetSeconds` parses `repsText` using `DURATION_TEXT`:
  ```typescript
  const DURATION_TEXT = /^(?:[~≈]\s*)?(?:(\d{1,2})?:(\d{2})|(\d+(?:\.\d+)?)(?:\s*(?:[-–]|to)\s*(\d+(?:\.\d+)?))?\s*[- ]?\s*(s|secs?|seconds?|mins?|minutes?)?)(?:\s+(?:hold|each(?:\s+side)?|per\s+(?:leg|side)))?$/i;
  ```
  This regex only supports single-unit durations (e.g. `"45 sec"`, `"2 min"`) or digital clock formats (e.g. `"1:30"`).

  If a program prescribes compound natural time strings such as `"1 min 30 sec"`, `"1m 30s"`, or `"90 seconds (1.5 min)"`:
  `DURATION_TEXT.exec(text)` returns `null`.

  In line 44:
  ```typescript
  if (!match) return null;
  ```
  `timedTargetSeconds` returns `null`. The workout stopwatch fails to determine a target countdown duration and defaults to an open-ended stopwatch counting up from zero.
- **Triggering Workout Scenario**: Common natural time expressions like "1 min 30 sec" for long holds or aerobic intervals.
- **Impact**: Loss of target countdown timer in the mobile and web UI.
- **Concrete Reproduction Input**:
  `repsText: "1 min 30 sec"` on a timed Plank set.
- **Observed Behavior**:
  `timedTargetSeconds` evaluates to `null`.
- **Expected Behavior**:
  The parser should evaluate compound minute + second expressions and resolve 90 seconds.

---

### Section E: Weight Modalities (Pure Weight, Bodyweight, Added Weight, Assisted Weight)

---

#### Finding E.1: Absolute Prescribed Loads in `loadText` Ignored by Progression and Hidden in Workout UI
- **Component Affected**:
  - `api/Services/WorkoutService.Progression.cs`: Lines 95–99, 107–108
  - `api/Domain/PercentageLoad.cs`: Lines 27–37
  - `web/src/components/WorkoutSetRow.tsx`: Lines 92–93, 128–133
- **Severity**: High (Prescribed Weights Disappear in UI)
- **Description & Root Cause Mechanism**:
  Workout programs frequently prescribe absolute target weights (e.g. `"135 lbs"`, `"80 kg"`, `"60kg"`, `"50 lb dumbbells"`).

  In WorkoutApp's domain, `SetPrescription` has only `string? LoadText`. There is no numeric `PrescribedWeightKg`.

  When generating workout sessions, `WorkoutService.Progression.cs` evaluates `PercentageLoad.Parse(prescription.LoadText)`. In `PercentageLoad.cs`:
  ```csharp
  [GeneratedRegex(@"^\s*(?<a>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?<b>\d+(?:\.\d+)?))?\s*%\s*(?:1\s*RM)?\s*$",
      RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
  private static partial Regex Printed();
  ```
  `PercentageLoad.Parse` matches **only percentage strings** (e.g. `"75% 1RM"`). For any absolute weight string like `"80 kg"`, it returns `null`.

  Consequently:
  1. `progression.SuggestedLoadKg` is set to `null`.
  2. In `WorkoutSetRow.tsx`:
     ```tsx
     const prescribedPercentage = percentagePrescription(plan?.loadText, plan?.notes);
     ...
     <div className="set-target-cell">
       <span className="target-text">{target.reps}</span>
       {prescribedPercentage && <small className="set-percentage-target">{prescribedPercentage}</small>}
       {target.load && <small className="suggestion-text">{target.load}</small>}
     </div>
     ```
     `prescribedPercentage` is `null`, and `target.load` is `null`.
  3. The prescribed load is **completely hidden** from the set target cell. The user sees only the rep count, with an empty weight input box.
- **Triggering Workout Scenario**: Any dumbbell, barbell, or fixed-weight program specifying concrete loads (e.g. "Dumbbell Bench Press: 3 sets of 10 with 50 lbs").
- **Impact**: Complete omission of prescribed weight from the active training screen.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Dumbbell Bench Press",
    "sets": [{ "repMin": 10, "repMax": 10, "loadText": "50 lbs" }]
  }
  ```
- **Observed Behavior**:
  Workout launches with an empty weight cell. The text "50 lbs" does not appear anywhere in the active set row.
- **Expected Behavior**:
  The system should parse absolute weights or display `loadText` verbatim in the target cell alongside prescribed reps.

---

#### Finding E.2: Bodyweight Movements with Added Load Misclassified as Pure Bodyweight
- **Component Affected**:
  - `api/Domain/ResistanceVariant.cs`: Lines 17–27
  - `api/Services/CatalogMatching.cs`: Lines 42–73
  - `api/Services/WorkoutService.cs`: Lines 658–659
- **Severity**: High (Progression & System Load Corruption)
- **Description & Root Cause Mechanism**:
  When a program prescribes a bodyweight movement with added load, it is commonly written as:
  - `"Pull-ups (+20 kg)"`
  - `"Chin-ups with 25 lb plate"`
  - `"Dips (+15kg)"`

  In `CatalogMatching.cs`, the matcher strips bracketed expressions like `(+20 kg)` to find catalog matches, resolving the exercise slug `pull-up` (which has `LoadModel = LoadModels.FullBodyweight`).

  Next, `ResistanceVariant.For` runs:
  ```csharp
  if (loadModel == LoadModels.FullBodyweight)
  {
      var name = exerciseName ?? "";
      if (Assisted().IsMatch(name)) return ResistanceModes.Assistance;
      return Weighted().IsMatch(name) ? ResistanceModes.Added : ResistanceModes.Bodyweight;
  }
  ```
  Because the matched catalog name is `"Pull-Up"`, `Weighted().IsMatch("Pull-Up")` is `false`. It resolves to `ResistanceModes.Bodyweight`.

  In `WorkoutService.ComputeSystemLoad`:
  ```csharp
  ResistanceModes.Bodyweight => reference,
  ResistanceModes.Added when input is { } added => reference + added,
  ```
  Because the mode is `Bodyweight`, the added load (20 kg) is discarded, and system load is recorded purely as the lifter's bodyweight. The added load is completely erased from progression and historical volume analytics.
- **Triggering Workout Scenario**: Calisthenics with added weight where the exercise name does not explicitly start with "Weighted".
- **Impact**: Added load is erased from system analytics and volume progression.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Pull-ups (+20 kg)",
    "sets": [{ "repMin": 5, "repMax": 5, "loadText": "+20 kg" }]
  }
  ```
- **Observed Behavior**:
  Exercise is classified as `ResistanceModes.Bodyweight`. System load calculation ignores the +20 kg.
- **Expected Behavior**:
  The presence of `+20 kg` in `loadText` or exercise title must classify the set as `ResistanceModes.Added`.

---

#### Finding E.3: Assisted Bodyweight Sign Inversion and Modality Classification Discrepancies
- **Component Affected**:
  - `api/Domain/Validation.cs`: Line 54
  - `api/Services/WorkoutService.cs`: Line 660
  - `web/src/components/WorkoutSetRow.tsx`: Line 136
- **Severity**: Medium (Input Validation Crash / Confusion)
- **Description & Root Cause Mechanism**:
  Assisted bodyweight exercises (e.g. Assisted Dip machine, band-assisted pull-ups) reduce the effective load.
  In training literature, assistance is written with a negative sign (e.g. `"-20 kg"`, `"-40 lbs"`).

  However, in WorkoutApp's domain:
  1. `Validation.LoggedSet` (line 54) mandates:
     ```csharp
     Require(weight is >= 0 and <= 1000, "Weight must be between 0 and 1000.");
     ```
     Entering a negative weight throws a validation exception.
  2. `ComputeSystemLoad` (line 660) subtracts positive input:
     ```csharp
     ResistanceModes.Assistance when input is { } assistance => Math.Max(0, reference - assistance)
     ```
  3. In `WorkoutSetRow.tsx` (line 136), the UI displays a hardcoded minus sign prefix:
     ```tsx
     {sign && <span className="load-sign" aria-hidden="true">{sign}</span>}
     ```
  If an LLM transcribes an assisted set by writing `"loadText": "-20 kg"`, the lifter or system attempting to parse `-20` directly fails backend validation because of the negative sign.
- **Triggering Workout Scenario**: Assisted machine exercises transcribed with explicit negative signs.
- **Impact**: Rejection of negative load values upon logging or parsing.
- **Concrete Reproduction Input**:
  A set with `weightKg: -20` on an assisted exercise.
- **Observed Behavior**:
  Throws `DomainException: "Weight must be between 0 and 1000."`
- **Expected Behavior**:
  Assisted loads should normalize negative input by taking `Math.Abs(value)`.

---

### Section F: Domain Model Mapping, Catalog Matching & Edge Cases

---

#### Finding F.1: Deceptive UI Banner Assures Unmapped Exercises Can Be Logged While Backend 409 Hard-Blocks Creation
- **Component Affected**:
  - `web/src/components/ImportReviewPanel.tsx`: Lines 100–106
  - `api/Services/ImportService.cs`: Lines 115, 245–246
  - `web/src/components/ImportDraftTree.tsx`: Line 238
- **Severity**: High (Deceptive UI & Program Acceptance Blocker)
- **Description & Root Cause Mechanism**:
  When an imported program contains an exercise not found in WorkoutApp's seed catalog (e.g. "Deficit Pendlay Row"), the import review screen displays an informational banner (`ImportReviewPanel.tsx:100-106`):
  ```tsx
  {view.unresolved.length > 0 && (
    <div className="irev-unresolved-banner" role="status">
      <Info size={16} className="irev-unresolved-icon" />
      <span className="irev-unresolved-text">
        {view.unresolved.length} exercise slot{view.unresolved.length === 1 ? ' is' : 's are'} not linked to the catalog. Unmapped names stay verbatim and can still be logged.
      </span>
    </div>
  )}
  ```
  This banner unequivocally assures the user that they do not need to link the exercise, because unmapped names *"stay verbatim and can still be logged."*

  However, this claim is **completely false**:
  1. In `api/Services/ImportService.cs` (line 115):
     ```csharp
     var acceptable = import.Status == ImportStatus.Ready && unresolved.Count == 0 && issues.All(i => i.Severity == "info");
     ```
  2. In `ImportDraftTree.tsx` (line 238), the "Create program" button is disabled whenever `!acceptable` (i.e. whenever `unresolved.Count > 0`).
  3. If the user invokes the accept endpoint directly (`POST /api/imports/{id}/accept`), `ImportService.cs` (lines 245–246) hard-rejects the request:
     ```csharp
     Validation.Require(unresolved.Count == 0 && actionable.Count == 0,
         "Resolve every exercise mapping and review issue before creating this program.", 409);
     ```
  The user is trapped: the UI tells them everything is fine and unmapped exercises can be logged verbatim, but the app blocks program creation until every single exercise is mapped.
- **Triggering Workout Scenario**: Any workout program containing novel, niche, or custom exercise names not present in the seed catalog.
- **Impact**: Severe user confusion; complete inability to create the program without unexpected manual intervention.
- **Observed Behavior**:
  UI promises unmapped exercises can be logged, but "Create program" button is disabled and backend returns HTTP 409 Conflict.
- **Expected Behavior**:
  Either the application must genuinely allow unmapped exercises to be created and logged as custom movements, or the UI banner must truthfully state that every unmapped exercise must be resolved before proceeding.

---

#### Finding F.2: Single-Exercise Lettering Crashes Superset Validator
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Lines 60–63
- **Severity**: Medium (Validation Crash)
- **Description & Root Cause Mechanism**:
  In many popular strength programs (e.g. Poliquin routines, 5/3/1, Starting Strength), workouts use sequential alphabetical lettering for ordinary straight-set exercises:
  - `A. Squat`
  - `B. Bench Press`
  - `C. Barbell Row`

  When an LLM populates `sequenceGroup: "A"` on the Squat, and `sequenceGroup: "B"` on the Bench Press, `ImportService.External.cs` lines 60–63 executes:
  ```csharp
  Validation.Require(positions.Count >= ExternalImportLimits.MinSupersetExercises,
      "Each superset must contain at least two exercises.");
  ```
  Because group "A" contains only 1 exercise, `positions.Count == 1`, failing `positions.Count >= 2`.
  WorkoutApp assumes this is a malformed superset and crashes the entire import with HTTP 400.
- **Triggering Workout Scenario**: Any workout program using lettered exercise indexing (A, B, C, D) without supersetting.
- **Impact**: HTTP 400 rejection of valid workouts.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Squat",
    "sequenceGroup": "A",
    "sets": [{ "repMin": 5, "repMax": 5 }]
  },
  {
    "sourceName": "Bench Press",
    "sequenceGroup": "B",
    "sets": [{ "repMin": 5, "repMax": 5 }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Each superset must contain at least two exercises."` at path `$.program.days[0].exercises`
- **Expected Behavior**:
  Single-exercise letter groups should either be ignored (treated as straight sets) or sanitized.

---

#### Finding F.3: Active Recovery Rest Days Containing Mobility Exercises Rejected with HTTP 400
- **Component Affected**:
  - `api/Services/ImportValidation.cs`: Lines 273–274
- **Severity**: Medium (Program Rejection)
- **Description & Root Cause Mechanism**:
  Many comprehensive athletic programs schedule "Active Recovery" or "Rest & Mobility" days that include light stretching, foam rolling, or walking drills.

  In `ImportValidation.cs` (lines 273–274):
  ```csharp
  Validation.Require(workout.IsRestDay ? workout.Exercises is { Count: 0 } : workout.Exercises is { Count: > 0 and <= 40 },
      workout.IsRestDay ? "A rest day cannot contain exercises." : "Each workout needs between 1 and 40 exercises.");
  ```
  If an LLM marks `isRestDay: true` and includes 2 mobility exercises, the validator rejects the workout with `"A rest day cannot contain exercises."`.
  Conversely, if the LLM marks `isRestDay: false` (or omits it) for a true rest day with 0 exercises, the validator rejects it with `"Each workout needs between 1 and 40 exercises."`.
- **Triggering Workout Scenario**: Active recovery days with mobility drills.
- **Impact**: HTTP 400 import rejection.
- **Concrete Reproduction Payload**:
  ```json
  {
    "key": "d4",
    "week": 1,
    "name": "Rest & Mobility",
    "isRestDay": true,
    "exercises": [
      {
        "sourceName": "Foam Rolling",
        "sets": [{ "repMin": 1, "repMax": 1, "repsText": "5 min" }]
      }
    ]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"A rest day cannot contain exercises."` at path `$.program.days[3]`
- **Expected Behavior**:
  If a day contains exercises, `isRestDay` should automatically be set to `false`, or active recovery should be supported as a distinct training day category.

---

#### Finding F.4: Strict Numeric RIR Regex Rejects Common Natural Fitness Formats
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Lines 184–187
- **Severity**: Medium (Formatting Rejection)
- **Description & Root Cause Mechanism**:
  In `ImportService.External.cs` (lines 184–187):
  ```csharp
  Validation.Require(Regex.IsMatch(set.Rir, @"^\d{1,2}(?:\.\d+)?(?:\s*[-–]\s*\d{1,2}(?:\.\d+)?)?\+?$",
      RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)
      && Regex.Matches(set.Rir, @"\d+(?:\.\d+)?").Cast<Match>().All(match =>
          double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number <= ExternalImportLimits.MaxRir),
      "Use a numeric RIR or range between 0 and 10, optionally followed by +.");
  ```
  The regex requires the string to consist strictly of digits.

  In common coaching usage, RIR is frequently written with the acronym prefix or suffix:
  - `"RIR 2"`
  - `"2 RIR"`
  - `"1-2 RIR"`
  - `"2-3 reps in reserve"`

  Every one of these natural fitness expressions fails the regex and aborts the import with HTTP 400.
- **Triggering Workout Scenario**: Natural RIR transcription from LLMs.
- **Impact**: HTTP 400 import rejection.
- **Concrete Reproduction Payload**:
  ```json
  {
    "sourceName": "Barbell Squat",
    "sets": [{ "repMin": 5, "repMax": 5, "rir": "RIR 2" }]
  }
  ```
- **Observed Behavior**:
  HTTP 400 Bad Request:
  `"Use a numeric RIR or range between 0 and 10, optionally followed by +."` at path `$.program.days[0].exercises[0].sets[0].rir`
- **Expected Behavior**:
  The parser should strip `"RIR"`, `"reps in reserve"`, and whitespace before validating numeric bounds.

---

#### Finding F.5: String Length Limits and Unchecked Technique Concatenation Trigger Note Length Failures
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Lines 199–206
  - `api/Domain/Validation.cs`: Line 99
- **Severity**: Low (Import Crash on Long Notes)
- **Description & Root Cause Mechanism**:
  In `Validation.cs` (line 99), set notes are restricted to a maximum of 400 characters:
  ```csharp
  Text(set.Notes, 400, "Set notes");
  ```
  In `ImportService.External.cs`:
  ```csharp
  var notes = technique is null || NamesTechnique(setNote, technique) || SetTechniques.Of(setNote) is not null ? setNote
      : string.IsNullOrWhiteSpace(setNote) ? technique : $"{setNote} — {technique}";
  ...
  if (effortNote is not null) notes = string.IsNullOrWhiteSpace(notes) ? effortNote : $"{notes.Trim()} {effortNote}";
  Validation.Text(notes, 400, "Set notes");
  ```
  If an imported set already has a detailed set note close to 400 characters (e.g. 385 characters), concatenating `" — Lengthened partials"` pushes the string length over 400 characters, throwing a `DomainException` and rejecting the entire file.
- **Triggering Workout Scenario**: Programs with detailed set-specific coaching cues and intensity techniques.
- **Impact**: HTTP 400 rejection due to artificial string concatenation overflow.
- **Expected Behavior**:
  The concatenated string should be safely truncated to 400 characters rather than throwing an exception.

---

#### Finding F.6: Exact Whitespace Validation on Superset SequenceGroup Rejects Trailing Spaces
- **Component Affected**:
  - `api/Services/ImportService.External.cs`: Lines 121–123
- **Severity**: Low (Unnecessary Rejection)
- **Description & Root Cause Mechanism**:
  In `ImportService.External.cs`:
  ```csharp
  Validation.Require(exercise.SequenceGroup is null || exercise.SequenceGroup == exercise.SequenceGroup.Trim(),
      "Remove spaces at the beginning and end of the superset label.");
  ```
  If an LLM accidentally outputs `"sequenceGroup": "A1 "` with a trailing space, WorkoutApp rejects the import with HTTP 400 instead of trimming the string.
- **Triggering Workout Scenario**: Accidental whitespace in JSON property values.
- **Impact**: HTTP 400 import rejection.
- **Expected Behavior**:
  Whitespace should be trimmed automatically.

---

## 3. Master Defect Inventory & Impact Matrix

The table below catalogs all 27 identified defects across both import pipelines:

| # | Finding Key | Area / Subsystem | Issue Summary | Pipeline | Severity | Impact |
|---|---|---|---|---|---|---|
| 1 | B.1 | Syntax & Transport | Markdown code fence rejection (` ```json `) | Pipeline A | **Critical** | Fatal 400 rejection |
| 2 | B.2 | Syntax & Transport | Conversational preamble/postamble rejection | Pipeline A | **Critical** | Fatal 400 rejection |
| 3 | B.3 | Syntax & Transport | Trailing comma & inline comment rejection | Pipeline A | **Critical** | Fatal 400 rejection |
| 4 | B.4 | Syntax & Transport | Non-numeric string deserialization failure in numeric fields (`"8-10"`, `"90s"`) | Pipeline A | **Critical** | Fatal 400 rejection |
| 5 | A.1 | Prompt Contradiction | Superset A1 vs A conflict (L23 vs L43) | Pipeline A | **High** | Fatal 400 rejection |
| 6 | A.2 | Weight Modality | Stripping "weighted" from name erases added load | Pipelines A & B | **High** | Added load erased |
| 7 | C.1 | Set Types | Case-sensitive switch crashes on `"AMRAP"` | Pipeline A | **High** | Fatal 400 rejection |
| 8 | C.3 | Warmup Sets | Schema lacks `warmup` field; warmups become working | Pipeline B | **High** | Fatigue / volume corrupted |
| 9 | D.1 | Duration Exercises | Schema lacks `duration`/`durationSeconds` fields | Pipelines A & B | **High** | Schema rejection / omission |
| 10| D.2 | Duration Exercises | Bypasses normalization; 60s plank logged as 60 reps | Pipeline A | **High** | 60 reps of plank |
| 11| D.3 | Duration Exercises | Custom timed exercises default to reps, blocking time | Execution Layer | **High** | Logging rejected with 400 |
| 12| E.1 | Weight Modality | Absolute loads in `loadText` ignored & hidden in UI | Execution Layer | **High** | Target weights invisible |
| 13| E.2 | Weight Modality | Bodyweight + added load misclassified as pure bodyweight| Domain Layer | **High** | Added load erased |
| 14| F.1 | UI vs Backend | Deceptive banner claims unmapped exercises can be logged| Web / API | **High** | 409 creation lockout |
| 15| B.5 | Schema Extensibility| Whitelist rejects standard fields (`equipment`) | Pipeline A | **Medium** | Fatal 400 rejection |
| 16| A.3 | Intensity Fidelity | Forced integer snapping destroys half-point RPE | Pipeline B | **Medium** | Intensity shifted $\pm 0.5$ |
| 17| A.4 | Set Types | Prompt suggests unsupported set types (`cluster`) | Pipeline A | **Medium** | Fatal 400 rejection |
| 18| C.2 | Set Types | Missing set types (`failure`, `rest-pause`) | Pipeline A | **Medium** | Fatal 400 rejection |
| 19| C.4 | Rep Bounds | Rejection of single bounds & 0 reps for isometrics | Domain Layer | **Medium** | Fatal 400 rejection |
| 20| C.5 | Rep Bounds | Inverted pyramid rep ranges throw validation error | Domain Layer | **Medium** | Fatal 400 rejection |
| 21| D.4 | Duration Exercises | Compound regex fails on `"1 min 30 sec"` | Web Client | **Medium** | Target timer lost |
| 22| E.3 | Weight Modality | Assisted bodyweight sign inversion validation failure | Domain Layer | **Medium** | Validation crash |
| 23| F.2 | Supersets | Single-exercise lettering (`A. Squat`) crashes superset | Pipeline A | **Medium** | Fatal 400 rejection |
| 24| F.3 | Rest Days | Active recovery rest days with mobility rejected | Pipeline A & B | **Medium** | Fatal 400 rejection |
| 25| F.4 | Effort Formatting | Strict regex crashes on natural expressions (`"RIR 2"`)| Pipeline A | **Medium** | Fatal 400 rejection |
| 26| F.5 | Field Length | Appending technique to long note triggers 400 error | Pipeline A | **Low** | Fatal 400 rejection |
| 27| F.6 | Formatting | Trailing space on `sequenceGroup` triggers 400 error | Pipeline A | **Low** | Fatal 400 rejection |

---

## 4. Remediation & Actionable Recommendations Roadmap

To transform WorkoutApp's AI program import into a resilient, production-grade feature, the following architectural fixes are recommended across five distinct milestones:

### 4.1 Pipeline A Transport & JSON Sanitization Layer
**Priority: Immediate (Critical Fixes)**
1. **Pre-Processing Envelope Sanitizer**:
   In `ExternalImportEnvelope.cs`, implement boundary extraction before parsing:
   ```csharp
   public static string Sanitize(string input)
   {
       var text = input.Trim();
       // 1. Strip Markdown code fences
       if (text.StartsWith("```"))
       {
           var firstLine = text.IndexOf('\n');
           var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
           if (firstLine >= 0 && lastFence > firstLine)
               text = text.Substring(firstLine + 1, lastFence - firstLine - 1).Trim();
       }
       // 2. Extract outer JSON bounds if preamble/postamble exists
       var firstBrace = text.IndexOf('{');
       var lastBrace = text.LastIndexOf('}');
       if (firstBrace >= 0 && lastBrace > firstBrace)
           text = text.Substring(firstBrace, lastBrace - firstBrace + 1);
       return text;
   }
   ```
2. **Permissive JSON Options**:
   Update `JsonDocumentOptions` in `ExternalImportEnvelope.cs`:
   ```csharp
   new JsonDocumentOptions
   {
       MaxDepth = 64,
       AllowTrailingCommas = true,
       CommentHandling = JsonCommentHandling.Skip
   }
   ```
   Enhance numeric parsing resiliency:
   *(Note: `JsonSerializerDefaults.Web` already enables `JsonNumberHandling.AllowReadingFromString`, permitting quoted numeric digits. Lenient handling is needed for range strings and unit suffixes)*:
   Implement custom `JsonConverter` or pre-deserialization normalization for numeric fields (`repMin`, `repMax`, `restSeconds`, `targetRpe`) to gracefully parse word representations (e.g. `"eight"` -> `8`) or extract bounds from compound range strings (e.g. `"8-10"` -> `repMin = 8, repMax = 10`) into `repsText` rather than throwing fatal exceptions.
3. **Loosen Whitelist Extensibility**:
   In `ExternalImportSchema.cs`, ignore unknown attributes on `exercise` and `set` instead of rejecting them, or store unmapped attributes in an `ExtensionData` dictionary.

### 4.2 Prompt Template Harmonization
**Priority: High**
1. **Unify Superset Instructions**:
   In `ExternalImportPrompt.cs`, align line 43 with line 23:
   > *"Superset labels: when exercises form a superset, give all paired exercises the exact same sequenceGroup label (such as 'A' or 'B'). Do not include superset numbers (like A1 or A2) in sequenceGroup or exercise names."*
   Alternatively, in `ImportService.External.cs`, automatically group exercises sharing a common letter prefix (e.g. `A1` and `A2` map to group `A`).
2. **Harmonize Set Types**:
   In `ExternalImportPrompt.cs` (line 42), remove the reference suggesting cluster sets belong in `set type`. Add explicit instructions on how to format added load (`"+15kg"`) and assisted load (`"-20kg"`).

### 4.3 Pipeline B Schema & Conversion Corrections
**Priority: High**
1. **Add `warmup` Property to Schema**:
   In `WorkoutAiSchemas.cs` (`WorkoutAiSchemas.Content`), add `warmup` to set properties:
   ```json
   "warmup": { "type": "boolean", "description": "True when this set is a warmup set; false for working sets." }
   ```
2. **Update Draft Conversion**:
   In `ImportService.DraftConversion.cs` (line 248), pass the parsed boolean:
   ```csharp
   return new DraftSet(..., rirText, set.Warmup ?? false, ImportNormalization.Page(...));
   ```
3. **Restore Half-Point RPE Fidelity**:
   In `WorkoutAiSchemas.Instructions` (line 25), remove the command forcing integer snapping of RIR. Instruct the model:
   > *"Preserve half-point RPEs (e.g. RPE 7.5, 8.5) in targetRpe and calculate rir as 10 - targetRpe."*

### 4.4 Domain Model & Weight Modality Enhancements
**Priority: High**
1. **Case-Insensitive Technique Switch**:
   In `ImportService.External.cs` (line 189):
   ```csharp
   var normalizedType = set.Type?.Trim().ToLowerInvariant();
   var technique = ExternalImportPath.At(path + ".type", () => normalizedType switch
   {
       null or "normal" or "warmup" => null,
       "dropset" or "drop set" or "drop_set" => "Dropset",
       "amrap" => "AMRAP",
       "myoreps" or "myo-reps" => "Myo-reps",
       "partials" or "partial reps" => "Partial reps",
       "lengthenedpartials" or "lengthened partials" => "Lengthened partials",
       "integratedpartials" or "integrated partials" => "Integrated partials",
       "pause" or "pause set" => "Pause set",
       _ => null // Gracefully fall back to notes instead of crashing
   });
   ```
2. **Normalize Durations in Pipeline A**:
   In `ImportService.External.cs` (line 211), invoke `ImportNormalization.Reps`:
   ```csharp
   var (repMin, repMax, _) = ImportNormalization.Reps(set.RepsText, set.RepMin, set.RepMax);
   ```
3. **Weight Modality Inspection**:
   In `ResistanceVariant.cs`, inspect `loadText` and notes in addition to exercise name:
   ```csharp
   public static string For(string loadModel, string? exerciseName, string? loadText = null, string? notes = null)
   {
       if (loadModel == LoadModels.FullBodyweight)
       {
           var combined = $"{exerciseName} {loadText} {notes}";
           if (Assisted().IsMatch(combined)) return ResistanceModes.Assistance;
           if (Weighted().IsMatch(combined) || HasAddedLoad(loadText)) return ResistanceModes.Added;
           return ResistanceModes.Bodyweight;
       }
       ...
   }
   ```
4. **Display Absolute Prescribed Loads in UI**:
   In `WorkoutSetRow.tsx`, if `prescribedPercentage` is null, display `plan?.loadText` directly in the target cell:
   ```tsx
   <div className="set-target-cell">
     <span className="target-text">{target.reps}</span>
     {prescribedPercentage ? (
       <small className="set-percentage-target">{prescribedPercentage}</small>
     ) : plan?.loadText ? (
       <small className="set-load-target">{plan.loadText}</small>
     ) : null}
     {target.load && <small className="suggestion-text">{target.load}</small>}
   </div>
   ```

### 4.5 UI Honesty & Validation Alignment
**Priority: High**
1. **Fix Unmapped Banner Deception**:
   In `ImportReviewPanel.tsx` (lines 100–106), update the banner text to be honest:
   ```tsx
   <span className="irev-unresolved-text">
     {view.unresolved.length} exercise slot{view.unresolved.length === 1 ? ' is' : 's are'} not linked to the catalog. Link or create each exercise to enable program creation.
   </span>
   ```
   Alternatively, enhance `ImportService.cs` to auto-provision unmapped exercises as custom user movements during `Accept()`.
2. **Permissive SequenceGroup and RIR Handling**:
   - In `ImportService.External.cs`, auto-trim `sequenceGroup`.
   - Strip `"RIR"` from `set.Rir` before running numeric range validation.
   - Ignore single-exercise sequence groups instead of throwing superset errors.

---

## 5. Verification & Testing Protocol

### 5.1 Test Execution Suite Commands
To run the automated test suite in WorkoutApp and verify import functionality:

#### Backend API Tests (`WorkoutApp/api`):
```powershell
# Run all External Import tests
cd D:\App\WorkoutApp\api
dotnet test --filter "FullyQualifiedName~ExternalImport"

# Run all Catalog and Normalization tests
dotnet test --filter "FullyQualifiedName~Catalog|FullyQualifiedName~ImportNormalization"

# Run all Workout Set Validation and Progression tests
dotnet test --filter "FullyQualifiedName~WorkoutSetValidation|FullyQualifiedName~Progression"
```

#### Frontend Web Tests (`WorkoutApp/web`):
```powershell
# Run external import parser and helper tests
cd D:\App\WorkoutApp\web
npm.cmd test -- src/lib/externalImport.test.ts

# Run duration and set row UI tests
npm.cmd test -- src/lib/setDuration.test.ts src/lib/importSetTypes.test.ts

# Run panel component tests
npm.cmd test -- src/components/ImportExternalPanel.test.ts
```

### 5.2 Empirical Regression Test Matrix
For each reported defect, verify against the following test cases:

| Defect # | Target Test Suite | Test Case Assertion |
|---|---|---|
| **B.1** | `ExternalImportEnvelopeTests` | Passing input with ` ```json ` fences parses cleanly without 400 error |
| **B.2** | `ExternalImportEnvelopeTests` | Passing input with leading conversational text extracts JSON successfully |
| **B.3** | `ExternalImportEnvelopeTests` | Passing input with trailing commas parses without throwing `JsonException` |
| **B.4** | `ExternalImportEnvelopeTests` | Quoted numeric `"repMin": "8"` deserializes to integer `8`; non-numeric `"repMin": "8-10"` triggers field hint at `$.program.days[0].exercises[0].sets[0].repMin` |
| **A.1** | `ImportServiceExternalTests` | Passing exercises with sequence groups `"A1"` and `"A2"` groups into superset `"A"` |
| **C.1** | `ImportServiceExternalTests` | Passing `"type": "AMRAP"` or `"Dropset"` maps cleanly to `"AMRAP"` and `"Dropset"` |
| **C.3** | `DraftConversionTests` | Warmup sets extracted from PDF retain `Warmup = true` in `DraftSet` |
| **D.2** | `ImportServiceExternalTests` | Passing `"repsText": "60s"` with `"repMin": 60` clears `repMin` to `null` |
| **E.1** | `WorkoutSetRow.test.tsx` | Verbatim `"50 lbs"` renders in `.set-target-cell` when percentage is absent |
| **E.2** | `ResistanceVariantTests` | Exercise `"Pull-up"` with `loadText: "+20kg"` resolves to `ResistanceModes.Added` |
| **F.1** | `ImportReviewPanel.test.tsx`| UI banner clearly reflects whether unmapped exercises block program creation |
| **F.2** | `ImportServiceExternalTests` | Program with lettered straight sets (`A`, `B`, `C`) imports without 400 error |
| **F.4** | `ImportServiceExternalTests` | Passing `"rir": "RIR 2"` normalizes to `"2"` without regex validation failure |

---

## 6. Document Revision History & Changelog

### Version 2.0.0 (November 10, 2026 — Post-Gate Remediation)
- **Finding B.4 Empirical Refactoring**: Reframed Finding B.4 from quoted numeric rejection to deserialization intolerance of non-numeric strings (`"8-10"`, `"eight"`, `"90s"`) in numeric fields. Documented modern .NET 10 `JsonSerializerDefaults.Web` behavior (`JsonNumberHandling.AllowReadingFromString` enabled by default) and clarified the true root cause and triggering mechanism for `ExternalImportFieldHints` HTTP 400 errors.
- **Inventory & Severity Harmonization**: Corrected Section 1.2 total defect count from 24 to 27 (4 Critical, 10 High, 11 Medium, 2 Low), perfectly harmonizing Section 1.2, Section 2 catalog entries, and Section 3 Master Matrix rows.
- **Severity Alignment**: Aligned Finding B.3 severity to Critical in Section 2 to match Section 3 Master Matrix (Row 3).
- **Remediation Roadmap Updates**: Updated Section 4.1 Item 2 with concrete guidance on custom JSON converters and bound extraction from range strings.
- **Test Matrix Updates**: Updated Section 5.2 test assertion for Finding B.4 to test both quoted numeric success and non-numeric string rejection.

### Version 1.0.0 (November 10, 2026 — Initial Comprehensive Audit)
- Initial release cataloging findings across dual import pipelines (Pipeline A external import and Pipeline B PDF AI extraction).

---

*Report Author: Worker Subagent (AI Program Import Audit)*
*Verification Authority: Antigravity Teamwork Orchestration Gate*
