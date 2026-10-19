// Dijkstra maps and pathfinding on an 8-connected grid (Chebyshev moves, all cost >= 1).

export const UNREACHABLE = 1e9;

/** Min-heap keyed by numeric priority, storing tile indices. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.vals.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((k[p] as number) <= key) break;
      k[i] = k[p] as number;
      v[i] = v[p] as number;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0] as number;
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    if (k.length > 0) {
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let mk = lastK;
        if (l < n && (k[l] as number) < mk) {
          m = l;
          mk = k[l] as number;
        }
        if (r < n && (k[r] as number) < mk) {
          m = r;
          mk = k[r] as number;
        }
        if (m === i) break;
        k[i] = k[m] as number;
        v[i] = v[m] as number;
        i = m;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
  topKey(): number {
    return this.keys[0] as number;
  }
}

export const NX = [0, 1, 1, 1, 0, -1, -1, -1];
export const NY = [-1, -1, 0, 1, 1, 1, 0, -1];

/**
 * Builds a distance map from the given goal tiles.
 * cost(i) returns the cost of ENTERING tile i (>= 1), or Infinity if impassable.
 * Goals are always seeded at distance 0 even if they are impassable (e.g. the player's tile).
 */
export function dijkstraMap(
  w: number,
  h: number,
  goals: readonly number[],
  cost: (i: number) => number,
  maxDist = UNREACHABLE,
): Float64Array {
  const dist = new Float64Array(w * h).fill(UNREACHABLE);
  const heap = new Heap();
  for (const g of goals) {
    if (g < 0 || g >= w * h) continue;
    dist[g] = 0;
    heap.push(0, g);
  }
  while (heap.size > 0) {
    const d0 = heap.topKey();
    const i = heap.pop();
    if (d0 > (dist[i] as number)) continue;
    if (d0 >= maxDist) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const c = cost(j);
      if (!(c < Infinity)) continue;
      const nd = d0 + c;
      if (nd < (dist[j] as number)) {
        dist[j] = nd;
        heap.push(nd, j);
      }
    }
  }
  return dist;
}

/**
 * Returns the neighbour of `from` with the lowest distance value (strictly lower than the
 * current one), or -1 if none. `canEnter` filters candidate tiles (e.g. occupied tiles).
 * Ties are broken deterministically by direction order starting at `tieOffset`.
 */
export function stepDownhill(
  w: number,
  h: number,
  dist: Float64Array,
  from: number,
  canEnter: (i: number) => boolean,
  tieOffset = 0,
): number {
  const x = from % w;
  const y = (from - x) / w;
  let best = -1;
  let bestD = dist[from] as number;
  for (let kk = 0; kk < 8; kk++) {
    const k = (kk + tieOffset) & 7;
    const nx = x + (NX[k] as number);
    const ny = y + (NY[k] as number);
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    const j = ny * w + nx;
    const d = dist[j] as number;
    if (d < bestD && canEnter(j)) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

/** Full path from `from` to the nearest goal of the map (excluding `from`), or [] if none. */
export function pathFromMap(w: number, h: number, dist: Float64Array, from: number, maxLen = 500): number[] {
  const path: number[] = [];
  let cur = from;
  for (let n = 0; n < maxLen; n++) {
    if ((dist[cur] as number) === 0) break;
    const next = stepDownhill(w, h, dist, cur, () => true);
    if (next < 0) return [];
    path.push(next);
    cur = next;
  }
  return path;
}

/** Plain BFS reachability (4- or 8-connected) from start over passable tiles. */
export function floodFill(w: number, h: number, start: number, passable: (i: number) => boolean, eight = true): Uint8Array {
  const seen = new Uint8Array(w * h);
  if (start < 0 || !passable(start)) return seen;
  const q: number[] = [start];
  seen[start] = 1;
  let head = 0;
  while (head < q.length) {
    const i = q[head++] as number;
    const x = i % w;
    const y = (i - x) / w;
    for (let k = 0; k < 8; k++) {
      if (!eight && k % 2 === 1) continue;
      const nx = x + (NX[k] as number);
      const ny = y + (NY[k] as number);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (seen[j] || !passable(j)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}
