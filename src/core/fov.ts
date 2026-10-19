// Symmetric shadowcasting field of view (after Albert Ford's algorithm, 2021), using exact
// integer fractions for slopes so the result is truly symmetric: if A can see B, B can see A.
// The same rule is used for the player and for monsters.

type Blocks = (x: number, y: number) => boolean;
type Mark = (x: number, y: number) => void;

interface Row {
  depth: number;
  /** start slope = sn / sd, end slope = en / ed (denominators > 0) */
  sn: number;
  sd: number;
  en: number;
  ed: number;
}

/** floor(n/d + 1/2) for d > 0, exact on integers. */
function roundTiesUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}
/** ceil(n/d - 1/2) for d > 0, exact on integers. */
function roundTiesDown(n: number, d: number): number {
  return Math.ceil((2 * n - d) / (2 * d));
}

/**
 * Computes visible tiles from (ox, oy) within `radius` (Euclidean). Calls mark() for every
 * visible tile including the origin. Walls that bound the view are reported visible.
 */
export function computeFov(ox: number, oy: number, radius: number, blocks: Blocks, mark: Mark): void {
  mark(ox, oy);
  const r2 = radius * radius + radius;
  const maxDepth = Math.ceil(radius);
  for (let q = 0; q < 4; q++) {
    const tx = (row: number, col: number): number => (q === 0 ? ox + col : q === 1 ? ox + row : q === 2 ? ox + col : ox - row);
    const ty = (row: number, col: number): number => (q === 0 ? oy - row : q === 1 ? oy + col : q === 2 ? oy + row : oy + col);
    const stack: Row[] = [{ depth: 1, sn: -1, sd: 1, en: 1, ed: 1 }];
    while (stack.length > 0) {
      const row = stack.pop() as Row;
      if (row.depth > maxDepth) continue;
      const d = row.depth;
      const minCol = roundTiesUp(d * row.sn, row.sd);
      const maxCol = roundTiesDown(d * row.en, row.ed);
      let sn = row.sn;
      let sd = row.sd;
      let prevWall: boolean | null = null;
      for (let col = minCol; col <= maxCol; col++) {
        const x = tx(d, col);
        const y = ty(d, col);
        const wall = blocks(x, y);
        const symmetric = col * sd >= d * sn && col * row.ed <= d * row.en;
        if ((wall || symmetric) && d * d + col * col <= r2) mark(x, y);
        if (prevWall === true && !wall) {
          sn = 2 * col - 1;
          sd = 2 * d;
        }
        if (prevWall === false && wall) {
          stack.push({ depth: d + 1, sn, sd, en: 2 * col - 1, ed: 2 * d });
        }
        prevWall = wall;
      }
      if (prevWall === false) stack.push({ depth: d + 1, sn, sd, en: row.en, ed: row.ed });
    }
  }
}

/** Line-of-sight check using the same FOV rule (symmetric). */
export function hasLos(ax: number, ay: number, bx: number, by: number, blocks: Blocks): boolean {
  if (ax === bx && ay === by) return true;
  const dist = Math.max(Math.abs(ax - bx), Math.abs(ay - by)) + 1;
  let seen = false;
  computeFov(ax, ay, dist + 1, blocks, (x, y) => {
    if (x === bx && y === by) seen = true;
  });
  return seen;
}
