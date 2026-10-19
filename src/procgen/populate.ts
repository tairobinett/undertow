// Population: exits and route omens, vaults, shrines, springs, merchants, loot placed where
// the risk is, and encounters drawn from zone tables with a threat budget.

import { CONSUMABLES } from '../content/consumables.ts';
import { MONSTERS } from '../content/monsters.ts';
import { RELICS } from '../content/relics.ts';
import { WEAPONS } from '../content/weapons.ts';
import { THREAT_BUDGET, zoneForFloor } from '../content/zones.ts';
import { VARIANTS } from '../content/variants.ts';
import type { EncounterDef, Where, ZoneDef } from '../content/zones.ts';
import { chance, int, range, sample, weighted } from '../core/rng.ts';
import type { RngState } from '../core/rng.ts';
import { UNREACHABLE } from '../core/dijkstra.ts';
import { isWater } from '../core/floor.ts';
import { spawnMonster } from '../core/resolve.ts';
import type { FloorState, GameState, ItemInst } from '../core/types.ts';
import type { P } from './carve.ts';
import type { Regions } from './analyze.ts';
import { walkable } from './analyze.ts';

interface Ctx {
  state: GameState;
  f: FloorState;
  rng: RngState;
  reg: Regions;
  entry: P;
  zone: ZoneDef;
  index: number;
  mods: string[];
  /** Tiles already used by items/features. */
  used: Set<number>;
}

function xyOf(f: FloorState, i: number): P {
  return { x: i % f.w, y: Math.floor(i / f.w) };
}

function farFromEntry(c: Ctx, i: number, d: number): boolean {
  const p = xyOf(c.f, i);
  return Math.hypot(p.x - c.entry.x, p.y - c.entry.y) >= d;
}

function freeTile(c: Ctx, i: number): boolean {
  return !c.used.has(i) && (c.f.occ[i] as number) === 0 && walkable(c.f, i);
}

function pickFrom(c: Ctx, list: number[], pred: (i: number) => boolean = () => true): number | undefined {
  const cands = list.filter((i) => freeTile(c, i) && pred(i));
  if (cands.length === 0) return undefined;
  return cands[int(c.rng, cands.length)];
}

function placeItem(c: Ctx, i: number, item: ItemInst, extra: { vault?: number; price?: number } = {}): void {
  const p = xyOf(c.f, i);
  c.used.add(i);
  c.f.items.push({ id: c.state.nextId++, x: p.x, y: p.y, item, ...extra });
}

function nearbyFree(c: Ctx, i: number, n: number): number[] {
  const p = xyOf(c.f, i);
  const out: number[] = [];
  for (let r = 0; r <= 4 && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) {
      for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 1 || y < 1 || x >= c.f.w - 1 || y >= c.f.h - 1) continue;
        const j = y * c.f.w + x;
        if (freeTile(c, j) && !isWater(c.f, j) && !out.includes(j)) out.push(j);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exits and omens

function omenFor(nextIndex: number, rift: boolean, variant?: string): string {
  if (nextIndex >= 9) return 'Above: the Surface. Wind, rain — and the lighthouse.';
  const z = zoneForFloor(nextIndex);
  const base = `Above: ${z.name}.`;
  const boss = nextIndex === 5 ? ' The Drowned Abbot waits there.' : '';
  const v = variant ? ` ${VARIANTS[variant]?.name}: ${VARIANTS[variant]?.desc}` : '';
  return rift ? `${base}${boss}${v} The Rift: fiercer foes, but a relic vault is certain.` : `${base}${boss}${v}`;
}

function pickVariant(c: Ctx, nextIndex: number, exclude?: string): string | undefined {
  if (nextIndex >= 9 || nextIndex === 5) return undefined;
  if (!chance(c.rng, 0.55)) return undefined;
  const zone = zoneForFloor(nextIndex).id;
  const opts = Object.values(VARIANTS).filter((v) => v.zones.includes(zone) && v.key !== exclude).map((v) => v.key);
  if (opts.length === 0) return undefined;
  return opts[int(c.rng, opts.length)];
}

function placeExits(c: Ctx, exit: P): void {
  const { f } = c;
  if (c.index >= 9) return;
  const sv = pickVariant(c, c.index + 1);
  f.features.push({ id: c.state.nextId++, kind: 'exit', x: exit.x, y: exit.y, route: 'stair', nextMods: sv ? [sv] : [], omen: omenFor(c.index + 1, false, sv) });
  c.used.add(exit.y * f.w + exit.x);
  const canRift = c.index < 8 && c.index !== 4 && c.index !== 5;
  if (canRift && chance(c.rng, 0.65)) {
    const cands = c.reg.high.filter((i) => {
      const p = xyOf(f, i);
      return Math.hypot(p.x - exit.x, p.y - exit.y) >= 12 && farFromEntry(c, i, 16) && !isWater(f, i);
    });
    const i = pickFrom(c, cands);
    if (i !== undefined) {
      const p = xyOf(f, i);
      const rv = pickVariant(c, c.index + 1, sv);
      f.features.push({ id: c.state.nextId++, kind: 'exit', x: p.x, y: p.y, route: 'rift', nextMods: rv ? ['rift', rv] : ['rift'], omen: omenFor(c.index + 1, true, rv) });
      c.used.add(i);
    }
  }
}

// ---------------------------------------------------------------------------
// Vaults, shrines, springs, merchants

/** A relic vault: three relics around an altar, far from the entry. `certain` never gives up. */
function placeVault(c: Ctx, certain = false): void {
  const { f } = c;
  const place = (site: number): boolean => {
    const spots = nearbyFree(c, site, 3);
    if (spots.length < 3) return false;
    const owned = new Set(c.state.build.relics);
    const pool = Object.keys(RELICS).filter((k) => !owned.has(k));
    const picks = sample(c.rng, pool, 3);
    const group = c.state.nextId++;
    picks.forEach((key, k) => placeItem(c, spots[k] as number, { kind: 'relic', def: key, count: 1 }, { vault: group }));
    f.features.push({ id: c.state.nextId++, kind: 'altar', x: xyOf(f, site).x, y: xyOf(f, site).y });
    return true;
  };
  const cands = c.reg.deadEnds.filter((i) => farFromEntry(c, i, 12) && !isWater(f, i));
  // An ordinary vault hides in the farthest dead end; the Rift's promised one sits in the
  // dead end nearest the way through, so the promise is one the player can keep.
  const farther = (a: number, b: number): boolean => (c.reg.distMain[a] as number) > (c.reg.distMain[b] as number);
  let site = cands.length ? cands.reduce((best, i) => (certain ? farther(best, i) : farther(i, best)) ? i : best, cands[0] as number) : undefined;
  if (site === undefined || !freeTile(c, site)) site = pickFrom(c, c.reg.land, (i) => farFromEntry(c, i, 12));
  if (site !== undefined && place(site)) return;
  if (!certain) return;
  // The Rift promises a vault: settle for any dry spot with room, nearer the entry if need be.
  for (const d of [8, 4, 0]) {
    const alt = pickFrom(c, c.reg.land, (i) => farFromEntry(c, i, d) && !isWater(f, i) && nearbyFree(c, i, 3).length >= 3);
    if (alt !== undefined && place(alt)) return;
  }
}

function placeShrine(c: Ctx): void {
  const i = pickFrom(c, c.reg.land, (j) => {
    const d = c.reg.distMain[j] as number;
    return d >= 2 && d <= 8 && farFromEntry(c, j, 8);
  });
  if (i === undefined) return;
  const p = xyOf(c.f, i);
  c.f.features.push({ id: c.state.nextId++, kind: 'shrine', x: p.x, y: p.y });
  c.used.add(i);
}

function placeSpring(c: Ctx): void {
  const i = pickFrom(c, c.reg.grottos.length ? c.reg.grottos : c.reg.land, (j) => farFromEntry(c, j, 6));
  if (i === undefined) return;
  const p = xyOf(c.f, i);
  c.f.features.push({ id: c.state.nextId++, kind: 'spring', x: p.x, y: p.y });
  c.used.add(i);
}

function placeMerchant(c: Ctx): void {
  const { f } = c;
  const i = pickFrom(c, c.reg.land, (j) => {
    const d = c.reg.distMain[j] as number;
    // Near the way through and up high, so the tide doesn't cut the hermit off early.
    return d <= 4 && farFromEntry(c, j, 10) && (f.elev[j] as number) >= 5;
  });
  if (i === undefined) return;
  const p = xyOf(f, i);
  f.features.push({ id: c.state.nextId++, kind: 'merchant', x: p.x, y: p.y });
  c.used.add(i);
  const spots = nearbyFree(c, i, 4);
  const goods: { item: ItemInst; price: number }[] = [];
  for (let k = 0; k < 2; k++) {
    const key = weighted(c.rng, c.zone.loot);
    goods.push({ item: { kind: 'consumable', def: key, count: 1 }, price: CONSUMABLES[key]?.price ?? 15 });
  }
  const owned = new Set(c.state.build.relics);
  const relicKey = sample(c.rng, Object.keys(RELICS).filter((k) => !owned.has(k)), 1)[0];
  if (relicKey) goods.push({ item: { kind: 'relic', def: relicKey, count: 1 }, price: RELICS[relicKey]?.price ?? 40 });
  if (chance(c.rng, 0.5)) {
    const wk = sample(c.rng, Object.keys(WEAPONS).filter((k) => k !== c.state.build.weapon.def), 1)[0];
    if (wk) goods.push({ item: { kind: 'weapon', def: wk, count: 1 }, price: 30 });
  } else {
    const key = weighted(c.rng, c.zone.loot);
    goods.push({ item: { kind: 'consumable', def: key, count: 2 }, price: (CONSUMABLES[key]?.price ?? 15) * 2 - 4 });
  }
  goods.slice(0, spots.length).forEach((g, k) => placeItem(c, spots[k] as number, g.item, { price: g.price }));
}

// ---------------------------------------------------------------------------
// Loot

function placeLoot(c: Ctx): void {
  const { f } = c;
  const scale = 1 + c.index * 0.18;
  // Pearls: mostly in the low grottos (they flood first) and on the seabed.
  const piles = range(c.rng, 4, 6);
  for (let k = 0; k < piles; k++) {
    const src = chance(c.rng, 0.6) && c.reg.grottos.length ? c.reg.grottos : c.reg.deadEnds.length ? c.reg.deadEnds : c.reg.land;
    const i = pickFrom(c, src, (j) => farFromEntry(c, j, 5));
    if (i === undefined) continue;
    placeItem(c, i, { kind: 'pearls', def: 'pearls', count: Math.round(range(c.rng, 2, 5) * scale) });
  }
  if (c.reg.deepWater.length && chance(c.rng, 0.7)) {
    const i = pickFrom(c, c.reg.deepWater);
    if (i !== undefined) placeItem(c, i, { kind: 'pearls', def: 'pearls', count: Math.round(range(c.rng, 6, 10) * scale) });
  }
  // Consumables in side areas.
  const n = range(c.rng, 2, 4) + (c.mods.includes('rift') ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const src = c.reg.deadEnds.length && chance(c.rng, 0.5) ? c.reg.deadEnds : c.reg.land;
    const i = pickFrom(c, src, (j) => (c.reg.distMain[j] as number) >= 2 && farFromEntry(c, j, 5));
    if (i === undefined) continue;
    const key = weighted(c.rng, c.zone.loot);
    placeItem(c, i, { kind: 'consumable', def: key, count: 1 });
  }
  // Occasionally a new weapon.
  if (c.index >= 1 && c.index <= 7 && chance(c.rng, 0.22)) {
    const i = pickFrom(c, c.reg.deadEnds.length ? c.reg.deadEnds : c.reg.land, (j) => farFromEntry(c, j, 10));
    const wk = sample(c.rng, Object.keys(WEAPONS).filter((k) => k !== c.state.build.weapon.def), 1)[0];
    if (i !== undefined && wk) placeItem(c, i, { kind: 'weapon', def: wk, count: 1 });
  }
}

// ---------------------------------------------------------------------------
// Encounters

function sitesFor(c: Ctx, where: Where, aquatic: boolean): number[] {
  const r = c.reg;
  const minD = 8;
  const far = (i: number): boolean => farFromEntry(c, i, minD) && (r.distEntry[i] as number) < UNREACHABLE;
  if (aquatic) return (r.deepWater.length ? r.deepWater : r.water).filter((i) => farFromEntry(c, i, 6));
  switch (where) {
    case 'water': return r.water.filter(far);
    case 'shore': return r.shore.filter(far);
    case 'chokepoint': {
      const s = r.chokepoints.filter(far);
      return s.length ? s : r.land.filter(far);
    }
    case 'grotto': {
      const s = r.grottos.filter(far);
      return s.length ? s : r.land.filter(far);
    }
    case 'deadend': {
      const s = r.deadEnds.filter(far);
      return s.length ? s : r.land.filter(far);
    }
    case 'high': {
      const s = r.high.filter(far);
      return s.length ? s : r.land.filter(far);
    }
    case 'land':
      return r.land.filter(far);
    case 'any':
      return [...r.land, ...r.water].filter(far);
  }
}

function placeEncounter(c: Ctx, enc: EncounterDef): boolean {
  const aquaticGroup = enc.group.every(([k]) => MONSTERS[k]?.move === 'swim');
  const sites = sitesFor(c, enc.where, aquaticGroup);
  if (sites.length === 0) return false;
  const anchor = sites[int(c.rng, sites.length)] as number;
  const ax = anchor % c.f.w;
  const ay = Math.floor(anchor / c.f.w);
  let placed = 0;
  for (const [key, count] of enc.group) {
    const d = MONSTERS[key];
    if (!d) continue;
    for (let k = 0; k < count; k++) {
      const sleepP = c.mods.includes('restless') ? 0 : c.mods.includes('hushed') ? Math.max(0.75, d.sleep ?? 0) : (d.sleep ?? 0);
      const asleep = chance(c.rng, sleepP);
      const mode = d.move === 'swim' ? 'wander' : chance(c.rng, 0.3) ? 'wander' : 'guard';
      const m = spawnMonster(c.state, key, ax, ay, { asleep, rng: c.rng, mode, floor: c.f });
      if (m) {
        placed++;
        // Keep the arrival area clear.
        if (Math.hypot(m.x - c.entry.x, m.y - c.entry.y) < 6) {
          c.f.actors = c.f.actors.filter((a) => a.id !== m.id);
          c.f.occ[m.y * c.f.w + m.x] = 0;
          placed--;
        }
      }
    }
  }
  return placed > 0;
}

function placeEncounters(c: Ctx): void {
  let budget = Math.round((THREAT_BUDGET[c.index] ?? 12) * (c.mods.includes('rift') ? 1.35 : 1) * (c.mods.includes('restless') ? 1.2 : 1));
  const table = c.zone.encounters.filter((e) => c.index >= e.floors[0] && c.index <= e.floors[1]);
  for (let guard = 0; guard < 30 && budget > 0; guard++) {
    const affordable = table.filter((e) => e.cost <= budget);
    if (affordable.length === 0) break;
    const enc = weighted(c.rng, affordable.map((e) => [e, e.weight] as const));
    if (placeEncounter(c, enc)) budget -= enc.cost;
    else budget -= 1;
  }
}

// ---------------------------------------------------------------------------

export function populate(state: GameState, f: FloorState, rng: RngState, reg: Regions, entry: P, exit: P, index: number, mods: string[], marks: Record<string, P>): void {
  const zone = zoneForFloor(index);
  const c: Ctx = { state, f, rng, reg, entry, zone, index, mods, used: new Set() };
  // Keep a clear ring around the arrival point.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.used.add((entry.y + dy) * f.w + entry.x + dx);
  f.features.push({ id: state.nextId++, kind: 'entry', x: entry.x, y: entry.y });

  if (index === 9) {
    const lh = marks.lighthouse ?? exit;
    f.features.push({ id: state.nextId++, kind: 'beacon', x: lh.x, y: lh.y });
    c.used.add(lh.y * f.w + lh.x);
  } else {
    placeExits(c, exit);
  }

  const isBoss = index === 5;
  if (mods.includes('rift') || (index >= 1 && !isBoss && index < 9 && chance(rng, 0.45))) placeVault(c, mods.includes('rift'));
  // A tide shrine always waits on the Abbot's floor: a place to spend pearls before the fight.
  if (isBoss || (index >= 1 && index < 9 && chance(rng, 0.4))) placeShrine(c);
  if (chance(rng, 0.45)) placeSpring(c);
  if (index === 1 || index === 4 || index === 7) placeMerchant(c);
  placeLoot(c);

  if (isBoss) {
    const arena = marks.arena ?? exit;
    const abbot = spawnMonster(state, 'abbot', arena.x, arena.y, { rng, mode: 'guard', floor: f });
    if (abbot?.ai) abbot.ai.mode = 'guard';
  }
  if (index === 9) {
    // The Leviathan waits in the sea on the low side, away from where you arrive.
    const sea = reg.deepWater.filter((i) => i % f.w < 5 && Math.hypot((i % f.w) - entry.x, Math.floor(i / f.w) - entry.y) >= 12);
    const i = sea.length ? sea[int(rng, sea.length)] : reg.deepWater[reg.deepWater.length - 1];
    if (i !== undefined) spawnMonster(state, 'leviathan', i % f.w, Math.floor(i / f.w), { rng, mode: 'guard', floor: f });
  }
  placeEncounters(c);
}
