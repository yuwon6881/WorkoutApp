/**
 * Anatomically detailed SVG paths for the muscle-coverage body map.
 *
 * Each region is keyed by its display muscle name and contains one or more
 * closed sub-paths (left + right side) aligned flush with the body silhouette.
 *
 * Coordinate space: 200 × 420, figure centred at x = 100.
 * Left/right symmetry mirrors around x = 100 (right_x = 200 − left_x).
 */

export const BODY_MAP_VIEW_BOX = '0 0 200 420';

/* ────────────────────────────────────────────────
 * Background silhouette (head, torso, arms, legs)
 * Provides the unified body contour behind muscles.
 * Non-targeted areas (head, hands, feet/toes) remain
 * visible as neutral base body.
 * ──────────────────────────────────────────────── */
export const BODY_MAP_SILHOUETTE = `
  M100 14
  C109 14 115 21 115 32
  C115 43 111 51 107 56
  C107 60 107 64 107 68
  C114 69 123 72 130 76
  C142 81 150 88 149 98
  C148 106 144 113 140 120
  C139 127 138 138 138 148
  C137 154 137 158 139 162
  C144 172 147 182 146 192
  C145 201 142 209 139 216
  C144 220 152 226 156 234
  C158 238 156 242 152 242
  C148 242 145 238 143 234
  C142 242 140 252 138 258
  C136 261 133 260 132 256
  C130 248 129 238 129 228
  C128 222 129 218 130 216
  C127 208 126 196 126 182
  C126 170 124 158 123 150
  C122 142 122 130 122 122
  C122 132 122 146 122 154
  C121 162 119 168 121 174
  C123 182 127 188 129 194
  C131 202 131 216 130 232
  C128 248 124 266 122 280
  C121 286 121 292 121 296
  C124 306 128 318 128 330
  C128 344 124 360 120 372
  C119 376 119 380 120 384
  C122 392 123 399 122 404
  C121 407 118 408 114 408
  C110 408 108 404 108 396
  L108 382
  C106 368 104 350 104 330
  C104 316 107 304 107 296
  C107 288 107 282 107 278
  C106 266 105 250 104 236
  C103 222 102 212 100 206
  C98 212 97 222 96 236
  C95 250 94 266 93 278
  C93 282 93 288 93 296
  C93 304 96 316 96 330
  C96 350 94 368 92 382
  L92 396
  C92 404 90 408 86 408
  C82 408 79 407 78 404
  C77 399 78 392 80 384
  C81 380 81 376 80 372
  C76 360 72 344 72 330
  C72 318 76 306 79 296
  C79 292 79 286 78 280
  C76 266 72 248 70 232
  C69 216 69 202 71 194
  C73 188 77 182 79 174
  C81 168 79 162 78 154
  C78 146 78 132 78 122
  C78 130 78 142 77 150
  C76 158 74 170 74 182
  C74 196 73 208 70 216
  C71 218 72 222 71 228
  C71 238 70 248 68 256
  C67 260 64 261 62 258
  C60 252 58 242 57 234
  C55 238 52 242 48 242
  C44 242 42 238 44 234
  C48 226 56 220 61 216
  C58 209 55 201 54 192
  C53 182 56 172 61 162
  C63 158 63 154 62 148
  C62 138 61 127 60 120
  C56 113 52 106 51 98
  C50 88 58 81 70 76
  C77 72 86 69 93 68
  C93 64 93 60 93 56
  C89 51 85 43 85 32
  C85 21 91 14 100 14 Z
`;

/* ────────────────────────────────────────────────
 * Decorative internal anatomy lines (non-interactive).
 * Drawn on top of filled muscle regions to add
 * visual detail (ab grid, spine, etc.).
 * ──────────────────────────────────────────────── */

/// Linea alba + tendinous inscriptions showing the ab grid.
export const FRONT_ANATOMY_LINES = `
  M100 116 L100 200
  M82 136 L98 136 M102 136 L118 136
  M80 156 L98 156 M102 156 L120 156
  M79 176 L98 176 M102 176 L121 176
`;

/// Spine line through traps and upper back.
export const BACK_ANATOMY_LINES = `
  M100 70 L100 136
`;

/* ────────────────────────────────────────────────
 * Front-view muscle regions
 * ──────────────────────────────────────────────── */
export const FRONT_REGIONS: Record<string, string> = {

  Neck: `
    M94 56
    C96 58 98 59 100 59
    C102 59 104 58 106 56
    L106 72
    C104 74 102 75 100 75
    C98 75 96 74 94 72 Z
  `,

  /// Left and right upper trapezius — sloping from neck to shoulder joint.
  Traps: `
    M93 68
    C86 69 77 72 70 76
    L72 82
    C79 79 87 76 94 74
    L94 68 Z
    M107 68
    C114 69 123 72 130 76
    L128 82
    C121 79 113 76 106 74
    L106 68 Z
  `,

  /// Left and right anterior deltoids — caps forming outer shoulder contour.
  Shoulders: `
    M70 76
    C58 81 50 88 51 98
    C52 106 56 113 60 120
    L66 112
    C68 104 70 94 74 84
    L72 82 Z
    M130 76
    C142 81 150 88 149 98
    C148 106 144 113 140 120
    L134 112
    C132 104 130 94 126 84
    L128 82 Z
  `,

  /// Left and right pectorals — fan-shaped from sternum.
  Chest: `
    M98 76
    L76 77
    C73 86 71 96 70 106
    C70 114 74 118 82 118
    C88 118 94 116 98 114 Z
    M102 76
    L124 77
    C127 86 129 96 130 106
    C130 114 126 118 118 118
    C112 118 106 116 102 114 Z
  `,

  /// Left and right biceps — front of upper arm.
  Biceps: `
    M60 120
    L66 112
    C70 122 71 134 71 146
    C71 152 70 158 68 162
    L61 162
    C63 158 63 154 62 148
    C62 138 61 127 60 120 Z
    M140 120
    L134 112
    C130 122 129 134 129 146
    C129 152 130 158 132 162
    L139 162
    C137 154 137 158 138 148
    C138 138 139 127 140 120 Z
  `,

  /// Left and right forearms — tapered from elbow to wrist.
  Forearms: `
    M61 162
    L68 162
    C70 174 71 188 70 202
    C70 208 69 213 67 216
    L61 216
    C58 209 55 201 54 192
    C53 182 56 172 61 162 Z
    M139 162
    L132 162
    C130 174 129 188 130 202
    C130 208 131 213 133 216
    L139 216
    C142 209 145 201 146 192
    C147 182 144 172 139 162 Z
  `,

  /// Left and right halves of the midsection (rectus abdominis + obliques).
  Core: `
    M98 116
    L82 120
    C78 126 76 138 75 152
    C75 168 76 182 78 196
    L98 202 Z
    M102 116
    L118 120
    C122 126 124 138 125 152
    C125 168 124 182 122 196
    L102 202 Z
  `,

  /// Left and right inner-thigh adductors.
  Adductors: `
    M92 204
    C94 208 96 211 98 214
    C97 228 96 246 95 262
    C94 272 94 278 93 284
    L88 282
    C88 268 89 250 90 236
    C90 222 91 212 92 204 Z
    M108 204
    C106 208 104 211 102 214
    C103 228 104 246 105 262
    C106 272 106 278 107 284
    L112 282
    C112 268 111 250 110 236
    C110 222 109 212 108 204 Z
  `,

  /// Left and right quadriceps — large front-of-thigh muscles.
  Quads: `
    M78 198
    C73 208 70 220 70 232
    C72 248 76 266 78 280
    C79 286 79 292 79 296
    L87 296
    C87 284 87 268 87 252
    C87 236 86 218 84 202 Z
    M122 198
    C127 208 130 220 130 232
    C128 248 124 266 122 280
    C121 286 121 292 121 296
    L113 296
    C113 284 113 268 113 252
    C113 236 114 218 116 202 Z
  `,

  /// Left and right front calves (tibialis anterior / lower leg).
  Calves: `
    M79 296
    L87 296
    C89 310 91 326 91 342
    C91 356 89 368 87 378
    L80 378
    C76 364 72 348 72 330
    C72 318 76 306 79 296 Z
    M121 296
    L113 296
    C111 310 109 326 109 342
    C109 356 111 368 113 378
    L120 378
    C124 364 128 348 128 330
    C128 318 124 306 121 296 Z
  `
};

/* ────────────────────────────────────────────────
 * Back-view muscle regions
 * ──────────────────────────────────────────────── */
export const BACK_REGIONS: Record<string, string> = {

  Neck: `
    M94 56
    C96 58 98 59 100 59
    C102 59 104 58 106 56
    L106 70
    C104 72 102 73 100 73
    C98 73 96 72 94 70 Z
  `,

  /// Upper back kite shape — spreads from neck to acromions, tapers to mid-spine.
  Traps: `
    M100 58
    L106 70
    C114 71 123 74 130 76
    L122 96
    L100 136
    L78 96
    L70 76
    C77 74 86 71 94 70 Z
  `,

  /// Left and right posterior deltoids — caps behind the shoulder joint.
  Shoulders: `
    M70 76
    C58 81 50 88 51 98
    C52 106 56 113 60 120
    L66 112
    C68 104 72 96 78 96 Z
    M130 76
    C142 81 150 88 149 98
    C148 106 144 113 140 120
    L134 112
    C132 104 128 96 122 96 Z
  `,

  /// Left and right lats with lower back — wide V-sweep from mid-back to hips.
  Back: `
    M78 98
    L100 136
    L98 196
    C90 196 82 190 76 182
    C74 168 74 154 75 138
    C76 124 77 112 78 98 Z
    M122 98
    L100 136
    L102 196
    C110 196 118 190 124 182
    C126 168 126 154 125 138
    C124 124 123 112 122 98 Z
  `,

  /// Left and right triceps — back of upper arm.
  Triceps: `
    M60 120
    L66 112
    C70 122 71 134 71 146
    C71 152 70 158 68 162
    L61 162
    C63 158 63 154 62 148
    C62 138 61 127 60 120 Z
    M140 120
    L134 112
    C130 122 129 134 129 146
    C129 152 130 158 132 162
    L139 162
    C137 154 137 158 138 148
    C138 138 139 127 140 120 Z
  `,

  /// Left and right forearms — back view.
  Forearms: `
    M61 162
    L68 162
    C70 174 71 188 70 202
    C70 208 69 213 67 216
    L61 216
    C58 209 55 201 54 192
    C53 182 56 172 61 162 Z
    M139 162
    L132 162
    C130 174 129 188 130 202
    C130 208 131 213 133 216
    L139 216
    C142 209 145 201 146 192
    C147 182 144 172 139 162 Z
  `,

  /// Left and right gluteals.
  Glutes: `
    M98 196
    L78 196
    C74 204 72 216 72 228
    C74 234 80 240 88 242
    C94 242 97 240 98 236 Z
    M102 196
    L122 196
    C126 204 128 216 128 228
    C126 234 120 240 112 242
    C106 242 103 240 102 236 Z
  `,

  /// Left and right hamstrings — back of the thigh.
  Hamstrings: `
    M72 238
    C78 242 86 242 94 238
    C95 252 94 268 92 284
    C90 290 86 294 82 294
    C78 292 76 284 74 272
    C72 258 72 248 72 238 Z
    M128 238
    C122 242 114 242 106 238
    C105 252 106 268 108 284
    C110 290 114 294 118 294
    C122 292 124 284 126 272
    C128 258 128 248 128 238 Z
  `,

  /// Left and right gastrocnemius — back of the lower leg.
  Calves: `
    M79 296
    L87 296
    C89 310 91 326 91 342
    C91 356 89 368 87 378
    L80 378
    C76 364 72 348 72 330
    C72 318 76 306 79 296 Z
    M121 296
    L113 296
    C111 310 109 326 109 342
    C109 356 111 368 113 378
    L120 378
    C124 364 128 348 128 330
    C128 318 124 306 121 296 Z
  `
};
