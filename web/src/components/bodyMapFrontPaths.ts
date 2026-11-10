/**
 * Front view of the muscle-coverage body map. Coordinate space: 200 × 420, centred at x = 100.
 *
 * A body silhouette lies under the figure and every muscle is drawn on it as the heads you can see
 * (clavicular and sternal chest, front and side delts, serratus beside the obliques, a tapering
 * rectus). Each plate's stroke takes the silhouette's colour, so the thin gaps between plates read
 * as skin and no outline has to agree with its neighbour's. Head, elbows, hands, knees and feet are
 * neutral plates that never fill.
 *
 * Shapes are written for the figure's left side (x < 100) and mirrored for the right, so the two
 * halves cannot drift apart.
 */

export const BODY_MAP_VIEW_BOX = '0 0 200 420';

/**
 * Reflects a left-side path about the figure's centre line. Only absolute commands with plain x/y
 * pairs are used in these files, so mirroring is a negation of each x.
 */
export function mirror(path: string): string {
  return path.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g,
    (_, x: string, y: string) => `${200 - Number(x)} ${y}`);
}

/// Left-side plates joined with their mirror images, one subpath each.
export function pair(...paths: string[]): string {
  return paths.flatMap(path => [path, mirror(path)]).join(' ');
}

/// The whole body's outline, shared by both views and drawn under their plates.
export const SILHOUETTE = pair(
  'M100 7 C90 7 84 16 84 28 C84 40 87 50 91 55 L91 62 C87 68 79 73 68 75 C57 73 47 78 42 89 C38 99 38 112 42 125 C39 140 38 156 39 172 C35 186 31 206 29 228 C25 238 25 252 29 259 C33 264 40 262 42 256 C45 251 47 246 47 242 C47 238 44 232 43 228 C49 216 56 200 58 186 C59 180 58 175 57 170 C61 158 64 142 65 126 C67 142 72 160 75 176 C71 186 66 198 63 214 C60 234 62 264 70 296 C69 304 70 312 72 318 C64 332 61 350 63 366 C65 376 69 384 73 389 C70 396 66 404 67 410 C69 416 93 416 94 409 C94 402 90 395 88 389 C93 378 97 362 96 346 C95 334 92 324 90 318 C93 312 94 304 93 297 C96 286 99 250 100 216 Z'
);

export const HEAD = 'M100 9 C109 9 115 17 115 28 C115 36 113 43 109 49 C106 53 103 55 100 55 C97 55 94 53 91 49 C87 43 85 36 85 28 C85 17 91 9 100 9 Z';

/// Limb plates the two views share.
export const ELBOW = 'M44 173 C48 174 52 174 55 173 C56 176 55 180 53 182 C49 183 46 183 43 181 C43 178 43 175 44 173 Z';
export const HAND = 'M31 230 L42 230 C44 235 46 239 46 243 C46 246 44 247 43 245 C43 250 42 255 40 258 C37 262 33 262 30 258 C27 254 27 246 28 240 C29 236 30 233 31 230 Z';
export const FOREARM_OUTER = 'M40 183 C35 192 32 203 30 214 C29 220 29 224 30 228 L35 228 C36 216 39 205 44 195 C46 190 47 187 47 185 C45 185 42 184 40 183 Z';
export const FOREARM_INNER = 'M49 185 C54 186 58 187 58 190 C57 203 53 214 48 222 C46 225 44 227 42 228 L36 228 C37 218 40 207 44 197 C46 192 48 188 49 185 Z';

const KNEE = 'M75 300 C79 297 85 297 89 300 C90 305 89 311 87 315 C83 317 79 317 77 314 C75 310 74 305 75 300 Z';
const FOOT = 'M73 390 L87 390 C89 396 92 403 93 409 C93 413 88 415 81 415 C74 415 69 413 68 409 C68 402 70 396 73 390 Z';

/// Neutral plates: everything that is body but not a muscle this map credits.
export const FRONT_PARTS = [HEAD, pair(ELBOW, HAND, KNEE, FOOT)].join(' ');

/// Drawn in this order, so a later plate's gap line crosses an earlier one where they overlap.
export const FRONT_REGIONS: Record<string, string> = {
  Neck: pair('M91 51 C92 58 93 66 96 76 L100 77 L100 58 C96 58 93 55 91 51 Z'),
  Traps: pair('M90 61 C87 67 80 72 69 75 C77 78 88 78 95 78 C93 73 91 67 90 61 Z'),
  Triceps: pair('M45 127 C42 138 40 149 40 158 C40 163 41 167 43 170 C43 158 44 143 46 130 Z'),
  Biceps: pair('M62 110 C66 120 67 134 64 148 C62 157 59 164 56 169 C52 168 49 163 48 155 C47 141 48 128 51 119 C54 113 58 109 62 110 Z'),
  Forearms: pair(FOREARM_OUTER, FOREARM_INNER),
  Shoulders: pair(
    // Side delt on the outside of the cap, front delt against the chest.
    'M51 80 C45 83 41 90 40 99 C39 108 41 117 44 125 C47 121 50 117 53 112 C50 102 49 91 51 80 Z',
    'M70 77 C63 75 56 77 53 81 C51 91 52 101 55 110 C59 105 62 100 65 93 C67 87 69 82 70 77 Z'
  ),
  Chest: pair(
    // Clavicular head over the sternal head, whose lower edge rounds up into the armpit.
    'M72 79 C81 78 91 78 99 80 L99 96 C89 95 78 97 67 102 C66 94 68 86 72 79 Z',
    'M67 104 C78 99 89 97 99 98 L99 119 C95 124 87 127 79 125 C72 123 68 118 67 112 C67 109 67 107 67 104 Z'
  ),
  Core: pair(
    // Three fingers of serratus on the ribs, the oblique down the flank, then the rectus.
    'M69 118 C72 119 75 121 77 124 C76 126 75 128 74 129 C72 126 70 122 69 118 Z',
    'M70 127 C73 128 75 130 77 132 C77 134 76 136 75 138 C73 135 71 131 70 127 Z',
    'M71 136 C74 137 76 139 77 141 C77 143 77 145 76 147 C74 144 72 140 71 136 Z',
    'M79 128 C82 128 84 129 86 131 C85 144 85 160 86 176 C87 186 89 194 91 202 C86 200 81 196 76 190 C78 178 79 164 79 152 C79 143 79 135 79 128 Z',
    'M88 128 C92 127 96 124 99 122 L99 142 C95 143 91 143 87 142 C87 137 87 132 88 128 Z',
    'M87 145 C91 144 95 144 99 145 L99 160 C95 161 91 161 87 160 C86 155 86 150 87 145 Z',
    'M87 163 C91 162 95 162 99 163 L99 178 C95 179 91 179 88 178 C87 173 86 168 87 163 Z',
    'M88 181 C92 180 96 180 99 181 L99 209 C96 207 93 202 91 196 C89 191 88 186 88 181 Z'
  ),
  Adductors: pair('M92 205 C95 209 97 213 99 219 C99 235 96 249 91 263 C90 247 89 233 89 219 C89 213 90 209 92 205 Z'),
  Quads: pair(
    // Vastus lateralis, rectus femoris, and the vastus medialis teardrop above the knee.
    'M73 194 C66 208 62 228 63 250 C64 268 67 284 71 295 C74 282 76 264 76 246 C76 228 76 210 77 198 Z',
    'M79 196 C84 202 88 214 89 228 C89 246 87 264 83 280 C82 286 80 291 78 294 C77 278 77 260 78 242 C78 226 78 210 79 196 Z',
    'M90 242 C93 256 95 272 93 286 C91 293 85 297 80 296 C84 282 88 264 90 242 Z'
  ),
  Calves: pair(
    'M72 320 C65 332 62 346 64 360 C65 372 69 381 74 388 L79 388 C78 368 78 346 79 324 C76 323 74 322 72 320 Z',
    'M81 324 C89 326 95 338 95 352 C94 366 91 378 87 388 L81 388 C81 368 81 346 81 324 Z'
  )
};
