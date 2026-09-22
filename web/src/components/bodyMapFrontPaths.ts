/**
 * Anatomically detailed SVG paths for the muscle-coverage body map (Front view).
 * Coordinate space: 200 × 420, figure centred at x = 100.
 *
 * Neighbouring muscles must not each carry their own idea of where they meet. When they do, the
 * silhouette shows through the disagreement and reads as a hole in the body rather than as
 * background. Every boundary two regions share is therefore written once, below, and both regions
 * are composed from it — one of them traversing it in reverse.
 *
 * Seams are named for the pair they join and are given left-side coordinates; `mirror` reflects a
 * path about x = 100 for the other side of the figure, so the two halves cannot drift apart.
 */

export const BODY_MAP_VIEW_BOX = '0 0 200 420';

/* ────────────────────────────────────────────────
 * Front-view silhouette
 * More muscular build: wider shoulders, thicker arms,
 * bigger quads, thicker neck. Chest line gives "front" cue.
 * ──────────────────────────────────────────────── */
export const FRONT_SILHOUETTE = `
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

/// Linea alba + tendinous inscriptions showing the ab grid.
export const FRONT_ANATOMY_LINES = `
  M100 118 L100 206
  M83 140 L98 140 M102 140 L117 140
  M81 160 L98 160 M102 160 L119 160
  M80 180 L98 180 M102 180 L120 180
`;

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
 * Shared seams (left side). Each is written as the sequence of commands that continues from the
 * point named first, so a region can splice it in directly, and `reverse` versions are spelled out
 * where a region needs to walk the same edge the other way.
 * ──────────────────────────────────────────────── */

/// Neck base into the shoulder line: (90,66) → (100,73) → (110,66).
const NECK_BASE = 'L92 72 C95 74 97 75 100 75 C103 75 105 74 108 72 L110 66';

/// Lower edge of the upper trapezius, sternum end to shoulder cap: (92,76) → (70,86).
const TRAP_BOTTOM = 'C85 78 77 82 70 86';
const TRAP_BOTTOM_REVERSED = 'C77 82 85 78 92 76';

/// Deltoid against the pectoral, collarbone down to the insertion: (70,86) → (72,116).
const DELT_CHEST = 'C70 96 71 106 72 116';
const DELT_CHEST_REVERSED = 'C71 106 70 96 70 86';

/// Deltoid insertion across the upper arm: (57,128) → (72,116). This is the edge that used to run
/// diagonally up to the collarbone and read as a cut through the arm.
const DELT_ARM = 'C62 125 67 121 72 116';

/// Medial edge of the upper arm, deltoid insertion to elbow: (72,116) → (74,168). It follows the
/// silhouette's arm/torso line so no unfilled strip is left down the inside of the arm.
const ARM_MEDIAL = 'C75 130 76 148 74 168';

/// Lateral arm contour, elbow back up to the shoulder.
const ARM_LATERAL_UPPER_REVERSED = 'C60 164 60 160 60 156 C61 146 59 134 57 128';

/// Medial edge of the forearm: (74,168) → (66,224).
const FOREARM_MEDIAL = 'C75 184 73 200 70 214 C69 219 67 222 66 224';

/// Lower border of the pectoral, ribs to sternum: (72,116) → (100,117). Both halves meet the
/// centre line exactly; the linea alba is drawn by the anatomy lines rather than left as a gap.
const CHEST_BOTTOM = 'C79 123 89 123 100 117';
const CHEST_BOTTOM_REVERSED = 'C89 123 79 123 72 116';

/// Quadriceps against the adductors, hip to just above the knee: (80,202) → (91,294).
const QUAD_ADDUCTOR = 'C84 210 86 224 86 244 C86 264 88 280 91 294';
const QUAD_ADDUCTOR_REVERSED = 'C88 280 86 264 86 244 C86 224 84 210 80 202';

/// Medial contour of the thigh, groin down to the knee: (99,210) → (91,294), walked upward.
const INNER_THIGH_UPWARD = 'C91 280 92 268 93 252 C94 236 96 222 99 210';

/// The knee line both the thigh and the shank meet on.
const KNEE_LEFT = 'L91 302';

/* ────────────────────────────────────────────────
 * Front-view muscle regions.
 *
 * Record order is paint order: later keys draw over earlier ones. The torso is listed before the
 * arms so an arm covers the few units where it hangs over the ribs, rather than the other way
 * round.
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
  L130 86
  ${mirror(TRAP_BOTTOM_REVERSED)}
  L102 76
  L100 78
  L98 76
  L92 76
  ${TRAP_BOTTOM}
  L64 78
  C72 72 82 68 90 66 Z
`;

const SHOULDER_LEFT = `
  M64 78
  C52 86 44 94 45 106
  C46 114 52 122 57 128
  ${DELT_ARM}
  ${DELT_CHEST_REVERSED}
  Z
`;

const CHEST_LEFT = `
  M100 76
  L92 76
  ${TRAP_BOTTOM}
  ${DELT_CHEST}
  ${CHEST_BOTTOM}
  Z
`;

/// Rectus abdominis and obliques. The upper edge is the pectoral's lower border, so the two meet
/// without a seam across the ribs.
const CORE_LEFT = `
  M100 117
  ${CHEST_BOTTOM_REVERSED}
  C74 132 75 146 75 162
  C75 176 76 190 80 202
  L100 208
  Z
`;

const BICEP_LEFT = `
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

const ADDUCTOR_LEFT = `
  M80 202
  ${QUAD_ADDUCTOR}
  ${INNER_THIGH_UPWARD}
  C93 206 86 204 80 202
  Z
`;

const QUAD_LEFT = `
  M80 202
  C74 214 70 228 68 246
  C70 260 73 276 75 288
  C76 294 76 298 76 302
  ${KNEE_LEFT}
  C91 299 91 296 91 294
  ${QUAD_ADDUCTOR_REVERSED}
  Z
`;

/// Tibialis anterior, sharing the knee line with the thigh above it.
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

/// Exported so the path tests can assert that both regions on a seam really do carry the same
/// edge text rather than two hand-typed approximations of it.
export const FRONT_SEAMS = {
  trapBottom: TRAP_BOTTOM,
  deltChest: DELT_CHEST,
  deltArm: DELT_ARM,
  armMedial: ARM_MEDIAL,
  chestBottom: CHEST_BOTTOM,
  quadAdductor: QUAD_ADDUCTOR,
  kneeLeft: KNEE_LEFT
};
