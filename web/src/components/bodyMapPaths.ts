/**
 * Anatomically detailed SVG paths for the muscle-coverage body map.
 *
 * Each region is keyed by its display muscle name and contains one or more
 * closed sub-paths (left + right side) drawn inside the silhouette outline.
 *
 * Coordinate space: 200 × 420, figure centred at x = 100.
 * Left/right symmetry mirrors around x = 100 (right_x = 200 − left_x).
 */

export const BODY_MAP_VIEW_BOX = '0 0 200 420';

/* ────────────────────────────────────────────────
 * Background silhouette (head, torso, arms, legs)
 * Provides the overall body contour behind muscles.
 * ──────────────────────────────────────────────── */
export const BODY_MAP_SILHOUETTE = `
  M100 16
  C108 16 114 22 114 32
  C114 42 110 50 107 55
  C107 60 108 65 109 70
  C116 71 126 74 135 79
  C144 84 150 91 149 100
  C148 108 144 116 141 123
  C139 129 139 141 138 150
  C137 154 137 158 139 162
  C143 170 146 180 145 190
  C144 198 140 206 137 210
  C135 214 134 222 133 230
  C132 236 128 238 126 235
  C124 231 125 224 126 216
  L127 210
  C128 202 129 188 128 176
  C127 166 124 156 123 150
  C122 144 122 134 122 124
  L123 115
  C123 124 123 138 123 148
  C122 158 120 166 122 174
  C123 182 127 188 129 194
  C131 202 131 216 130 232
  C128 248 124 264 121 278
  C120 284 120 290 120 294
  C123 304 126 316 126 328
  C126 342 121 358 118 370
  C117 376 118 386 119 394
  C120 400 116 403 111 403
  C107 403 106 398 106 390
  L106 374
  C105 362 103 346 103 330
  C103 318 106 306 106 296
  C106 288 107 282 107 278
  C106 266 105 250 104 236
  C103 222 102 212 100 206
  C98 212 97 222 96 236
  C95 250 94 266 93 278
  C93 282 94 288 94 296
  C94 306 97 318 97 330
  C97 346 95 362 94 374
  L94 390
  C94 398 93 403 89 403
  C84 403 80 400 81 394
  C82 386 83 376 82 370
  C79 358 74 342 74 328
  C74 316 77 304 80 294
  C80 290 80 284 79 278
  C76 264 72 248 70 232
  C69 216 69 202 71 194
  C73 188 77 182 78 174
  C80 166 78 158 77 148
  C77 138 77 124 77 115
  L78 124
  C78 134 78 144 77 150
  C76 156 73 166 72 176
  C71 188 72 202 73 210
  L74 216
  C75 224 76 231 74 235
  C72 238 68 236 67 230
  C66 222 65 214 63 210
  C60 206 56 198 55 190
  C54 180 57 170 61 162
  C63 158 63 154 62 150
  C61 141 61 129 59 123
  C56 116 52 108 51 100
  C50 91 56 84 65 79
  C74 74 84 71 91 70
  C92 65 93 60 93 55
  C90 50 86 42 86 32
  C86 22 92 16 100 16 Z
`;

/* ────────────────────────────────────────────────
 * Decorative internal anatomy lines (non-interactive).
 * Drawn on top of filled muscle regions to add
 * visual detail (ab grid, spine, etc.).
 * ──────────────────────────────────────────────── */

/// Linea alba + tendinous inscriptions showing the ab grid.
export const FRONT_ANATOMY_LINES = `
  M100 122 L100 200
  M83 136 L98 136 M102 136 L117 136
  M82 152 L98 152 M102 152 L118 152
  M81 168 L98 168 M102 168 L119 168
  M80 184 L98 184 M102 184 L120 184
`;

/// Spine line through traps and upper back.
export const BACK_ANATOMY_LINES = `
  M100 72 L100 118
`;

/* ────────────────────────────────────────────────
 * Front-view muscle regions
 * ──────────────────────────────────────────────── */
export const FRONT_REGIONS: Record<string, string> = {

  Neck: `
    M93 57
    C95 59 98 60 100 60
    C102 60 105 59 107 57
    L108 72
    C104 74 102 75 100 75
    C98 75 96 74 92 72 Z
  `,

  /// Left and right anterior deltoids — rounded shoulder caps.
  Shoulders: `
    M92 69
    C84 71 76 75 68 80
    C62 85 59 91 59 97
    C59 101 61 104 65 105
    L72 96
    C75 88 81 80 90 74 Z
    M108 69
    C116 71 124 75 132 80
    C138 85 141 91 141 97
    C141 101 139 104 135 105
    L128 96
    C125 88 119 80 110 74 Z
  `,

  /// Left and right pectorals — fan-shaped from sternum.
  Chest: `
    M98 76
    L84 73
    C78 76 73 82 71 89
    C69 96 69 101 71 106
    L80 114
    C86 117 92 119 98 120 Z
    M102 76
    L116 73
    C122 76 127 82 129 89
    C131 96 131 101 129 106
    L120 114
    C114 117 108 119 102 120 Z
  `,

  /// Left and right biceps — elongated ovals on the front of the upper arm.
  Biceps: `
    M64 107
    C66 105 69 105 71 107
    C73 117 74 129 73 141
    C73 147 71 151 69 153
    L63 153
    C61 149 60 141 60 129
    C60 119 62 113 64 107 Z
    M136 107
    C134 105 131 105 129 107
    C127 117 126 129 127 141
    C127 147 129 151 131 153
    L137 153
    C139 149 140 141 140 129
    C140 119 138 113 136 107 Z
  `,

  /// Left and right forearms — tapered from elbow to wrist.
  Forearms: `
    M62 155
    L70 155
    C71 169 71 185 70 201
    C70 206 68 210 66 212
    C64 212 62 210 60 208
    C57 199 56 187 56 177
    C56 169 58 163 62 155 Z
    M138 155
    L130 155
    C129 169 129 185 130 201
    C130 206 132 210 134 212
    C136 212 138 210 140 208
    C143 199 144 187 144 177
    C144 169 142 163 138 155 Z
  `,

  /// Left and right halves of the midsection (rectus abdominis + obliques).
  Core: `
    M98 120
    L80 114
    C76 124 74 140 74 158
    C74 176 76 192 80 200
    L98 202 Z
    M102 120
    L120 114
    C124 124 126 140 126 158
    C126 176 124 192 120 200
    L102 202 Z
  `,

  /// Left and right inner-thigh adductors.
  Adductors: `
    M92 204
    C94 208 96 211 98 213
    C97 228 96 246 95 262
    C94 272 94 278 93 284
    L88 282
    C88 268 89 250 90 236
    C90 222 91 212 92 204 Z
    M108 204
    C106 208 104 211 102 213
    C103 228 104 246 105 262
    C106 272 106 278 107 284
    L112 282
    C112 268 111 250 110 236
    C110 222 109 212 108 204 Z
  `,

  /// Left and right quadriceps — large front-of-thigh muscles.
  Quads: `
    M80 202
    C78 214 76 234 76 254
    C76 268 76 280 78 288
    C80 291 84 293 88 293
    L88 284
    C88 268 88 250 88 236
    C88 222 86 212 84 204 Z
    M120 202
    C122 214 124 234 124 254
    C124 268 124 280 122 288
    C120 291 116 293 112 293
    L112 284
    C112 268 112 250 112 236
    C112 222 114 212 116 204 Z
  `,

  /// Left and right front calves (tibialis anterior / lower leg).
  Calves: `
    M76 296
    C80 294 84 294 88 296
    C91 310 93 326 93 342
    C93 356 91 366 89 374
    L78 374
    C76 366 73 352 73 338
    C73 322 75 308 76 296 Z
    M124 296
    C120 294 116 294 112 296
    C109 310 107 326 107 342
    C107 356 109 366 111 374
    L122 374
    C124 366 127 352 127 338
    C127 322 125 308 124 296 Z
  `
};

/* ────────────────────────────────────────────────
 * Back-view muscle regions
 * ──────────────────────────────────────────────── */
export const BACK_REGIONS: Record<string, string> = {

  Neck: `
    M93 55
    C95 57 98 58 100 58
    C102 58 105 57 107 55
    L108 70
    C104 72 102 73 100 73
    C98 73 96 72 92 70 Z
  `,

  /// Upper back kite shape — spreads from neck to acromions, tapers to mid-spine.
  Traps: `
    M92 70
    L108 70
    L130 80
    L118 98
    L100 118
    L82 98
    L70 80 Z
  `,

  /// Left and right posterior deltoids — compact caps behind the shoulder joint.
  Shoulders: `
    M70 80
    C64 84 59 90 58 97
    C58 101 60 105 64 107
    L72 98
    L82 98 Z
    M130 80
    C136 84 141 90 142 97
    C142 101 140 105 136 107
    L128 98
    L118 98 Z
  `,

  /// Left and right lats with lower back — wide V-sweep from mid-back to hips.
  Back: `
    M82 100
    L100 118
    L98 196
    C90 196 82 190 76 184
    C74 170 74 154 76 138
    C78 124 80 112 82 100 Z
    M118 100
    L100 118
    L102 196
    C110 196 118 190 124 184
    C126 170 126 154 124 138
    C122 124 120 112 118 100 Z
  `,

  /// Left and right triceps — back-of-upper-arm.
  Triceps: `
    M63 109
    C66 107 68 107 70 109
    C72 121 72 137 71 149
    C71 153 69 156 67 157
    L62 157
    C60 151 59 141 59 129
    C59 119 61 113 63 109 Z
    M137 109
    C134 107 132 107 130 109
    C128 121 128 137 129 149
    C129 153 131 156 133 157
    L138 157
    C140 151 141 141 141 129
    C141 119 139 113 137 109 Z
  `,

  /// Left and right forearms — same as front view.
  Forearms: `
    M62 159
    L70 159
    C71 171 71 187 70 201
    C70 206 68 210 66 212
    C64 212 62 210 60 208
    C57 199 56 187 56 177
    C56 169 58 165 62 159 Z
    M138 159
    L130 159
    C129 171 129 187 130 201
    C130 206 132 210 134 212
    C136 212 138 210 140 208
    C143 199 144 187 144 177
    C144 169 142 165 138 159 Z
  `,

  /// Left and right gluteals.
  Glutes: `
    M98 196
    L78 196
    C74 204 72 216 73 228
    C75 234 80 240 88 242
    C94 242 97 240 98 236 Z
    M102 196
    L122 196
    C126 204 128 216 127 228
    C125 234 120 240 112 242
    C106 242 103 240 102 236 Z
  `,

  /// Left and right hamstrings — back of the thigh.
  Hamstrings: `
    M76 244
    C82 246 90 244 96 238
    C96 254 94 270 92 286
    C90 291 86 294 82 294
    C78 292 76 284 74 272
    C74 258 74 250 76 244 Z
    M124 244
    C118 246 110 244 104 238
    C104 254 106 270 108 286
    C110 291 114 294 118 294
    C122 292 124 284 126 272
    C126 258 126 250 124 244 Z
  `,

  /// Left and right gastrocnemius — back of the lower leg.
  Calves: `
    M76 296
    C80 294 84 294 88 296
    C91 310 93 326 93 342
    C93 356 91 366 89 374
    L78 374
    C76 366 73 352 73 338
    C73 322 75 308 76 296 Z
    M124 296
    C120 294 116 294 112 296
    C109 310 107 326 107 342
    C107 356 109 366 111 374
    L122 374
    C124 366 127 352 127 338
    C127 322 125 308 124 296 Z
  `
};
