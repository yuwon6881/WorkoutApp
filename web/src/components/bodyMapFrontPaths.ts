/**
 * Anatomically detailed SVG paths for the muscle-coverage body map (Front view).
 * Coordinate space: 200 × 420, figure centred at x = 100.
 *
 * Neighbouring muscles must not each carry their own idea of where they meet. When they do, the
 * silhouette shows through the disagreement and reads as a hole in the body rather than as
 * background. Every boundary two regions share is therefore written once, below, and both regions
 * are composed from it — one of them traversing it in reverse.
 *
 * The outline itself is built from those same constants, so a muscle cannot drift away from the
 * body it belongs to. Seams carry left-side coordinates; `mirror` reflects a path about x = 100 for
 * the other side, so the two halves cannot drift apart either.
 *
 * The torso and the two arms are separate subpaths rather than one outline. That is what opens the
 * armpit: with a single outline the arm and the ribcage share an edge, and a filled arm reads as
 * part of the torso instead of as a limb hanging beside it.
 */

export const BODY_MAP_VIEW_BOX = '0 0 200 420';

/**
 * Reflects a left-side path about the figure's centre line so both halves are generated from one
 * description. Only absolute commands are used in this file, and every command here takes plain
 * x/y pairs, so mirroring is a negation of each x.
 */
export function mirror(path: string): string {
  return path.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
    (_, x: string, y: string) => `${200 - Number(x)} ${y}`);
}

/* ────────────────────────────────────────────────
 * Shared edges (left side), written in the direction the muscle regions walk them.
 * ──────────────────────────────────────────────── */

/// Neck base into the shoulder line: (90,66) → (100,75) → (110,66).
const NECK_BASE = 'L92 72 C95 74 97 75 100 75 C103 75 105 74 108 72 L110 66';

/// The clavicle: the trapezius hands over to the pectoral along it. (92,76) → (64,78).
const CLAVICLE = 'C84 79 73 80 62 78';
const CLAVICLE_REVERSED = 'C73 80 84 79 92 76';

/// Ribcage wall from the shoulder down to the armpit: (64,78) → (77,118).
const TORSO_SIDE_UPPER = 'C69 88 73 102 74 118';
const TORSO_SIDE_UPPER_REVERSED = 'C73 102 69 88 62 78';

/// The V-taper: ribs out, waist in, then back out to the hip. (77,118) → (78,200).
const TORSO_SIDE = 'C75 134 78 154 80 172 C81 184 78 193 75 200';
const TORSO_SIDE_REVERSED = 'C78 193 81 184 80 172 C78 154 75 134 74 118';

/// Inner edge of the arm above the armpit, where the deltoid meets the shoulder: (72,112) → (64,78).
const ARM_INNER_UPPER = 'C68 99 64 88 62 78';
const ARM_INNER_UPPER_REVERSED = 'C64 88 68 99 72 112';

/// Outer sweep of the deltoid, shoulder point round to the top of the arm: (62,78) → (57,128).
const DELT_OUTER = 'C49 86 41 96 43 110 C45 120 48 127 50 130';

/// The deltoid insertion, cupping the top of the arm: (57,128) → (72,112). Keeping this high and
/// curved is what makes the cap read as a shoulder sitting on the arm rather than a slice through it.
const DELT_ARM = 'C55 124 61 116 72 112';

/// Medial edge of the upper arm, armpit to elbow: (72,112) → (70,168).
const ARM_MEDIAL = 'C70 128 70 148 70 168';

/// Lateral arm contour, elbow back up to the shoulder.
const ARM_LATERAL_UPPER = 'C50 142 51 154 52 162 C52 165 53 167 54 168';
const ARM_LATERAL_UPPER_REVERSED = 'C53 167 52 165 52 162 C51 154 50 142 50 130';

/// Medial edge of the forearm: (70,168) → (66,224).
const FOREARM_MEDIAL = 'C69 184 68 200 68 212 C68 218 67 222 66 224';

/// Lateral edge of the forearm: (58,168) → (57,224).
const FOREARM_LATERAL = 'C50 180 48 194 49 206 C50 214 53 220 56 224';
const FOREARM_LATERAL_REVERSED = 'C53 220 50 214 49 206 C48 194 50 180 54 168';

/// Lower border of the pectoral, ribs to sternum: (77,118) → (100,119).
const CHEST_BOTTOM = 'C81 128 92 128 100 119';
const CHEST_BOTTOM_REVERSED = 'C92 128 81 128 74 118';

/// Outer wall of the thigh, hip to knee: (78,200) → (79,302).
const THIGH_OUTER = 'C68 214 65 234 67 252 C70 268 76 284 78 294 C78 297 79 300 79 302';
const THIGH_OUTER_REVERSED = 'C79 300 78 297 78 294 C76 284 70 268 67 252 C65 234 68 214 75 200';

/// Outer wall of the shank, knee to ankle: (79,302) → (79,384).
const SHANK_OUTER = 'C73 316 68 332 68 346 C68 362 74 374 79 384';
const SHANK_OUTER_REVERSED = 'C74 374 68 362 68 346 C68 332 73 316 79 302';

/// Quadriceps against the adductors, hip to just above the knee: (78,200) → (91,294).
const QUAD_ADDUCTOR = 'C81 210 84 224 84 244 C84 264 88 280 91 294';
const QUAD_ADDUCTOR_REVERSED = 'C88 280 84 264 84 244 C84 224 81 210 75 200';

/// Medial contour of the thigh, groin down to the knee: (99,210) → (91,294), walked upward.
const INNER_THIGH_UPWARD = 'C92 281 93 268 95 252 C96 236 98 222 100 210';

/// The knee line the thigh and the shank meet on.
const KNEE_LEFT = 'L91 302';

/* ────────────────────────────────────────────────
 * Silhouette: torso and the two arms, as separate subpaths.
 * ──────────────────────────────────────────────── */
const TORSO_OUTLINE = `
  M100 12
  C110 12 117 19 117 31
  C117 42 112 50 108 55
  L108 60
  C108 62 108 64 110 66
  C118 68 128 72 136 78
  ${mirror(TORSO_SIDE_UPPER)}
  ${mirror(TORSO_SIDE)}
  ${mirror(THIGH_OUTER)}
  ${mirror(SHANK_OUTER)}
  L121 402
  C121 410 119 414 115 414
  C111 414 108 413 107 410
  C106 406 107 400 109 392
  C110 388 110 384 109 380
  C107 368 106 356 106 342
  C106 328 107 316 108 306
  C108 300 108 296 108 292
  C107 280 106 264 105 250
  C104 234 102 218 100 210
  C98 218 96 234 95 250
  C94 264 93 280 92 292
  C92 296 92 300 92 306
  C93 316 94 328 94 342
  C94 356 93 368 91 380
  C90 384 90 388 91 392
  C93 400 94 406 93 410
  C92 413 89 414 85 414
  C81 414 79 410 79 402
  L79 384
  ${SHANK_OUTER_REVERSED}
  ${THIGH_OUTER_REVERSED}
  ${TORSO_SIDE_REVERSED}
  ${TORSO_SIDE_UPPER_REVERSED}
  C72 72 82 68 90 66
  C92 64 92 62 92 60
  L92 55
  C88 50 83 42 83 31
  C83 19 90 12 100 12 Z
`;

const ARM_OUTLINE_LEFT = `
  M62 78
  ${DELT_OUTER}
  ${ARM_LATERAL_UPPER}
  ${FOREARM_LATERAL}
  C54 228 53 232 51 236
  C51 238 52 240 54 241
  C56 242 57 244 59 248
  C61 252 64 253 66 252
  C68 250 69 242 69 234
  C69 228 68 226 66 224
  C67 222 68 218 68 212
  C68 200 69 184 70 168
  C70 148 70 128 72 112
  ${ARM_INNER_UPPER}
  Z
`;

export const FRONT_SILHOUETTE = `
  ${TORSO_OUTLINE}
  ${ARM_OUTLINE_LEFT}
  ${mirror(ARM_OUTLINE_LEFT)}
`;

/* ────────────────────────────────────────────────
 * Front-view muscle regions. Record order is paint order.
 * ──────────────────────────────────────────────── */
const NECK = `
  M92 55
  C94 57 97 59 100 59
  C103 59 106 57 108 55
  L108 60
  C108 62 108 64 110 66
  L108 72
  C105 74 103 75 100 75
  C97 75 95 74 92 72
  L90 66
  C92 64 92 62 92 60 Z
`;

const TRAPS = `
  M90 66
  ${NECK_BASE}
  C118 68 128 72 136 78
  ${mirror(CLAVICLE_REVERSED)}
  L102 76
  L100 78
  L98 76
  L92 76
  ${CLAVICLE}
  C72 72 82 68 90 66 Z
`;

const SHOULDER_LEFT = `
  M62 78
  ${DELT_OUTER}
  ${DELT_ARM}
  ${ARM_INNER_UPPER}
  Z
`;

const CHEST_LEFT = `
  M100 76
  L92 76
  ${CLAVICLE}
  ${TORSO_SIDE_UPPER}
  ${CHEST_BOTTOM}
  Z
`;

/// Rectus abdominis and obliques.
const CORE_LEFT = `
  M100 119
  ${CHEST_BOTTOM_REVERSED}
  ${TORSO_SIDE}
  L100 208
  Z
`;

const BICEP_LEFT = `
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

const ADDUCTOR_LEFT = `
  M75 200
  ${QUAD_ADDUCTOR}
  ${INNER_THIGH_UPWARD}
  C94 204 85 201 75 200
  Z
`;

const QUAD_LEFT = `
  M75 200
  ${THIGH_OUTER}
  ${KNEE_LEFT}
  C91 299 91 296 91 294
  ${QUAD_ADDUCTOR_REVERSED}
  Z
`;

/// Tibialis anterior, sharing the knee line with the thigh above it.
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

export const FRONT_REGIONS: Record<string, string> = {
  Neck: NECK,
  Traps: TRAPS,
  Chest: pair(CHEST_LEFT),
  Core: pair(CORE_LEFT),
  Shoulders: pair(SHOULDER_LEFT),
  Biceps: pair(BICEP_LEFT),
  Forearms: pair(FOREARM_LEFT),
  Adductors: pair(ADDUCTOR_LEFT),
  Quads: pair(QUAD_LEFT),
  Calves: pair(CALF_LEFT)
};

/**
 * Definition drawn over the filled regions: the divisions inside a muscle that the coverage data
 * has no opinion about. They are decoration, not regions — the server credits fourteen muscles and
 * a line here must never imply a fifteenth.
 */
const FRONT_DETAIL_LEFT = `
  M86 142 L98 142
  M85 162 L98 162
  M85 182 L98 182
  M86 198 L98 198
  M79 122 C85 130 93 131 98 126
  M55 110 C59 103 63 96 66 90
  M63 138 C66 145 67 152 67 159
  M81 218 C84 244 86 268 87 290
  M81 300 L90 300
  M84 320 C86 338 86 358 85 374
`;

export const FRONT_ANATOMY_LINES = `
  M100 120 L100 208
  ${FRONT_DETAIL_LEFT}
  ${mirror(FRONT_DETAIL_LEFT)}
`;

/// Exported so the path tests can assert both regions on a seam meet at the same points.
export const FRONT_SEAMS = {
  clavicle: CLAVICLE,
  torsoSideUpper: TORSO_SIDE_UPPER,
  torsoSide: TORSO_SIDE,
  deltOuter: DELT_OUTER,
  armInnerUpper: ARM_INNER_UPPER,
  armInnerUpperReversed: ARM_INNER_UPPER_REVERSED,
  deltArm: DELT_ARM,
  armMedial: ARM_MEDIAL,
  armLateralUpper: ARM_LATERAL_UPPER,
  armLateralUpperReversed: ARM_LATERAL_UPPER_REVERSED,
  forearmMedial: FOREARM_MEDIAL,
  forearmLateral: FOREARM_LATERAL,
  forearmLateralReversed: FOREARM_LATERAL_REVERSED,
  chestBottom: CHEST_BOTTOM,
  thighOuter: THIGH_OUTER,
  shankOuter: SHANK_OUTER,
  shankOuterReversed: SHANK_OUTER_REVERSED,
  quadAdductor: QUAD_ADDUCTOR,
  kneeLeft: KNEE_LEFT
};
