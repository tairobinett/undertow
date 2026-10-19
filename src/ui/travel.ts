// Travel and auto-explore, shared by the browser UI and the text harness. DOM-free: it
// only reads the state and proposes the next move (or says why travel should stop).

import { MONSTERS } from '../content/monsters.ts';
import { canReach } from '../ai/brain.ts';
import { dijkstraMap, stepDownhill, UNREACHABLE } from '../core/dijkstra.ts';
import { actorAt as floorActorAt, idx, isDeep, isWater } from '../core/floor.ts';
import { chebyshev } from '../core/geom.ts';
import { capName, enemies, freshAirRoute, hasStatus, moveModeOf, nameOf, player, playerMaxBreath, speedOf } from '../core/state.ts';
import { GAS, TERRAIN } from '../core/terrain.ts';
import type { Actor, Command, GameState } from '../core/types.ts';

export interface Travel {
  kind: 'travel' | 'explore' | 'exit';
  goal?: number;
  /** Enemies already in view when travel started, or that already stopped it (they don't again). */
  seen: Set<number>;
  /** Unaware enemies noticed far off: they stop travel only if they come close. */
  far?: Set<number>;
  /** Slow hunters that were too far off to matter: they stop travel if they close in. */
  slow?: Set<number>;
  /** Health before the last step: losing any on the way stops travel. Kept by travelNext. */
  hp: number;
  /** The player agreed to swim this crossing: deep water no longer stops the walk (or turns it back). */
  swim?: boolean;
  /** Has been in deep water since agreeing (the consent ends on landing). */
  swam?: boolean;
  /** Where the consent was given: it covers a crossing that starts there. */
  swimFrom?: number;
  /** Has waded into the water since agreeing (reaching dry land again ends the consent). */
  waded?: boolean;
  /** Water level before the last step: a rise while you stand in water stops travel. */
  water?: number;
  /** Where the agreed crossing comes ashore: travel heads there until you're out of the water. */
  landing?: number;
  /** Travel is making for the nearest air (the way on ran past your breath); what to say on landing. */
  retreat?: string;
  /** Has followed the fresh air (no known way to the way up yet). */
  followed?: boolean;
}

/** Why travel stopped. `swimTiles` means it stopped at the edge of deep water it could cross. */
export type TravelStop = { stop: string; swimTiles?: number };

export function visibleEnemies(s: GameState): Actor[] {
  const f = s.floor;
  const p = player(s);
  return f.actors.filter((a) => !a.dead && !a.submerged && a.id !== p.id && enemies(s, p, a) && f.vis[idx(f, a.x, a.y)] === 1);
}

/**
 * Telegraphed tiles you can see: all of a wind-up by a creature in view, and the tiles you can
 * see of one by a creature you can't (the marks show, just not where they come from).
 */
export function telegraphTiles(s: GameState): Set<number> {
  const f = s.floor;
  const out = new Set<number>();
  for (const a of f.actors) {
    if (a.dead || !a.ai?.intent) continue;
    const inView = f.vis[idx(f, a.x, a.y)] === 1;
    for (const t of a.ai.intent.tiles) if (inView || f.vis[t]) out.add(t);
  }
  return out;
}

/** Hostile wind-ups by creatures out of sight whose marks you can see. */
export function unseenWindups(s: GameState): Actor[] {
  const f = s.floor;
  const p = player(s);
  return f.actors.filter((a) => !a.dead && a.ai?.intent && enemies(s, p, a) && (a.submerged || f.vis[idx(f, a.x, a.y)] !== 1)
    && a.ai.intent.tiles.some((t) => f.vis[t] === 1));
}

/**
 * Tiles within reach of a water-bound creature you can see (surfaced, or as ripples): they
 * bite anything that passes next to their water.
 */
export function lurkZones(s: GameState): Map<number, Actor> {
  const f = s.floor;
  const p = player(s);
  const zones = new Map<number, Actor>();
  for (const a of f.actors) {
    if (a.dead || !f.vis[idx(f, a.x, a.y)] || !enemies(s, p, a)) continue;
    if (!a.submerged && moveModeOf(a) !== 'swim') continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = a.x + dx;
      const y = a.y + dy;
      if (x >= 0 && y >= 0 && x < f.w && y < f.h && !zones.has(y * f.w + x)) zones.set(y * f.w + x, a);
    }
  }
  return zones;
}

/** Step costs for travel: known walkable tiles only, avoiding deep water, fire and telegraphed tiles. */
export function pathCost(s: GameState, swim = false): (i: number) => number {
  const f = s.floor;
  const danger = new Set<number>([...lurkZones(s).keys(), ...telegraphTiles(s)]);
  const p = player(s);
  // Badly hurt, keep away from the water's edge: things lurk under the surface.
  const wary = p.hp < p.maxHp / 3;
  const byDeep = (i: number): boolean => {
    const x = i % f.w;
    const y = (i - x) / f.w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && isDeep(f, ny * f.w + nx)) return true;
    }
    return false;
  };
  return (i: number) => {
    if (!f.seen[i]) return Infinity;
    const td = TERRAIN[f.terrain[i] as number];
    if (!td?.walk) return Infinity;
    let c = 1;
    if (isDeep(f, i)) c += swim ? 2 : 25;
    else if (wary && byDeep(i)) c += 8;
    if ((f.fire[i] as number) > 0) c += 40;
    // Scalding steam and poison miasma hang around: walk around the clouds.
    const gas = f.gas[i] as number;
    if ((gas === GAS.STEAM || gas === GAS.MIASMA) && (f.gasAmt[i] as number) >= 10) c += 30;
    if (danger.has(i)) c += 40;
    return c;
  };
}

/** The path the player would walk to `goal` (including the start tile), or [] if none is known. */
export function pathTo(s: GameState, goal: number): number[] {
  const f = s.floor;
  const p = player(s);
  if (goal < 0 || goal >= f.w * f.h || !f.seen[goal]) return [];
  const dist = dijkstraMap(f.w, f.h, [goal], pathCost(s), 400);
  let cur = idx(f, p.x, p.y);
  if ((dist[cur] as number) >= UNREACHABLE) return [];
  const path = [cur];
  for (let k = 0; k < 200 && cur !== goal; k++) {
    const next = stepDownhill(f.w, f.h, dist, cur, () => true);
    if (next < 0) break;
    path.push(next);
    cur = next;
  }
  return path;
}

/**
 * Turns spent in deep water to reach the nearest known place to breathe from each known tile
 * (0 on one), with the water at `level`. Travel takes a stroke only while that stays within
 * your breath, so it can always turn back.
 */
export function knownAir(s: GameState, level = s.floor.waterLevel): Float64Array {
  const f = s.floor;
  const w0 = f.waterLevel;
  f.waterLevel = level;
  try {
    const walk = (i: number): boolean => !!f.seen[i] && (TERRAIN[f.terrain[i] as number]?.walk ?? false);
    const air: number[] = [];
    for (let i = 0; i < f.w * f.h; i++) if (walk(i) && !isDeep(f, i)) air.push(i);
    return dijkstraMap(f.w, f.h, air, (i) => (walk(i) ? 1 : Infinity), 60);
  } finally {
    f.waterLevel = w0;
  }
}

/** How many turns you can spend in deep water from now before you drown. */
export function breathBudget(s: GameState): number {
  const p = player(s);
  const gills = p.statuses.find((x) => x.id === 'gills');
  // Breathing from a bladder keeps your breath full until it runs out.
  return gills ? playerMaxBreath(s) + gills.turns - 1 : Math.max(0, p.breath);
}

/** Auto-explore targets: the edge of the known map, plus loose pearls and belt items worth taking. */
export function exploreGoals(s: GameState): number[] {
  return exploreTargets(s).goals;
}

/**
 * Explore targets, and how many edges of the map it passed over because they lie out in open
 * water farther than one breath can scout and come back from.
 */
function exploreTargets(s: GameState): { goals: number[]; farWater: number } {
  const f = s.floor;
  const goals: number[] = [];
  let farWater = 0;
  let air: Float64Array | undefined;
  const reach = playerMaxBreath(s);
  for (let i = 0; i < f.w * f.h; i++) {
    if (!f.seen[i] || !(TERRAIN[f.terrain[i] as number]?.walk ?? false)) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    let frontier = false;
    for (let dy = -1; dy <= 1 && !frontier; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue;
        if (!f.seen[ny * f.w + nx]) {
          frontier = true;
          break;
        }
      }
    }
    if (!frontier) continue;
    // Deep water at the edge of the known map counts if one breath can swim out to look and
    // come back (travel stops at the water's edge and offers the swim). Farther out, it's yours
    // to swim by hand.
    if (isDeep(f, i)) {
      air ??= knownAir(s);
      if (2 * (air[i] as number) - 1 > reach) {
        farWater++;
        continue;
      }
    }
    goals.push(i);
  }
  for (const it of f.items) {
    if (it.price !== undefined || it.vault !== undefined) continue;
    const i = idx(f, it.x, it.y);
    if (!f.seen[i] || isDeep(f, i)) continue;
    if (it.item.kind === 'pearls') goals.push(i);
    else if (it.item.kind === 'consumable') {
      const free = s.build.belt.some((b) => !b || (b.def === it.item.def && b.count < 3));
      if (free) goals.push(i);
    }
  }
  return { goals, farWater };
}

/** The known tiles you can stand on beside the beacon (where you light it). */
function beaconSides(s: GameState, b: { x: number; y: number }): number[] {
  const f = s.floor;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = b.x + dx;
      const y = b.y + dy;
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const i = idx(f, x, y);
      if (f.seen[i] && TERRAIN[f.terrain[i] as number]?.walk && !isDeep(f, i)) out.push(i);
    }
  }
  return out;
}

export function startTravel(s: GameState, kind: Travel['kind'], goal?: number): Travel {
  const t: Travel = { kind, seen: new Set(visibleEnemies(s).map((a) => a.id)), hp: player(s).hp };
  if (goal !== undefined) t.goal = goal;
  return t;
}

/**
 * The next travel step: a move command, or a reason to stop (an empty string stops silently).
 * Interruptions: a newly spotted awake enemy, an enemy in view that is hunting you, taking
 * damage, a visible wind-up, or deep water ahead.
 */
/** A newly spotted creature farther than this that hasn't noticed you doesn't stop travel. */
const SPOT_NEAR = 7;

export function travelNext(s: GameState, t: Travel): { cmd: Command; note?: string } | TravelStop {
  if (s.status !== 'playing') return { stop: '' };
  if (s.pending) return { stop: 'You have a choice to make first.' };
  const p = player(s);
  const f = s.floor;
  const now = visibleEnemies(s);
  // Newly spotted creatures stop you if they're close or aware of you. Distant, unaware ones
  // are just noted (a pack trickling into view shouldn't stop you at every step).
  let spotted: Actor | undefined;
  const distant: string[] = [];
  for (const a of now) {
    if (t.seen.has(a.id)) continue;
    if (a.ai?.mode === 'asleep') {
      t.seen.add(a.id);
      continue;
    }
    const aware = a.ai?.mode === 'hunt' || a.ai?.mode === 'alert';
    if (aware || chebyshev(a.x, a.y, p.x, p.y) <= SPOT_NEAR) {
      t.seen.add(a.id);
      spotted ??= a;
    } else if (!(t.far ??= new Set()).has(a.id)) {
      t.far.add(a.id);
      distant.push(MONSTERS[a.def]?.name ?? 'something');
    }
  }
  if (spotted) return { stop: `You spot ${MONSTERS[spotted.def]?.name ?? 'something'}${t.far?.has(spotted.id) ? ' coming closer' : ''}.` };
  // Creatures that can't come after you (bound to the water while you're on land, or rooted
  // to the rock) don't hold you up by hunting; if they wind up an attack, that stops you below.
  const onLand = !isWater(f, idx(f, p.x, p.y));
  const stuck = (a: Actor): boolean => (onLand && moveModeOf(a) === 'swim' && chebyshev(a.x, a.y, p.x, p.y) > 1) || !!MONSTERS[a.def]?.tags.includes('rooted');
  // Nor, unless you're badly hurt, do creatures slower than you while they're well out of
  // reach (you can outwalk them; travel stops if one closes to within three tiles), or
  // creatures that only fight up close and have no way to you over ground you know.
  const steady = p.hp >= p.maxHp / 3;
  const slowFar = (a: Actor): boolean => steady && speedOf(s, a) < speedOf(s, p) && chebyshev(a.x, a.y, p.x, p.y) > 3;
  const cutOff = (a: Actor): boolean => steady && chebyshev(a.x, a.y, p.x, p.y) > 1
    && (MONSTERS[a.def]?.abilities ?? []).every((ab) => ab.when === 'adjacent') && !canReach(s, a, p.x, p.y, f.seen);
  const hunter = now.find((a) => (a.ai?.mode === 'hunt' || a.ai?.mode === 'alert') && !stuck(a) && !slowFar(a) && !cutOff(a));
  for (const a of now) if ((a.ai?.mode === 'hunt' || a.ai?.mode === 'alert') && slowFar(a)) (t.slow ??= new Set()).add(a.id);
  if (hunter) return { stop: t.slow?.has(hunter.id) ? `${capName(s, hunter)} is closing in.` : `Not while ${MONSTERS[hunter.def]?.name ?? 'something'} is hunting you.` };
  if (p.hp < t.hp) return { stop: p.breath < 0 ? 'You are drowning!' : 'You are hurt!' };
  // Burning or poison that would finish you: deal with it by hand.
  const burn = p.statuses.find((x) => x.id === 'burning')?.turns ?? 0;
  const poison = p.statuses.find((x) => x.id === 'poisoned')?.turns ?? 0;
  if (burn * 2 + poison >= p.hp) return { stop: burn ? 'You are burning, and it would kill you — put it out first!' : 'The poison would kill you on the way — cure it first!' };
  if (t.water !== undefined && f.waterLevel > t.water && isWater(f, idx(f, p.x, p.y))) {
    t.water = f.waterLevel;
    return { stop: isDeep(f, idx(f, p.x, p.y)) ? 'The tide rises over your head — you are swimming!' : 'The tide rises around you.' };
  }
  if (now.some((a) => a.ai?.intent)) return { stop: 'Something is winding up an attack!' };
  if (unseenWindups(s).length) return { stop: "Something you can't see is winding up an attack!" };
  // Consent to swim covers one crossing, the one where you gave it: it ends once you are back
  // on your feet, or if travel walks off on dry land before reaching that water.
  if (t.swim) {
    const at = idx(f, p.x, p.y);
    if (isDeep(f, at)) t.swam = true;
    else if (t.swam) t.swim = t.swam = false;
    else if (isWater(f, at)) t.waded = true;
    else {
      // Across the water you agreed to (the tide never made you swim it), or walked off elsewhere.
      t.swimFrom ??= at;
      if (t.waded || chebyshev(p.x, p.y, t.swimFrom % f.w, Math.floor(t.swimFrom / f.w)) > 2) t.swim = t.waded = false;
    }
  }
  const here = idx(f, p.x, p.y);
  const budget = breathBudget(s);
  const free = (j: number): boolean => !floorActorAt(f, j % f.w, Math.floor(j / f.w));
  const moveTo = (j: number): Command => ({ t: 'move', dx: (j % f.w) - p.x, dy: Math.floor(j / f.w) - p.y });
  const willRise = f.tidePaused === 0 && f.tideTimer <= 8;
  // Out in the water with the way on too long: swim for the nearest air, then hand over. If
  // the tide rises before you'd get there, make for air that will still be air.
  const makeForAir = (why: string, landed = 'You turn back to the shore: the water runs on farther than your breath.'): { cmd: Command; note?: string } | TravelStop => {
    let air = knownAir(s);
    if (willRise && f.tideTimer <= (air[here] as number)) {
      const risen = knownAir(s, f.waterLevel + 1);
      if ((risen[here] as number) < UNREACHABLE) air = risen;
    }
    const step = stepDownhill(f.w, f.h, air, here, free);
    if (step < 0 || (air[step] as number) > budget) {
      const d = air[here] as number;
      return { stop: d >= UNREACHABLE ? 'You know of no air within reach. Find some!' : `The nearest air you know is ${d} stroke${d === 1 ? '' : 's'} away, more than your breath will carry you. Swim for it, or use what you carry!` };
    }
    const first = !t.retreat;
    t.retreat ??= landed;
    t.hp = p.hp;
    t.water = f.waterLevel;
    return first && why ? { cmd: moveTo(step), note: why } : { cmd: moveTo(step) };
  };
  if (t.retreat) {
    if (isDeep(f, here)) return makeForAir('');
    const landed = t.retreat;
    delete t.retreat;
    t.swim = t.swam = false;
    return { stop: landed };
  }
  const beacon = f.features.find((x) => x.kind === 'beacon');
  let goals: number[];
  let farWater = 0;
  // Mid-crossing, keep to the crossing you agreed to rather than chasing a new goal.
  if (t.landing !== undefined && !isDeep(f, here)) delete t.landing;
  if (t.landing !== undefined) goals = [t.landing];
  else if (t.kind === 'travel' && t.goal !== undefined) goals = [t.goal];
  else if (t.kind === 'exit') {
    // The Stair if you know one; the Rift (a harder floor) only when it's the only way up known.
    const known = f.features.filter((x) => x.kind === 'exit' && f.seen[idx(f, x.x, x.y)]);
    const stairs = known.filter((x) => x.route !== 'rift');
    goals = (stairs.length ? stairs : known).map((x) => idx(f, x.x, x.y));
    // On the Surface the way out is the beacon: stand beside it.
    if (beacon && f.seen[idx(f, beacon.x, beacon.y)]) goals = beaconSides(s, beacon);
  }
  else ({ goals, farWater } = exploreTargets(s));
  // Nowhere to go from out in the water: get out of it first.
  const ashore = (): { cmd: Command; note?: string } | TravelStop =>
    makeForAir(t.kind === 'explore' ? 'Nothing more to explore out here: you make for the nearest air.' : 'No way on from out here: you make for the nearest air.', 'Back on your feet.');
  // With no known way to the way up, travel follows the fresh air: the route the sidebar's
  // compass shows, step by step (it tells you nothing the compass doesn't).
  let following = false;
  if (goals.length === 0) {
    if (t.kind === 'exit') following = true;
    else {
      if (isDeep(f, here)) return ashore();
      if (t.kind === 'explore') {
        return { stop: farWater ? 'Nothing left to explore within reach: the rest lies out in open water, farther than one breath can scout and swim back from. Swim it by hand, or press > to travel to the way up.' : 'Nothing left to explore. Press > to travel to the way up.' };
      }
      return { stop: '' };
    }
  }
  if (goals.includes(here) && t.kind !== 'explore') {
    if (t.kind !== 'exit') return { stop: '' };
    if (beacon) return { stop: 'You reach the beacon. Press g three turns running to light it.' };
    const rift = f.features.some((x) => x.kind === 'exit' && x.route === 'rift' && x.x === p.x && x.y === p.y);
    return { stop: rift ? 'You reach the Rift: a harder floor lies above, with a relic vault. No stair is known yet. Press < to climb.' : 'You reach the way up. Press < to climb.' };
  }
  const gills = hasStatus(p, 'gills');
  const swim = !!t.swim || gills;
  // Agreeing to swim permits the crossing you were shown; it doesn't make water cheap (the
  // route stays the one that was quoted). Only breathing from an air bladder does.
  let dist = following ? new Float64Array(0) : dijkstraMap(f.w, f.h, goals.filter((g) => g !== here || t.kind !== 'explore'), pathCost(s, gills), 400);
  if (!following && (dist[here] as number) >= UNREACHABLE) {
    if (t.kind === 'exit') following = true;
    else {
      if (isDeep(f, here)) return ashore();
      return { stop: t.kind === 'explore' ? 'Nothing left to explore that you can reach. Press > to travel to the way up.' : 'No known path.' };
    }
  }
  let followNote = '';
  if (following) {
    const route = freshAirRoute(s);
    if (!route || route.length < 2) {
      if (isDeep(f, here)) return ashore();
      return { stop: beacon ? 'You have not seen the beacon yet: the sidebar points the way.' : 'You have not found a way up yet.' };
    }
    // A distance map along the route, so the rest of travel (swims, landings) reads it as usual.
    dist = new Float64Array(f.w * f.h).fill(UNREACHABLE);
    route.forEach((i, k) => {
      dist[i] = Math.min(dist[i] as number, route.length - 1 - k);
    });
    if (!t.followed) {
      t.followed = true;
      followNote = beacon ? 'You follow the fresh air toward the beacon.' : 'You follow the fresh air toward the way up.';
    }
  }
  // Badly hurt, one blow from something you can't see could finish you: automation doesn't
  // wander into ground you haven't seen (exploring, or following the air). Travel over ground
  // you know still works.
  if (p.hp < p.maxHp / 3 && !isDeep(f, here) && (t.kind === 'explore' || following)) {
    return { stop: t.kind === 'explore'
      ? "You are badly hurt: exploring on autopilot could walk you into something you can't see. Explore by hand, or press > if you know the way up."
      : "You are badly hurt, and the way up lies through ground you haven't seen: go by hand, following the air." };
  }
  const next = stepDownhill(f.w, f.h, dist, here, free);
  if (next < 0) return { stop: 'Something is in the way.' };
  // The air's route doesn't step around fire or clouds the way a known path does.
  if (following && ((f.fire[next] as number) > 0 || ((f.gas[next] === GAS.STEAM || f.gas[next] === GAS.MIASMA) && (f.gasAmt[next] as number) >= 10))) {
    return { stop: `${(f.fire[next] as number) > 0 ? 'Fire' : f.gas[next] === GAS.STEAM ? 'Scalding steam' : 'Poison miasma'} lies across the way the air flows.` };
  }
  // The only way on passes a creature lurking in its water: that's your call, not travel's.
  const lurker = lurkZones(s).get(next);
  if (lurker) return { stop: `The way on passes within reach of ${nameOf(s, lurker)}${lurker.submerged ? ' under the water' : ''}.` };
  // How long a swim lies ahead from `next` if the water stands at `level`, and where it lands.
  let landing = -1;
  const swimAt = (level: number): number => {
    const w0 = f.waterLevel;
    f.waterLevel = level;
    let n = 0;
    try {
      let cur = next;
      for (let k = 0; k < 200 && isDeep(f, cur); k++) {
        n++;
        const nx = stepDownhill(f.w, f.h, dist, cur, () => true);
        if (nx < 0) break;
        cur = nx;
      }
      if (level === w0) landing = isDeep(f, cur) ? -1 : cur;
    } finally {
      f.waterLevel = w0;
    }
    return n;
  };
  const later = willRise ? swimAt(f.waterLevel + 1) : 0;
  const nextDeep = isDeep(f, next);
  // Setting out into water from where you can stand: judge it as the swim it will be.
  let entering = nextDeep && !isDeep(f, here);
  let n = nextDeep ? swimAt(f.waterLevel) : 0;
  // Exploring out into water that runs on past what you've seen: nobody knows where it lands.
  const open = nextDeep && landing < 0 && t.kind === 'explore';
  let tiles = open ? `about ${n} tile${n === 1 ? '' : 's'} out to the edge of what you've seen, and on past it` : `about ${n} tile${n === 1 ? '' : 's'}`;
  if (willRise && later > n && f.tideTimer <= later + 1) {
    // The tide rises before you'd be across: even shallows ahead turn into a swim.
    tiles = n
      ? `about ${n} tile${n === 1 ? '' : 's'} now, but the tide rises in ${f.tideTimer} and it becomes about ${later}`
      : `the tide rises in ${f.tideTimer} and the water ahead turns deep: about ${later} tile${later === 1 ? '' : 's'}`;
    n = later;
    if (!isDeep(f, here)) entering = true;
  }
  if (n > 0 && (nextDeep || entering)) {
    // Hurt, you don't trust the water to autopilot: things lurk there.
    if (p.hp < p.maxHp / 3 && !isDeep(f, here)) return { stop: `The way on is through deep water (${tiles}), and you are too hurt to swim it on autopilot. Swim by hand if you mean to.` };
    if (p.hp < p.maxHp / 3) return { stop: 'You are too hurt to swim on autopilot. Make for the nearest air by hand.' };
    if (entering && !swim) {
      return { stop: open ? `The way on is out into deep water: ${tiles}. If no shore shows up in time, you'll turn back.` : `The way on is through deep water: ${tiles} of swimming.`, swimTiles: n };
    }
    // Travel never sets out on a crossing longer than your breath...
    if (!open && n > budget) {
      if (isDeep(f, here)) return makeForAir(`You won't make it across on this breath (${tiles} of water ahead): you make for the nearest air.`);
      return { stop: `That swim is ${tiles}, and you can hold your breath for ${budget}.` };
    }
  }
  // ...and never takes a stroke that leaves the nearest air it knows beyond your breath, so it
  // can always turn back (out into unknown water, or when the tide is about to rise).
  const risen = willRise ? knownAir(s, f.waterLevel + 1) : undefined;
  if (nextDeep) {
    const air = knownAir(s);
    let back = air[next] as number;
    if (risen && f.tideTimer <= (risen[next] as number)) back = Math.max(back, risen[next] as number);
    if (back > budget) {
      if (isDeep(f, here)) return makeForAir('The water ahead runs on past your breath: you make for the nearest air.');
      return { stop: `That swim is ${tiles}, and you can hold your breath for ${budget}.` };
    }
  }
  // With the tide about to rise, don't walk out where the risen water would leave you farther
  // from air than your breath (heading toward air is always fine).
  if (risen) {
    const r = risen[next] as number;
    if (r > budget && r >= (risen[here] as number)) {
      return { stop: `The tide rises in ${f.tideTimer}, and out there it will close over your head${r >= UNREACHABLE ? '' : `, ${r} strokes from air`}. Go by hand if you mean to.` };
    }
  }
  // On a crossing (setting out, or already in the water when travel began): remember where it
  // comes ashore, and keep to it rather than re-planning toward a farther goal mid-swim.
  if (nextDeep && landing >= 0 && t.landing === undefined) t.landing = landing;
  t.hp = p.hp;
  t.water = f.waterLevel;
  const cmd = moveTo(next);
  const note = [followNote, distant.length ? `You spot ${distant.join(', ')} in the distance.` : ''].filter(Boolean).join(' ');
  return note ? { cmd, note } : { cmd };
}
