# PDF import audit — 2026-09-27

## Scope and evidence

Audited the 39 PDFs in `D:\App\Programs` by SHA-256 and page count, ran the browser-equivalent text/link extraction locally, and replayed every available program and alternative branch through the importer with both the faithful and deliberately drifting local reader. The run produced 45 normal branches and matching drift branches. PDF bytes and images remained local; no paid/live model call was used.

The full corpus replay output (titles, weeks, printed slot order, review items, model-read count, catalog misses, and semantic digests for every normal/drift branch) is in [PDF_IMPORT_CORPUS_2026-09-27.md](PDF_IMPORT_CORPUS_2026-09-27.md). The exact normal imported draft fields for all 45 branches are archived as JSON in [PDF_IMPORT_AUDIT_2026-09-27.actual-drafts.zip](PDF_IMPORT_AUDIT_2026-09-27.actual-drafts.zip). The drafts include source page, exercise and alternative names, sets, reps, RPE/RIR, load, tempo, rest text and seconds, notes/technique, warm-up flags, substitutions, and demo URLs.

There are 3,147 pages across the PDFs. The browser extraction found selectable text on 3,135 pages; 12 pages had no text layer and carried no guessed content. The PDFs expose 20,871 extracted annotation/printed-link candidates. The three long-week branches preserve, respectively, 8 slots (6 training sessions, 2 rests), 10 slots (8 training sessions, 2 rests), and 12 slots (8 training sessions, 4 rests) in their printed week.

## Aggregate checks on imported values

| Check | Corpus result |
|---|---:|
| Schedule slots / training days / rest days | 2,844 / 2,130 / 714 |
| Exercise occurrences / set occurrences | 13,570 / 46,782 |
| Warm-up set occurrences | 12,891 |
| Preserved printed load / tempo values | 2,986 / 802 |
| Simple rep ranges checked against numeric bounds | 27,392; mismatches: 0 |
| Compound rep strings preserved (e.g. `7/7/7`, `10+5`) | 816 |
| Empty rep targets retained | 345 |
| Numeric target RPE/RIR pairs checked | 31,693; mismatches: 0 |
| Unitized rest ranges checked at arithmetic midpoint | 39,836; mismatches: 0 |
| Unitized single rest values | 6,695 |
| Explicit no-rest values / blank rest values | 1,259 / 243 |
| Rest approximation markers retained | 15,659 |
| Exercise-name demo-link associations whose video ID and playback start occur in that source PDF | 23,188 / 23,188 |

These are consistency checks over imported output, not independent transcription of every source row. They verify that printed time ranges map to arithmetic midpoints and the shown range text survives, simple rep bounds agree with displayed targets, and numeric RPE/RIR conversions agree. The archived draft set is the actual side of that comparison.

## Partial-rep findings

Partial repetitions are explicitly prescribed; they are not limited to explanatory prose. The imported corpus carries 862 set-occurrences with a partial technique across repeated program weeks/choices: 217 generic partial-rep labels, 208 integrated-partial labels, and 437 lengthened/long-length partial labels. These are occurrences, so the same printed prescription repeated in several weeks is counted more than once. No warm-up inherited a working-set technique.

Sixteen of the 39 source PDFs have partial-technique occurrences. They include Forearm Hypertrophy, High Frequency Full Body 5xweek, Powerbuilding 2.0 5–6xweek, all three Pure Bodybuilding Phase 2 schedules, both Min-Max 4X/5X programs, all three Pure Bodybuilding Program schedules, all three Ultimate Push Pull Legs System schedules, and Upper Lower 4xweek/6xweek. See the source-page locations in the archived JSON; examples reviewed below demonstrate that several programs specify partials in coaching notes rather than a “Last-Set Intensity Technique” column.

### Source-reviewed prescription anchors

| Source location | Printed prescription | Imported result |
|---|---|---|
| Pure Bodybuilding Phase 2 — Full Body, p. 9, Neutral-Grip Lat Pulldown | 2 working sets; 8–10 reps; early RPE about 7 and final RPE about 9; approximate 2–3 min rest; alternate full/half-ROM reps on all sets and count partials toward the rep target | 2 warm-ups + 2 working sets; `8-10`; work RPE 7/9 (RIR 3/1); `~2-3 min` / 150 sec; `Integrated Partials (All Sets)` on both work sets only; original instruction retained on the exercise |
| Pure Bodybuilding Phase 2 — Full Body, p. 11, Wide-Grip Pull-Up | final set changes to bottom-half partial reps after reaching final-set RPE; stop at 0–1 partial reps in reserve; 8–10 reps and approx. 2–3 min rest | 2 warm-ups + 3 working sets; `8-10`; work RPE 9/9/10 (RIR 1/1/0); `~2-3 min` / 150 sec; `Lengthened Partials (Extend Set)` on the final working set only |
| The Min-Max Program 4X, p. 53, Pull-Up (Wide Grip) | 2 working sets of 6–8; final set uses lengthened partials to extend the set; 2–3 min rest | 1 warm-up + 2 working sets; `6-8`; work RPE 9/10 (RIR 1/0); `2-3 min` / 150 sec; extension note on final work set, no extra set or invented partial-rep count |
| Powerbuilding 2.0 5–6xweek, p. 58, DB Lateral Raise Swing | 4 sets of 12–15; RPE 9; 1–2 min; movement note says use a partial ROM; printed URL starts at 1167 sec | 1 warm-up + 4 work sets; `12-15`; RPE 9 / RIR 1; 90 sec; `Partial reps` on all work sets; `https://youtu.be/D4YWXJjVLJA?t=1167` |
| Upper Lower Program 4xweek, p. 34, Cable Flye 21s | 3 sets; `7/7/7` (top-half, bottom-half, full ROM); RPE 8; explicit `0 MIN` rest | Three work sets retain `7/7/7`, RPE 8 / RIR 2 and zero rest; `Partial reps` on all three sets |
| High Frequency Full Body 5xweek, pp. 54, 57, 60, 63, EZ Bar Curl 21s | p. 54 prints `7/7/7`, matching the note’s three seven-rep ROM segments; pp. 57/60/63 print `10` while repeating the same `7+7+7` note | p. 54 stays clear; pp. 57/60/63 preserve printed `10`, all source cues, and `Partial reps`, then block creation with `rep_technique_conflict` focused on the rep field |
| Upper Lower Program 6xweek, p. 49, EZ Bar Curl 21s | 3 sets; printed target `15`, RPE 10, 1–2 min rest; notes describe bottom-half 7 + top-half 7 + full-ROM 7 (21 reps) | All three sets retain `15`, RPE 10 / RIR 0, and 90 sec; source cue and `Partial reps` remain, with a blocking `rep_technique_conflict` on the rep field |
| Forearm Hypertrophy Program, p. 6, Reverse Grip Barbell Curl* | 2 sets; `10+5`; RPE 9; 1 min; “10 full ROM, 5 top half ROM to finish each set” | Both sets retain `10+5`, RPE 9 / RIR 1 and 60 sec; `Partial reps` on both; coaching text retained |
| Back Hypertrophy Program, p. 14, Wide Grip Seated Cable Row (Cluster 8 Sets) | 8 cluster sets; rest column states `0.5` under minutes context | Eight sets retain `0.5` source rest text and 30 sec timer |
| Powerbuilding-System 5–6xweek, p. 60, Helms Row | printed rest `1–2 MIN` (the selectable text extraction drops the `I` on this glyph run) | `1-2 MIN` retained and timer uses 90 sec |

The source rows/pages above were checked against local PDF text and rendered page images. Link association was also inspected on Back Hypertrophy p. 28 (cross-page glossary links), Bodybuilding Transformation System Beginner p. 4 (printed alternatives), and Powerbuilding 2.0 p. 58 (exercise-specific timestamp). The corpus-wide URL comparison checks video ID and start time against that PDF’s extracted candidate list; it does not independently prove all 23,188 exercise-name pairings are correct.

## Imported branch inventory

| Source PDF / choice | Weeks | Training sessions per week | Printed schedule slots per week | Exercise occurrences | Set occurrences | Warm-ups |
|---|---:|---:|---:|---:|---:|---:|
| Arm Hypertrophy Program.pdf — Default | 8 | 3 (3×8wk) | 3 (3×8wk) | 136 | 403 | 0 |
| Back Hypertrophy Program.pdf — Default | 9 | 2–3 (3×8wk; 2×1wk) | 2–3 (3×8wk; 2×1wk) | 145 | 461 | 0 |
| Bench Press Specialization Program.pdf — Default | 8 | 4–5 (5×4wk; 4×4wk) | 4–5 (5×4wk; 4×4wk) | 212 | 633 | 0 |
| Chest Hypertrophy Program.pdf — Default | 8 | 2 (2×8wk) | 2 (2×8wk) | 56 | 179 | 0 |
| Forearm Hypertrophy Program.pdf — Default | 8 | 3 (3×8wk) | 3 (3×8wk) | 80 | 186 | 0 |
| Fundamentals Hypertrophy Program.pdf — Bodypart Program | 8 | 5 (5×8wk) | 5 (5×8wk) | 232 | 660 | 0 |
| Fundamentals Hypertrophy Program.pdf — Full Body Program | 8 | 3 (3×8wk) | 3 (3×8wk) | 168 | 504 | 0 |
| Fundamentals Hypertrophy Program.pdf — Upper/Lower Program | 8 | 4 (4×8wk) | 4 (4×8wk) | 224 | 672 | 0 |
| High Frequency Full Body Program 4xweek.pdf — Default | 10 | 4 (4×10wk) | 4 (4×10wk) | 301 | 1,294 | 361 |
| High Frequency Full Body Program 5xweek.pdf — Default | 10 | 5 (5×10wk) | 5 (5×10wk) | 360 | 1,551 | 424 |
| Intermediate Advanced PPL Program 6xweek.pdf — Default | 16 | 6 (6×16wk) | 6 (6×16wk) | 704 | 2,029 | 0 |
| Neck and Trap Guide.pdf — Default | 8 | 3 (3×8wk) | 3 (3×8wk) | 96 | 260 | 0 |
| Powerbuilding-3.0 5xweek.pdf — Week A (printed 10A) | 10 | 3–5 (5×8wk; 3×2wk) | 6–7 (7×9wk; 6×1wk) | 227 | 954 | 384 |
| Powerbuilding-3.0 5xweek.pdf — Week B (printed 10B) | 10 | 3–5 (5×8wk; 3×2wk) | 6–7 (7×9wk; 6×1wk) | 227 | 954 | 384 |
| Powerbuilding-System 4xweek.pdf — Week A (printed 10A) | 11 | 3–5 (5, 4–5, 4–5, 4–5, 4–5, 3–4) | 4–7 (7, 6–7, 6–7, 6–7, 6–7, 4, 6) | 320 | 1,218 | 357 |
| Powerbuilding-System 4xweek.pdf — Week B (printed 10B) | 11 | 3–5 (5, 4–5, 4–5, 4–5, 4–5, 3–4) | 4–7 (7, 6–7, 6–7, 6–7, 6–7, 4, 6) | 320 | 1,221 | 360 |
| Powerbuilding-System 5-6xweek.pdf — Week A (printed 10A) | 11 | 3–6 (5–6, 5–6, 5–6, 5–6, 5, 3–4) | 5–7 (7, 7, 7, 7, 7, 7, 7, 7, 7, 5–6) | 358 | 1,341 | 416 |
| Powerbuilding-System 5-6xweek.pdf — Week B (printed 10B) | 11 | 3–6 (5–6, 5–6, 5–6, 5–6, 5, 3–4) | 5–7 (7, 7, 7, 7, 7, 7, 7, 7, 7, 5–6) | 358 | 1,344 | 419 |
| Powerbuilding 2.0 4xweek.pdf — Default | 12 | 4–5 (5, 4–5, 4–5, 4–5, 4–5, 4–5, 4) | 6–7 (7, 6–7, 6–7, 6–7, 6–7, 6–7, 6) | 373 | 1,502 | 465 |
| Powerbuilding 2.0 5-6xweek.pdf — Default | 12 | 5–6 (5–6, 5–6, 5–6, 5–6, 5–6, 5–6) | 7–8 (7–8, 7–8, 7–8, 7, 7, 7, 7, 7, 7) | 430 | 1,729 | 507 |
| Powerbuilding 3.0 4xweek.pdf — Week A (printed 10A) | 10 | 3–4 (4×8wk; 3×2wk) | 6–7 (7×9wk; 6×1wk) | 227 | 951 | 384 |
| Powerbuilding 3.0 4xweek.pdf — Week B (printed 10B) | 10 | 3–4 (4×8wk; 3×2wk) | 6–7 (7×9wk; 6×1wk) | 227 | 951 | 384 |
| Pure Bodybuilding Phase 2 - Full Body.pdf — Default | 10 | 5 (5×10wk) | 7 (7×10wk) | 310 | 1,276 | 429 |
| Pure Bodybuilding Phase 2 - Upper Lower.pdf — Default | 10 | 5 (5×10wk) | 7 (7×10wk) | 305 | 1,250 | 414 |
| Purebodybuilding Phase 2 - PPL.pdf — Default | 10 | 8 (8×10wk) | 10 (10×10wk) | 485 | 1,902 | 614 |
| Shoulder Hypertrophy Program.pdf — Default | 8 | 3 (3×8wk) | 3 (3×8wk) | 152 | 418 | 24 |
| Squat Specialization Program.pdf — Default | 10 | 2–4 (4, 4, 4, 4, 2, 2, 2, 2, 2–3) | 2–5 (4×4wk; 2×5wk; 5×1wk) | 143 | 403 | 0 |
| The_Bodybuilding_Transformation_System_-_Beginner.pdf — Default | 12 | 5 (5×12wk) | 7 (7×12wk) | 372 | 1,215 | 504 |
| The_Bodybuilding_Transformation_System_-_Intermediate_Advanced.pdf — Default | 12 | 5 (5×12wk) | 7 (7×12wk) | 408 | 1,546 | 540 |
| The Essentials Program - 2xweek.pdf — Default | 12 | 2 (2×12wk) | 6 (6×12wk) | 180 | 436 | 204 |
| The Essentials Program - 3xweek.pdf — Default | 12 | 3 (3×12wk) | 6 (6×12wk) | 240 | 664 | 280 |
| The Essentials Program - 4xweek.pdf — Default | 12 | 4 (4×12wk) | 6 (6×12wk) | 288 | 876 | 364 |
| The Essentials Program - 5xweek.pdf — Default | 12 | 5 (5×12wk) | 7 (7×12wk) | 324 | 988 | 404 |
| The_Min-Max_Phase2_Program__4X.pdf.pdf — Default | 12 | 4 (4×12wk) | 6 (6×12wk) | 396 | 876 | 216 |
| The_Min-Max_Phase2_Program__5X.pdf.pdf — Default | 12 | 5 (5×12wk) | 7 (7×12wk) | 444 | 948 | 216 |
| The_Min-Max_Program__4X.pdf — Default | 12 | 4 (4×12wk) | 6 (6×12wk) | 324 | 804 | 240 |
| The_Min-Max_Program__5X.pdf — Default | 12 | 5 (5×12wk) | 7 (7×12wk) | 420 | 1,056 | 300 |
| The_Pure_Bodybuilding_Program_-_Full_Body-1.pdf — Default | 10 | 5 (5×10wk) | 7 (7×10wk) | 315 | 1,228 | 370 |
| The_Pure_Bodybuilding_Program_-_PPL.pdf — Default | 10 | 8 (8×10wk) | 12 (12×10wk) | 480 | 1,799 | 515 |
| The_Pure_Bodybuilding_Program_-_UpperLower.pdf — Default | 10 | 5 (5×10wk) | 7 (7×10wk) | 320 | 1,269 | 365 |
| The Ultimate Push Pull Legs System - 4xweek.pdf — Default | 13 | 4 (4×13wk) | 6 (6×13wk) | 347 | 1,293 | 499 |
| The Ultimate Push Pull Legs System - 5xweek.pdf — Default | 13 | 5 (5×13wk) | 7 (7×13wk) | 425 | 1,597 | 606 |
| The Ultimate Push Pull Legs System - 6xweek.pdf — Default | 13 | 6 (6×13wk) | 7 (7×13wk) | 493 | 1,846 | 678 |
| Upper Lower Program 4xweek.pdf — Default | 9 | 4 (4×9wk) | 4 (4×9wk) | 258 | 1,077 | 264 |
| Upper Lower Program 6xweek.pdf — Default | 9 | 6 (6×9wk) | 6 (6×9wk) | 360 | 1,018 | 0 |

## PDF inventory, hashes, text coverage, and choices

| PDF | SHA-256 | Pages | Pages with text | No-text pages | Extracted link candidates | Imported choices |
|---|---|---:|---:|---|---:|---|
| Arm Hypertrophy Program.pdf | `55636d119e69f3ee6834d068cf0411d2d0c8632417a4f6ed454d406a2549d5ce` | 31 | 31 | — | 0 | Default |
| Back Hypertrophy Program.pdf | `3bf0fda4263fd9d5ef35e0644c87d5bc12495b2e26f5d969258d072aa6328c05` | 34 | 34 | — | 18 | Default |
| Bench Press Specialization Program.pdf | `631f5e0904d6fa8d27bedcadeb030a9ed7d2af5e4c2a88142ffc07916a38d0ee` | 78 | 78 | — | 75 | Default |
| Chest Hypertrophy Program.pdf | `845d9d24099a8697f014604c1f0d09f9a4488882198f92410148eed68c8f0d94` | 21 | 21 | — | 23 | Default |
| Forearm Hypertrophy Program.pdf | `d76edbbf4cd76dfacd2493371267ea35cade801c772d1053cea3a50b37d48ba4` | 26 | 26 | — | 0 | Default |
| Fundamentals Hypertrophy Program.pdf | `8d14263b0412fb4fc643685acc33cc168daa957ae125078dfbdb43c4f6820478` | 98 | 98 | — | 29 | Bodypart Program; Full Body Program; Upper/Lower Program |
| High Frequency Full Body Program 4xweek.pdf | `93796db4c65c77c58434079c4e5a2d95a50c2bc0950d2dba6a548898925644ce` | 104 | 104 | — | 105 | Default |
| High Frequency Full Body Program 5xweek.pdf | `4bc19cd01bcfb4023275db6add0ecc4a035a7a98c6882525919de8e4e9a7b388` | 106 | 106 | — | 102 | Default |
| Intermediate Advanced PPL Program 6xweek.pdf | `c448990a1aa1910186357c5b14a8d96571f27f332a338f01d88941c07bc93aaf` | 110 | 110 | — | 69 | Default |
| Neck and Trap Guide.pdf | `1e767fcb37986acfde80f4ee33fdfb2be523a272e5e59fddb0885babc6af061f` | 31 | 31 | — | 0 | Default |
| Powerbuilding 2.0 4xweek.pdf | `3b9a5cb466f93b9626123e09ddad5db21fd728c79aec53da40b18a76d9f67e6f` | 125 | 125 | — | 227 | Default |
| Powerbuilding 2.0 5-6xweek.pdf | `e0a4b41a5e13de36bddc1c225c05a5ed9342c85c352237fe66608772a19b0938` | 123 | 123 | — | 233 | Default |
| Powerbuilding 3.0 4xweek.pdf | `2455bfa825cd3382ce94603d7e027e228d9e21f086cd1d3faf6dd6d1516d3fb7` | 111 | 111 | — | 71 | Week A (printed 10A); Week B (printed 10B) |
| Powerbuilding-3.0 5xweek.pdf | `ec6335524c9bdd03ba2455b6e912843c0953a756d9e2f33fc1bac033f1d1a316` | 111 | 111 | — | 71 | Week A (printed 10A); Week B (printed 10B) |
| Powerbuilding-System 4xweek.pdf | `a03dffdb27af9e926cd2718de6f1964394fcefd7cb72211af0ad4570ee39b630` | 115 | 115 | — | 159 | Week A (printed 10A); Week B (printed 10B) |
| Powerbuilding-System 5-6xweek.pdf | `37bfe7618feb3c22a32c37012e40420eda1de900efb9558993b2d3a8d0be34b9` | 113 | 113 | — | 159 | Week A (printed 10A); Week B (printed 10B) |
| Pure Bodybuilding Phase 2 - Full Body.pdf | `142844edd159903f2c06e875dd11cb3baa296635f50aba09d7a9bd9a458ae111` | 55 | 54 | 1 | 944 | Default |
| Pure Bodybuilding Phase 2 - Upper Lower.pdf | `f455f6dc541515ba30c117315c74704cee6839b2682994febc09ff13059ed29c` | 55 | 54 | 1 | 929 | Default |
| Purebodybuilding Phase 2 - PPL.pdf | `dc34ca33eb720d7db076661178d9fd0a7e1c3776598920955eebd1af17fa773e` | 85 | 84 | 1 | 1,404 | Default |
| Shoulder Hypertrophy Program.pdf | `1042df4603224ae357c68f81f445e6e1d38c50348524771a5989450cb19b746e` | 31 | 31 | — | 1 | Default |
| Squat Specialization Program.pdf | `0f8ce2268a76532bf147b17b7c4e5d9cb0348bf219942743d10f89ce7ef3037b` | 70 | 70 | — | 49 | Default |
| The Essentials Program - 2xweek.pdf | `12cf9886c0fbb92302aa34dbf6e81941bf1b56691e37401dbe59b20cf2b7e8fa` | 66 | 66 | — | 492 | Default |
| The Essentials Program - 3xweek.pdf | `2aafd83030055fa37f04282a108ab694b824624ad260a1a534028c081ba09284` | 78 | 78 | — | 652 | Default |
| The Essentials Program - 4xweek.pdf | `b23e5efc67625af77e92ef06bc74d1fa790016b8edaccb9854a6bfbd747341cf` | 90 | 90 | — | 796 | Default |
| The Essentials Program - 5xweek.pdf | `b2f6e99f64843e389fba5bd1f0a1fd3e2d641b1885b82c905ecec1017ebd331f` | 102 | 102 | — | 908 | Default |
| The Ultimate Push Pull Legs System - 4xweek.pdf | `960e40a762c4f3bbc9c4ca17f9403464b19bf027c61d0a546ef031c5704faaef` | 102 | 102 | — | 934 | Default |
| The Ultimate Push Pull Legs System - 5xweek.pdf | `dc721e43200bbd9c95595f15537140bd5aad972a5602c9e193606f5678374842` | 115 | 115 | — | 1,204 | Default |
| The Ultimate Push Pull Legs System - 6xweek.pdf | `dea4e8285a42c5b911f15ff0eba4a6f5ce993c13d55247382ce0897b67f03ed3` | 128 | 128 | — | 1,402 | Default |
| The_Bodybuilding_Transformation_System_-_Beginner.pdf | `b5434ac31d69064b59d66fd8a2227de2969ae5921a71adac94c4f51f2b51ddbf` | 63 | 62 | 1 | 1,120 | Default |
| The_Bodybuilding_Transformation_System_-_Intermediate_Advanced.pdf | `0ad3e429683969412ce2f8149ea7cbc5c7bfea89e3d970abbe1118570ae0926e` | 63 | 62 | 1 | 1,229 | Default |
| The_Min-Max_Phase2_Program__4X.pdf.pdf | `8e259357aabf7ba94473308758b775682606baaa14440d62b99ae85a0c7979cd` | 79 | 78 | 1 | 936 | Default |
| The_Min-Max_Phase2_Program__5X.pdf.pdf | `0a31dbeb76819fbcf3b98f072153adc81829b6fafea33bb9a04f7be7671f4cb7` | 91 | 90 | 1 | 1,020 | Default |
| The_Min-Max_Program__4X.pdf | `6538bcac63954f7a348c6667d13aa63d772219e51649033b32baf256a07a5a95` | 78 | 77 | 1 | 900 | Default |
| The_Min-Max_Program__5X.pdf | `1e1ad2c3de26ae5f3a5763cd05aa93d7f61150e6bbce8363679999ff8b1bfd82` | 90 | 89 | 1 | 1,188 | Default |
| The_Pure_Bodybuilding_Program_-_Full_Body-1.pdf | `82123b0b04d1eeede12404275627e17d2ae9f3fc8eb3470a971629aeebef27c8` | 55 | 54 | 1 | 918 | Default |
| The_Pure_Bodybuilding_Program_-_PPL.pdf | `76f55933d8a1385881e9254efab460f2b65082c12558cfc176a069af7d0f731f` | 85 | 84 | 1 | 1,343 | Default |
| The_Pure_Bodybuilding_Program_-_UpperLower.pdf | `30967df078d4a1dc4f0e185f2abe58880bf560e5b999f576d51252f61c93f815` | 55 | 54 | 1 | 923 | Default |
| Upper Lower Program 4xweek.pdf | `c6e93dc0b2b445182ebc50e5106da7a2bf8e7e2cae05f6f28954393100b3e084` | 87 | 87 | — | 119 | Default |
| Upper Lower Program 6xweek.pdf | `b1b6477040f4ef4c0d31748b148712e8512b2682d041f2622cf3f79cf68e904d` | 87 | 87 | — | 119 | Default |

## Fixes included

- Technique scope now follows source language: a technique column without a qualifier defaults to the final working set; `All Sets`, explicit set numbers/ranges, and first/last-set language override that default. Warm-ups do not inherit techniques.
- Partial, integrated-partial, lengthened-partial, and long-length-partial mentions are recognized from matched exercise instructions and half-ROM prescriptions. Generic prose, negated advice, and unrelated explanatory mentions do not set a technique. Specific source techniques replace a generic model “Partial reps” label, retaining printed qualifiers/instructions.
- Top/bottom-half prescriptions retain compound rep strings such as `7/7/7` and `10+5`; partial extensions do not manufacture an additional set or a partial-rep count.
- Rest unit recovery repairs the source glyph-loss case only when page/header evidence proves minutes. Printed ranges and approximation prefixes remain visible; timers use their midpoint.
- Review edits/restores, program creation, and active workout preserve technique notes and audited values. The narrow set-editor rule now retains the 44 px touch target.
- Import prompt version advanced to `workout-import-v38-partial-rom-technique` so re-imported drafts use the corrected reader interpretation.

## Review blockers and acceptance boundary

Five page-specific review blockers remain: one unread effort value and four printed rep conflicts. The Essentials Program 3xweek, p. 34 has eight working sets whose printed RIR field is not recovered as blank, so `rpe_unread` is raised without guessing a value. High Frequency Full Body 5xweek pp. 57/60/63 and Upper Lower 6xweek p. 49 print rep targets that conflict with their own counted ROM sequences. Those source values and notes are preserved, and `rep_technique_conflict` points to the rep field. The matching High Frequency row on p. 54 remains clear because its printed `7/7/7` agrees with the 21-rep sequence. All five source locations are recorded in `tests/Corpus/CorpusExpected.json`.

**The plan’s full independent-baseline acceptance criterion is not complete.** `CorpusExpected.json` now has independent source-location expectations for five of 39 PDFs and alternative/count metadata for two of those documents, but it still has no field-by-field expected prescriptions for every exercise/set in all 45 choices. The 45-branch replay, drift equality, invariants, and visually reviewed source anchors provide broad evidence; they do not substitute for manually reviewed expectations for all 46,782 set occurrences or independently verified exercise-name pairings for all 23,188 demo mappings. This report records that remaining coverage rather than presenting the corpus pass as complete source fidelity.

The capture was entirely local. Live-provider output, live browser sign-in, production state, and deployment behavior were not exercised.
