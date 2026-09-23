/**
 * Front view of the muscle-coverage body map. Coordinate space: 200 × 420, centred at x = 100.
 *
 * Every muscle is its own plate and the figure is nothing but plates: the thin gaps between them
 * are drawn by each plate's stroke in the card colour, so no outline has to agree with its
 * neighbour's. Head, elbows, hands, knees and feet are neutral plates that never fill. The arms
 * hang a little away from the torso with open hands, so a trained arm reads as a limb rather than
 * as part of the ribcage.
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

export const HEAD = 'M100 8 C111 8 118 18 118 31 C118 45 110 58 100 58 C90 58 82 45 82 31 C82 18 89 8 100 8 Z';

/// Limb plates the two views share: the same arm hangs in the same place from either side.
export const ELBOW = 'M42 170 C47 172 52 173 56 172 C57 176 56 180 54 182 C49 183 44 182 40 180 C40 176 41 173 42 170 Z';
export const HAND = 'M30 230 C27 235 26 241 26 247 C26 253 28 258 32 260 C35 261 38 260 40 257 C42 254 42 249 42 245 C44 243 46 240 46 237 C46 235 44 234 43 236 L42 237 L42 230 Z';
export const FOREARM_OUTER = 'M40 181 C35 191 32 202 30 213 C29 219 29 224 30 228 L35 228 C36 216 39 204 44 194 C46 189 47 185 47 183 C45 183 42 182 40 181 Z';
export const FOREARM_INNER = 'M49 183 C54 184 57 186 57 189 C56 202 52 214 47 222 C45 225 43 227 42 228 L36 228 C37 218 40 206 44 196 C46 191 48 186 49 183 Z';

const KNEE = 'M71 298 C77 294 86 294 92 297 C93 305 91 313 88 319 C82 321 76 320 72 316 C70 310 70 303 71 298 Z';
const FOOT = 'M72 388 C69 394 67 402 68 408 C69 413 74 415 81 415 C87 415 92 413 93 409 C93 403 90 396 87 388 Z';

/// Neutral plates: everything that is body but not a muscle this map credits.
export const FRONT_PARTS = [HEAD, pair(ELBOW, HAND, KNEE, FOOT)].join(' ');

/// Drawn in this order, so a later plate's gap line crosses an earlier one where they overlap.
export const FRONT_REGIONS: Record<string, string> = {
  Neck: pair('M90 50 C91 58 93 66 95 76 L100 77 L100 58 C96 58 92 56 90 50 Z'),
  Traps: pair('M90 60 C86 67 78 72 66 76 C76 79 88 78 96 78 C93 72 91 66 90 60 Z'),
  Biceps: pair('M62 108 C66 118 66 134 63 148 C61 157 58 164 55 169 C51 168 48 163 47 155 C46 141 47 127 50 117 C53 111 58 107 62 108 Z'),
  Triceps: pair('M45 124 C42 136 40 148 40 158 C40 163 41 167 43 170 C43 158 43 142 45 124 Z'),
  Forearms: pair(FOREARM_OUTER, FOREARM_INNER),
  Shoulders: pair('M66 76 C55 75 46 81 43 94 C41 104 42 114 45 124 C50 118 55 112 59 106 C62 98 64 90 65 83 C66 80 66 78 66 76 Z'),
  Chest: pair('M72 79 C81 78 91 78 99 80 L99 118 C94 124 85 126 77 123 C71 121 67 116 66 110 C65 99 67 89 72 79 Z'),
  Core: pair(
    // Serratus under the armpit, the oblique down the flank, then four rows of the rectus.
    'M70 118 C73 120 75 122 76 125 C75 129 74 133 72 135 C71 129 70 124 70 118 Z',
    'M76 126 C80 126 83 127 85 129 C84 142 84 158 85 176 C86 186 88 194 90 202 C85 200 80 196 75 190 C77 178 78 164 78 152 C77 142 76 134 76 126 Z',
    'M88 127 C92 125 96 125 99 126 L99 142 C95 143 91 143 87 142 C87 136 87 131 88 127 Z',
    'M87 145 C91 144 95 144 99 145 L99 160 C95 161 91 161 87 160 C86 155 86 150 87 145 Z',
    'M87 163 C91 162 95 162 99 163 L99 178 C95 179 91 179 88 178 C87 173 86 168 87 163 Z',
    'M88 181 C92 180 96 180 99 181 L99 208 C96 206 93 201 91 195 C89 190 88 185 88 181 Z'
  ),
  Adductors: pair('M91 204 C94 208 97 212 99 218 C98 234 95 248 90 262 C89 246 88 232 88 218 C88 212 89 208 91 204 Z'),
  Quads: pair(
    'M74 192 C67 208 64 228 64 248 C64 268 67 284 72 296 C75 280 76 262 76 244 C76 226 77 208 78 196 Z',
    'M79 194 C84 200 88 210 88 224 C88 244 86 262 82 280 C81 286 80 290 78 293 C77 276 77 258 78 240 C78 224 78 208 79 194 Z',
    'M89 240 C92 254 94 270 92 286 C90 293 84 296 79 295 C83 282 87 262 89 240 Z'
  ),
  Calves: pair(
    'M71 320 C64 332 62 346 63 360 C64 372 68 380 73 386 L79 386 C79 368 79 348 79 324 C76 323 73 322 71 320 Z',
    'M81 324 C89 326 95 338 95 352 C95 366 91 378 86 386 L81 386 C81 368 81 348 81 324 Z'
  )
};
