/**
 * Anatomically detailed SVG paths for the muscle-coverage body map (Back view).
 * Coordinate space: 200 × 420, figure centred at x = 100.
 *
 * The same rule as the front view applies here: a boundary two muscles share is written once and
 * both regions are composed from it, so the silhouette cannot show through a disagreement. See
 * `bodyMapFrontPaths.ts` for the reasoning and for `mirror`.
 */

import { mirror } from './bodyMapFrontPaths';

/* ────────────────────────────────────────────────
 * Back-view silhouette
 * Scapular shapes and spine/lumbar groove give a "back" cue.
 * Glutes are rounder; lats flare wider.
 * ──────────────────────────────────────────────── */
export const BACK_SILHOUETTE = `
  M100 12
  C110 12 117 19 117 31
  C117 42 112 50 108 55
  L108 60
  C108 62 108 64 110 66
  C118 68 128 72 136 78
  C148 86 156 94 155 106
  C154 114 148 122 143 128
  C141 134 139 146 140 156
  C140 160 140 164 142 168
  C148 178 151 190 150 200
  C149 210 146 218 143 224
  C145 228 146 232 148 236
  C149 238 148 240 146 241
  C144 242 143 244 141 248
  C139 252 136 253 134 252
  C132 250 131 242 131 234
  C131 228 131 224 131 220
  C129 210 128 198 128 186
  C128 174 126 164 125 156
  C124 146 124 136 124 128
  C124 136 124 150 124 160
  C123 168 121 176 123 182
  C125 190 129 198 131 206
  C133 216 133 230 132 246
  C130 260 127 276 125 288
  C124 294 124 298 124 302
  C127 314 130 326 130 340
  C130 354 126 368 122 380
  C121 384 121 388 122 392
  C124 400 125 406 124 410
  C123 413 120 414 116 414
  C112 414 110 410 110 402
  L110 388
  C108 374 106 358 106 340
  C106 326 108 314 109 304
  C109 298 109 294 109 290
  C108 278 107 262 106 248
  C105 232 103 218 100 210
  C97 218 95 232 94 248
  C93 262 92 278 91 290
  C91 294 91 298 91 304
  C92 314 94 326 94 340
  C94 358 92 374 90 388
  L90 402
  C90 410 88 414 84 414
  C80 414 77 413 76 410
  C75 406 76 400 78 392
  C79 388 79 384 78 380
  C74 368 70 354 70 340
  C70 326 73 314 76 302
  C76 298 76 294 75 288
  C73 276 70 260 68 246
  C67 230 67 216 69 206
  C71 198 75 190 77 182
  C79 176 77 168 76 160
  C76 150 76 136 76 128
  C76 136 76 146 75 156
  C74 164 72 174 72 186
  C72 198 71 210 69 220
  C69 224 69 228 69 234
  C69 242 68 250 66 252
  C64 253 61 252 59 248
  C57 244 56 242 54 241
  C52 240 51 238 52 236
  C54 232 55 228 57 224
  C54 218 51 210 50 200
  C49 190 52 178 58 168
  C60 164 60 160 60 156
  C61 146 59 134 57 128
  C52 122 46 114 45 106
  C44 94 52 86 64 78
  C72 72 82 68 90 66
  C92 64 92 62 92 60
  L92 55
  C88 50 83 42 83 31
  C83 19 90 12 100 12 Z
`;

/// Spine line + scapular outlines for visual back cue.
export const BACK_ANATOMY_LINES = `
  M100 76 L100 140
  M100 146 L100 200
  M82 96 L88 108 L82 126
  M118 96 L112 108 L118 126
`;

/* ────────────────────────────────────────────────
 * Shared seams (left side).
 * ──────────────────────────────────────────────── */

/// Nape of the neck into the shoulder line: (90,66) → (100,73) → (110,66). The trapezius used to
/// start above this and paint over the neck.
const NECK_BASE = 'L92 70 C95 72 97 73 100 73 C103 73 105 72 108 70 L110 66';

/// Lower edge of the trapezius kite on the left: (76,100) → (100,140).
const TRAP_LAT = 'L100 140';

/// Deltoid insertion across the upper arm: (57,128) → (72,116).
const DELT_ARM = 'C62 125 67 121 72 116';

/// Deltoid against the trapezius and the lat below it: (72,116) → (76,100).
const DELT_BACK = 'C74 110 75 104 76 100';

/// Medial edge of the upper arm, deltoid insertion to elbow: (72,116) → (74,168).
const ARM_MEDIAL = 'C75 130 76 148 74 168';
const ARM_LATERAL_UPPER_REVERSED = 'C60 164 60 160 60 156 C61 146 59 134 57 128';

/// Medial edge of the forearm: (74,168) → (66,224).
const FOREARM_MEDIAL = 'C75 184 73 200 70 214 C69 219 67 222 66 224';

/// Lateral edge of the latissimus below the deltoid. It is the arm's own medial edge walked
/// upward, so the torso reaches the arm instead of stopping a few units short of it and leaving a
/// sliver down the armpit. (75,206) → (76,100).
const LAT_LATERAL_UPWARD = 'C73 194 73 180 74 168 C76 148 75 130 72 116';

/// Iliac crest: where the lower back hands over to the gluteals. (100,202) → (75,206).
const LAT_GLUTE = 'C89 203 81 204 75 206';

/// Gluteal fold: where the gluteals hand over to the hamstrings. (68,244) → (97,246).
const GLUTE_HAMSTRING = 'C72 250 80 254 88 254 C93 254 96 251 97 246';
const GLUTE_HAMSTRING_REVERSED = 'C96 251 93 254 88 254 C80 254 72 250 68 244';

/// The knee line the shank meets.
const KNEE_LEFT = 'L91 302';

/* ────────────────────────────────────────────────
 * Back-view muscle regions.
 *
 * Record order is paint order; the torso precedes the arms so an arm covers the few units where it
 * overlaps the ribs.
 * ──────────────────────────────────────────────── */
const NECK = `
  M92 55
  C94 57 97 59 100 59
  C103 59 106 57 108 55
  L108 60
  C108 62 108 64 110 66
  L108 70
  C105 72 103 73 100 73
  C97 73 95 72 92 70
  L90 66
  C92 64 92 62 92 60 Z
`;

/// Full trapezius diamond, from the nape to mid-spine.
const TRAPS = `
  M90 66
  ${NECK_BASE}
  C118 68 128 72 136 78
  L124 100
  ${mirror(TRAP_LAT)}
  L76 100
  L64 78
  C72 72 82 68 90 66 Z
`;

const SHOULDER_LEFT = `
  M64 78
  C52 86 44 94 45 106
  C46 114 52 122 57 128
  ${DELT_ARM}
  ${DELT_BACK}
  Z
`;

/// Latissimus and lower back. The upper edge is the trapezius' own lower edge and the lower edge
/// is the iliac crest the gluteals start from, so the flank is covered all the way down.
const BACK_LEFT = `
  M76 100
  ${TRAP_LAT}
  L100 202
  ${LAT_GLUTE}
  ${LAT_LATERAL_UPWARD}
  ${DELT_BACK}
  Z
`;

const TRICEP_LEFT = `
  M57 128
  ${DELT_ARM}
  ${ARM_MEDIAL}
  L58 168
  ${ARM_LATERAL_UPPER_REVERSED}
  Z
`;

const FOREARM_LEFT = `
  M58 168
  L74 168
  ${FOREARM_MEDIAL}
  L57 224
  C54 218 51 210 50 200
  C49 190 52 178 58 168
  Z
`;

const GLUTE_LEFT = `
  M100 202
  ${LAT_GLUTE}
  C71 218 68 230 68 244
  ${GLUTE_HAMSTRING}
  C98 230 99 214 100 202
  Z
`;

/// The hamstring runs down to the same knee line the calf starts from, so the back of the leg has
/// no unattributed band above the knee.
const HAMSTRING_LEFT = `
  M97 246
  ${GLUTE_HAMSTRING_REVERSED}
  C69 254 71 268 74 282
  C75 292 76 298 76 302
  ${KNEE_LEFT}
  C92 296 93 290 93 284
  C95 270 96 258 97 246
  Z
`;

/// Gastrocnemius, sharing the knee line with the thigh above it.
const CALF_LEFT = `
  M76 302
  ${KNEE_LEFT}
  C93 316 94 330 94 344
  C94 360 92 374 90 384
  L80 384
  C74 370 70 354 70 340
  C70 326 73 314 76 302
  Z
`;

const pair = (left: string) => `${left}\n${mirror(left)}`;

export const BACK_REGIONS: Record<string, string> = {
  Neck: NECK,
  Traps: TRAPS,
  Back: pair(BACK_LEFT),
  Shoulders: pair(SHOULDER_LEFT),
  Triceps: pair(TRICEP_LEFT),
  Forearms: pair(FOREARM_LEFT),
  Glutes: pair(GLUTE_LEFT),
  Hamstrings: pair(HAMSTRING_LEFT),
  Calves: pair(CALF_LEFT)
};

/// Exported so the path tests can assert both regions on a seam carry the same edge text.
export const BACK_SEAMS = {
  trapLat: TRAP_LAT,
  deltArm: DELT_ARM,
  deltBack: DELT_BACK,
  armMedial: ARM_MEDIAL,
  latLateralUpward: LAT_LATERAL_UPWARD,
  kneeLeft: KNEE_LEFT,
  latGlute: LAT_GLUTE,
  gluteHamstring: GLUTE_HAMSTRING
};
