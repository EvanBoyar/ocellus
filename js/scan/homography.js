// Plane-to-plane perspective transforms from four point pairs.

// Returns the 3x3 homography H (row-major, 9 numbers) mapping each
// src point onto its dst point, or null for degenerate input.
export function computeHomography(src, dst) {
  // Standard DLT: solve the 8x8 system for h11..h32 with h33 = 1.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const det = a * A + d * B + g * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    A / det, B / det, C / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ];
}

// Local scale (px per source unit) of H around a point. Used to size
// sampling windows in image space.
export function localScale(H, x, y) {
  const p = applyH(H, x, y);
  const px = applyH(H, x + 1, y);
  const py = applyH(H, x, y + 1);
  const sx = Math.hypot(px.x - p.x, px.y - p.y);
  const sy = Math.hypot(py.x - p.x, py.y - p.y);
  return (sx + sy) / 2;
}

// Gaussian elimination with partial pivoting.
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[best][col])) best = r;
    }
    if (Math.abs(M[best][col]) < 1e-12) return null;
    [M[col], M[best]] = [M[best], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
