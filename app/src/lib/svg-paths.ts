// SVG path utilities.

// Build an SVG path for a polygon whose corners are rounded with circular arcs
// tangent to both adjacent edges. The `radius` is the arc radius (i.e., the
// visual roundness). Tangent points are placed at offset `radius / tan(α/2)`
// from each vertex along its adjacent edges, where α is the interior angle.
// At sharp corners this offset can exceed half the edge length; it's clamped
// to half the shorter edge and the effective arc radius is reduced accordingly.
export function roundedPolygonPath(
  points: Array<[number, number]>,
  radius: number
): string {
  const n = points.length;
  if (n < 3 || radius <= 0) {
    return (
      points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") +
      " Z"
    );
  }

  const EPS = 1e-6;
  const entries: Array<[number, number]> = [];
  const exits: Array<[number, number]> = [];
  const radii: number[] = [];
  const sweeps: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    // Vectors from curr to its neighbours
    const v1x = prev[0] - curr[0];
    const v1y = prev[1] - curr[1];
    const v1Len = Math.hypot(v1x, v1y);

    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];
    const v2Len = Math.hypot(v2x, v2y);

    if (v1Len < EPS || v2Len < EPS) {
      entries.push([curr[0], curr[1]]);
      exits.push([curr[0], curr[1]]);
      sweeps.push(0);
      radii.push(0);
      continue;
    }

    const u1x = v1x / v1Len;
    const u1y = v1y / v1Len;
    const u2x = v2x / v2Len;
    const u2y = v2y / v2Len;

    // Interior angle α between the two edges (between vectors curr→prev and curr→next)
    const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
    const alpha = Math.acos(dot);

    if (alpha < EPS || alpha > Math.PI - EPS) {
      // Collinear / degenerate — no rounding
      entries.push([curr[0], curr[1]]);
      exits.push([curr[0], curr[1]]);
      sweeps.push(0);
      radii.push(0);
      continue;
    }

    // For arc of radius R tangent to both edges, tangent points sit at
    // offset = R / tan(α/2) from the corner along each edge.
    const tanHalf = Math.tan(alpha / 2);
    const requestedOffset = radius / tanHalf;
    const maxOffset = Math.min(v1Len, v2Len) / 2;
    const offset = Math.min(requestedOffset, maxOffset);
    // If clamped, the effective arc radius is reduced (still tangent).
    const r = offset * tanHalf;

    entries.push([curr[0] + u1x * offset, curr[1] + u1y * offset]);
    exits.push([curr[0] + u2x * offset, curr[1] + u2y * offset]);

    // Sweep direction: cross of incoming-travel × outgoing-travel.
    // incoming travel = curr - prev = -v1, outgoing = next - curr = v2.
    // cross = (-v1) × v2 = -(v1x*v2y - v1y*v2x). In screen y-down,
    // a clockwise turn has positive cross → SVG sweep=1.
    const cross = -(v1x * v2y - v1y * v2x);
    sweeps.push(cross > 0 ? 1 : 0);
    radii.push(r);
  }

  let path = `M${entries[0][0].toFixed(3)},${entries[0][1].toFixed(3)}`;
  for (let i = 0; i < n; i++) {
    if (radii[i] > EPS) {
      path += ` A${radii[i].toFixed(3)},${radii[i].toFixed(3)} 0 0 ${
        sweeps[i]
      } ${exits[i][0].toFixed(3)},${exits[i][1].toFixed(3)}`;
    }
    const nx = entries[(i + 1) % n];
    path += ` L${nx[0].toFixed(3)},${nx[1].toFixed(3)}`;
  }
  path += " Z";
  return path;
}
