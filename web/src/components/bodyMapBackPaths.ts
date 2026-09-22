/**
 * Anatomically detailed SVG paths for the muscle-coverage body map (Back view).
 * Coordinate space: 200 × 420, figure centred at x = 100.
 *
 * The same rule as the front view applies here: a boundary two muscles share is written once and
 * both regions are composed from it, so the silhouette cannot show through a disagreement. See
 * `bodyMapFrontPaths.ts` for the reasoning, for `mirror`, and for the armpit gap.
 */

import { FRONT_SEAMS, FRONT_SILHOUETTE, mirror } from './bodyMapFrontPaths';

/// The body outline does not differ between views; only what is drawn on it does.
export const BACK_SILHOUETTE = FRONT_SILHOUETTE;

/* ────────────────────────────────────────────────
 * Shared seams (left side). The arm and leg edges are the front view's own, so a muscle cannot sit
 * in a different place depending on which way the figure is facing.
 * ──────────────────────────────────────────────── */

/// Nape of the neck into the shoulder line: (90,66) → (100,73) → (110,66).
const NECK_BASE = 'L92 70 C95 72 97 73 100 73 C103 73 105 72 108 70 L110 66';

/// Lower edge of the trapezius kite on the left: (76,100) → (100,140).
const TRAP_LAT = 'L100 140';

const DELT_OUTER = FRONT_SEAMS.deltOuter;
const DELT_ARM = FRONT_SEAMS.deltArm;
const ARM_INNER_UPPER = FRONT_SEAMS.armInnerUpper;
const ARM_MEDIAL = FRONT_SEAMS.armMedial;
const KNEE_LEFT = FRONT_SEAMS.kneeLeft;

const ARM_LATERAL_UPPER_REVERSED = FRONT_SEAMS.armLateralUpperReversed;

const FOREARM_MEDIAL = FRONT_SEAMS.forearmMedial;
const FOREARM_LATERAL_REVERSED = FRONT_SEAMS.forearmLateralReversed;
const THIGH_OUTER = FRONT_SEAMS.thighOuter;
const SHANK_OUTER_REVERSED = FRONT_SEAMS.shankOuterReversed;

/// Iliac crest: where the lower back hands over to the gluteals. (100,202) → (79,205).
const LAT_GLUTE = 'C90 201 84 201 78 200';

/// Outer wall of the torso, walked upward from the crest to the trapezius: (79,205) → (76,100).
const LAT_LATERAL_UPWARD = 'C81 192 83 182 82 170 C80 152 77 132 76 100';

/// The hip and thigh outline from the crest down to the gluteal fold: (78,200) → (70,246).
const HIP_OUTER = 'C72 214 69 230 70 246';

/// Gluteal fold: where the gluteals hand over to the hamstrings. (75,246) → (97,246).
const GLUTE_HAMSTRING = 'C74 254 82 258 89 258 C94 258 96 252 98 246';
const GLUTE_HAMSTRING_REVERSED = 'C96 252 94 258 89 258 C82 258 74 254 70 246';

/* ────────────────────────────────────────────────
 * Back-view muscle regions. Record order is paint order.
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
  L62 78
  C72 72 82 68 90 66 Z
`;

const SHOULDER_LEFT = `
  M62 78
  ${DELT_OUTER}
  ${DELT_ARM}
  ${ARM_INNER_UPPER}
  Z
`;

/// Latissimus and lower back, reaching the torso's own outline so the flank is covered.
const BACK_LEFT = `
  M76 100
  ${TRAP_LAT}
  L100 202
  ${LAT_GLUTE}
  ${LAT_LATERAL_UPWARD}
  Z
`;

const TRICEP_LEFT = `
  M50 130
  ${DELT_ARM}
  ${ARM_MEDIAL}
  L54 168
  ${ARM_LATERAL_UPPER_REVERSED}
  Z
`;

const FOREARM_LEFT = `
  M54 168
  L70 168
  ${FOREARM_MEDIAL}
  L56 224
  ${FOREARM_LATERAL_REVERSED}
  Z
`;

const GLUTE_LEFT = `
  M100 202
  ${LAT_GLUTE}
  ${HIP_OUTER}
  ${GLUTE_HAMSTRING}
  C98 230 99 214 100 202
  Z
`;

/// The hamstring runs down to the same knee line the calf starts from.
const HAMSTRING_LEFT = `
  M98 246
  ${GLUTE_HAMSTRING_REVERSED}
  C72 264 77 282 78 294
  C78 297 79 300 79 302
  ${KNEE_LEFT}
  C93 296 94 290 94 284
  C96 270 97 258 98 246
  Z
`;

/// Gastrocnemius, sharing the knee line with the thigh above it.
const CALF_LEFT = `
  M79 302
  ${KNEE_LEFT}
  C94 316 95 330 95 344
  C95 358 94 372 92 382
  L80 382
  ${SHANK_OUTER_REVERSED}
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

/// Definition drawn over the filled regions. Decoration only — never a fifteenth muscle.
const BACK_DETAIL_LEFT = `
  M83 98 L91 112 L83 130
  M82 152 C87 170 93 186 98 197
  M55 110 C59 103 63 96 66 90
  M63 138 C66 145 67 152 67 159
  M81 220 C87 228 93 232 98 234
  M82 264 C86 280 88 292 87 300
  M81 300 L90 300
  M85 320 C87 340 87 360 86 378
`;

export const BACK_ANATOMY_LINES = `
  M100 78 L100 200
  ${BACK_DETAIL_LEFT}
  ${mirror(BACK_DETAIL_LEFT)}
`;

/// Exported so the path tests can assert both regions on a seam meet at the same points.
export const BACK_SEAMS = {
  trapLat: TRAP_LAT,
  deltOuter: DELT_OUTER,
  deltArm: DELT_ARM,
  armInnerUpper: ARM_INNER_UPPER,
  armMedial: ARM_MEDIAL,
  latLateralUpward: LAT_LATERAL_UPWARD,
  latGlute: LAT_GLUTE,
  hipOuter: HIP_OUTER,
  thighOuter: THIGH_OUTER,
  gluteHamstring: GLUTE_HAMSTRING,
  kneeLeft: KNEE_LEFT
};
