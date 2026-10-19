// Inspection text, generated from the same data the rules use so it can't drift.

import { ABILITIES } from '../content/abilities.ts';
import { CONSUMABLES } from '../content/consumables.ts';
import { MONSTERS } from '../content/monsters.ts';
import type { MonsterAbility, MonsterDef } from '../content/monsters.ts';
import { RELICS } from '../content/relics.ts';
import type { EffectSpec, Shape } from '../content/spec.ts';
import { STATUSES } from '../content/statuses.ts';
import { WEAPONS, WEAPON_UPGRADES } from '../content/weapons.ts';
import { ZONES } from '../content/zones.ts';
import { BRIDGE_DECK, idx, isDeep, isWater, rawDepth } from '../core/floor.ts';
import { chebyshev } from '../core/geom.ts';
import { effectiveTideInterval } from '../core/systems.ts';
import { computeDamage } from '../core/effects.ts';
import { enemies, freshAir, hasUpgrade, player, playerMaxBreath, speedOf } from '../core/state.ts';
import { SHRINE_OPTIONS, strikeCalc } from '../core/player.ts';
import { GAS, GASES, SURF, TERRAIN } from '../core/terrain.ts';
import type { Actor, DamageRecord, DamageType, FloorItem, GameState } from '../core/types.ts';

/** What the floor announced on arrival and you haven't found yet: relic altar, tide shrine, hermit. */
export function floorSights(state: GameState): string[] {
  const f = state.floor;
  const out: string[] = [];
  const vault = f.items.filter((it) => it.vault !== undefined);
  if (vault.length && !vault.some((it) => f.seen[it.y * f.w + it.x])) out.push('relics on an altar');
  const shrine = f.features.find((x) => x.kind === 'shrine' && !x.used);
  if (shrine && !f.seen[shrine.y * f.w + shrine.x]) out.push('a tide shrine');
  const hermit = f.features.find((x) => x.kind === 'merchant');
  if (hermit && !f.seen[hermit.y * f.w + hermit.x]) out.push('the hermit');
  return out;
}

/** "Depth 10" … "Depth 2", then "the Surface" for the last floor. */
export function depthName(index: number, capital = false): string {
  if (index >= 9) return capital ? 'The Surface' : 'the Surface';
  return `Depth ${10 - index}`;
}

export interface InfoBlock {
  title: string;
  color?: string;
  lines: string[];
  tip?: string;
}

export function shapeText(s: Shape): string {
  switch (s.k) {
    case 'self': return 'self';
    case 'melee': return 'adjacent';
    case 'bolt': return `bolt, range ${s.range}${s.radius ? `, radius ${s.radius}` : ''}`;
    case 'ray': return `aimed line, range ${s.range}`;
    case 'beam': return `beam through everything, range ${s.range}`;
    case 'cone': return `cone, range ${s.range}`;
    case 'lob': return `thrown, range ${s.range}${s.radius ? `, radius ${s.radius}` : ''}`;
    case 'burst': return `burst, radius ${Math.floor(s.radius)}`;
    case 'wave': return `wave, 3 wide × ${s.length}`;
    case 'tile': return `teleport, range ${s.range}`;
  }
}

const DT: Record<DamageType, string> = { physical: 'physical', fire: 'fire', cold: 'cold', lightning: 'lightning', poison: 'poison', drown: 'drowning', pure: 'true' };

export function effectText(e: EffectSpec): string {
  const parts: string[] = [];
  if (e.dmg) parts.push(`${e.dmg} ${DT[e.dtype ?? 'physical']}`);
  if (e.element && e.element !== e.dtype) parts.push(e.element === 'poison' ? 'miasma' : e.element);
  if (e.status) parts.push(`${STATUSES[e.status.id].name} ${e.status.turns}`);
  if (e.push) parts.push(`push ${e.push}`);
  if (e.pull) parts.push(`pull ${e.pull}`);
  if (e.heal) parts.push(`heal ${e.heal}`);
  if (e.cleanse) parts.push('cleanse');
  if (e.special === 'firepot') parts.push('splashes burning oil that lingers and spreads to grass, brush and wood');
  return parts.join(', ');
}

/** What a wind-up does when it lands, in a few words, so a harmless pull doesn't read like a killing blow. */
const LANDS: Record<string, string> = {
  firepot: 'burning oil',
  self_destruct: 'bursts into poison gas',
  raise_drowned: 'raises the drowned',
  call_deep: 'calls up its brood',
  snatch: 'steals from your belt',
};

function landsText(e: EffectSpec): string {
  const parts: string[] = [];
  if (e.dmg) parts.push(`${e.dmg} ${DT[e.dtype ?? 'physical']}`);
  if (e.special && LANDS[e.special]) parts.push(LANDS[e.special] as string);
  if (e.status) parts.push(STATUSES[e.status.id].name);
  if (e.push) parts.push(`knocks you back ${e.push}`);
  if (e.pull) parts.push(`drags you ${e.pull} closer`);
  if (!e.dmg && !e.status && !(e.special && LANDS[e.special]) && parts.length) parts.push('no damage');
  return parts.join(', ');
}

function abilityLine(a: MonsterAbility, speed = 100): string {
  // Wind-ups count the creature's own actions: slow creatures take longer, and nothing lands
  // before your next turn.
  const turns = Math.max(1, Math.ceil((a.windup * 100) / speed));
  const wind = a.windup > 0 ? `winds up ${turns} turn${turns > 1 ? 's' : ''}` : 'instant';
  const eff = effectText(a.effect);
  return `${a.name}: ${shapeText(a.shape)}${eff ? ` — ${eff}` : ''} (${wind}, every ${a.cooldown + a.windup} turns)`;
}

function resistLine(d: MonsterDef): string | undefined {
  if (!d.resist) return undefined;
  const imm: string[] = [];
  const res: string[] = [];
  const weak: string[] = [];
  for (const [k, v] of Object.entries(d.resist)) {
    const name = DT[k as DamageType];
    if (v === 0) imm.push(name);
    else if (v < 1) res.push(name);
    else if (v > 1) weak.push(name);
  }
  const out: string[] = [];
  if (imm.length) out.push(`Immune: ${imm.join(', ')}`);
  if (res.length) out.push(`Resists: ${res.join(', ')}`);
  if (weak.length) out.push(`Weak to: ${weak.join(', ')}`);
  return out.join('. ') || undefined;
}

export function modeText(a: Actor, state?: GameState): string {
  if (!a.ai) return '';
  if (a.ai.intent) {
    const ab = MONSTERS[a.def]?.abilities?.find((x) => x.key === a.ai?.intent?.ability);
    const what = ab ? landsText(ab.effect) : '';
    return `⚠ ${a.ai.intent.label} — ${a.ai.intent.turns <= 1 ? 'next turn' : `in ${a.ai.intent.turns} turns`}${what ? ` (${what})` : ''}${state ? spreadNote(state, a) : ''}`;
  }
  switch (a.ai.mode) {
    case 'asleep': return 'Asleep';
    case 'wander': return 'Wandering — unaware of you';
    case 'guard': return 'Watchful — unaware of you';
    case 'search': return 'Searching';
    case 'alert': return 'Just noticed you!';
    case 'hunt': return 'Hunting';
    case 'flee': return 'Fleeing';
  }
}

/**
 * A fire wind-up landing on something that burns: the marks show where it lands, but the fire
 * will spread from there over the next turns (grass catches the turn after, brush and wood too).
 */
function spreadNote(state: GameState, a: Actor): string {
  const it = a.ai?.intent;
  const ab = MONSTERS[a.def]?.abilities?.find((x) => x.key === it?.ability);
  if (!it || !ab || !(ab.effect.element === 'fire' || ab.effect.dtype === 'fire')) return '';
  const f = state.floor;
  const fuel = it.tiles.find((t) => (TERRAIN[f.terrain[t] as number]?.fuel ?? 0) > 0 && !isWater(f, t));
  if (fuel === undefined) return '';
  return `; the ${TERRAIN[f.terrain[fuel] as number]?.name} there will catch, and the fire will spread`;
}

/** Bosses shrug off stun, freezing, roots and knockback: their wind-ups can't be interrupted. */
const UNSTOPPABLE = "Unstoppable: can't be stunned, frozen, rooted or knocked back. Its wind-ups can only be dodged, not interrupted.";

function traitLine(d: MonsterDef): string {
  const speed = (d.speed ?? 100) > 100 ? 'fast (2 moves a turn)' : (d.speed ?? 100) < 100 ? 'slow (every other turn)' : '';
  const move = d.move === 'swim' ? 'lives in water' : d.move === 'amphibious' ? 'amphibious' : d.move === 'fly' ? 'flies' : d.move === 'phase' ? 'passes through walls' : '';
  return [speed, move, d.breathes === false ? "doesn't breathe" : ''].filter(Boolean).join(' · ');
}

/**
 * Trading basic blows from here: how many of yours it takes (the first may be a sneak attack),
 * and roughly what its blows deal you meanwhile. Wind-up attacks come on top.
 */
function fightForecast(state: GameState, a: Actor): string | undefined {
  const d = MONSTERS[a.def] as MonsterDef;
  const p = player(state);
  const c = strikeCalc(state, a);
  const src = { actor: p, name: 'you', cause: 'melee' };
  const first = computeDamage(state, a, c.base, 'physical', src, { mult: c.mult, armorPierce: c.armorPierce });
  const sneakMult = c.sneak ? (state.build.weapon.def === 'knife' ? (hasUpgrade(state, 'knife_assassin') ? 4 : 3) : 2) : 1;
  const later = computeDamage(state, a, c.base, 'physical', src, { mult: c.mult / sneakMult, armorPierce: c.armorPierce });
  if (first <= 0 || later <= 0) return undefined;
  const blows = a.hp <= first ? 1 : 1 + Math.ceil((a.hp - first) / later);
  const its = d.dmg ? computeDamage(state, p, d.dmg, 'physical', { actor: a, name: d.name, cause: 'melee' }) : 0;
  const perTurn = speedOf(state, a) / speedOf(state, p);
  const taken = Math.round(its * perTurn * (blows - 1));
  // Anything else already on you keeps hitting while you trade.
  const f = state.floor;
  const others = f.actors.filter((o) => o !== a && !o.dead && !o.submerged && enemies(state, p, o) && f.vis[idx(f, o.x, o.y)] === 1
    && (o.ai?.mode === 'hunt' || o.ai?.mode === 'alert') && chebyshev(o.x, o.y, p.x, p.y) <= 2 && (MONSTERS[o.def]?.dmg ?? 0) > 0);
  const more = Math.round(others.reduce((sum, o) => sum + computeDamage(state, p, MONSTERS[o.def]?.dmg ?? 0, 'physical', { actor: o, name: MONSTERS[o.def]?.name ?? '', cause: 'melee' }) * speedOf(state, o) / speedOf(state, p), 0) * blows);
  const also = others.length && more > 0 ? `, and the ${others.length === 1 ? 'other one' : `${others.length} others`} on you about ${more} more` : '';
  return `Trading blows: it falls in ${blows} of yours${its ? `; meanwhile it deals you about ${taken}` : ''}${also}${taken + more >= p.hp ? ' — you would fall first!' : '.'}`;
}

/** A kind of creature as the Codex remembers it: everything except its current state. */
export function describeMonsterDef(d: MonsterDef): InfoBlock {
  const lines: string[] = [];
  lines.push(`HP ${d.hp}${d.dmg ? ` · hits for ${d.dmg}` : ''}${d.armor ? ` · armor ${d.armor}` : ''}`);
  const traits = traitLine(d);
  if (traits) lines.push(traits);
  for (const ab of d.abilities ?? []) lines.push(abilityLine(ab, d.speed ?? 100));
  const r = resistLine(d);
  if (r) lines.push(r);
  if (d.boss) lines.push(UNSTOPPABLE);
  lines.push(d.desc);
  return { title: d.name, color: d.color, lines, tip: d.tip };
}

export function describeMonster(state: GameState, a: Actor): InfoBlock {
  const d = MONSTERS[a.def] as MonsterDef;
  const lines: string[] = [];
  // What its blow would actually do to you right now (armor, wet, frozen and all).
  let hit = '';
  if (d.dmg) {
    const you = computeDamage(state, player(state), d.dmg, 'physical', { actor: a, name: d.name, cause: 'melee' });
    hit = ` · hits for ${d.dmg}${you !== d.dmg ? ` (${you} to you)` : ''}`;
  }
  lines.push(`HP ${Math.max(0, Math.ceil(a.hp))}/${a.maxHp}${hit}${d.armor ? ` · armor ${d.armor}` : ''}`);
  const forecast = fightForecast(state, a);
  if (forecast) lines.push(forecast);
  const traits = traitLine(d);
  if (traits) lines.push(traits);
  lines.push(modeText(a, state));
  for (const ab of d.abilities ?? []) lines.push(abilityLine(ab, d.speed ?? 100));
  const r = resistLine(d);
  if (r) lines.push(r);
  if (d.boss) lines.push(UNSTOPPABLE);
  if (a.statuses.length) lines.push(`Status: ${a.statuses.map((s) => `${STATUSES[s.id].name} ${s.turns}`).join(', ')}`);
  lines.push(d.desc);
  return { title: d.name, color: d.color, lines, tip: d.tip };
}

/**
 * How long the way up stays open from where you stand: turns until the fresh air's route needs
 * a swim longer than your breath. 0 if it already does; undefined if it stays open a good while.
 */
export function wayUpDeadline(state: GameState): number | undefined {
  const f = state.floor;
  const breath = playerMaxBreath(state);
  const w0 = f.waterLevel;
  try {
    for (let rise = 0; rise <= 5; rise++) {
      f.waterLevel = w0 + rise;
      const air = freshAir(state);
      if (!air) return undefined;
      if (air.longestSwim > breath) {
        f.waterLevel = w0;
        return rise === 0 ? 0 : turnsUntilLevel(state, w0 + rise);
      }
    }
  } finally {
    f.waterLevel = w0;
  }
  return undefined;
}

/**
 * Turns until tile i floods (you'd wade) and until it's deep (you'd swim). A bridge keeps its
 * deck dry until the water reaches it, and then it's deep at once.
 */
export function floodTimes(state: GameState, i: number): { wade: number; deep: number; bridge: boolean } {
  const f = state.floor;
  if (TERRAIN[f.terrain[i] as number]?.bridge) {
    const n = turnsUntilLevel(state, BRIDGE_DECK);
    return { wade: n, deep: n, bridge: true };
  }
  const e = f.elev[i] as number;
  return { wade: turnsUntilLevel(state, e + 1), deep: turnsUntilLevel(state, e + 2), bridge: false };
}

export function turnsUntilLevel(state: GameState, level: number): number {
  const f = state.floor;
  if (f.waterLevel >= level) return 0;
  const interval = effectiveTideInterval(state);
  return f.tidePaused + f.tideTimer + (level - f.waterLevel - 1) * interval;
}

export function describeItem(it: FloorItem | { item: FloorItem['item'] }): InfoBlock {
  const item = it.item;
  const price = 'price' in it && it.price !== undefined ? ` — ${it.price} pearls` : '';
  const vault = 'vault' in it && it.vault !== undefined ? ' Taking it sinks the other offerings.' : '';
  switch (item.kind) {
    case 'pearls': return { title: `${item.count} pearls`, lines: ['Currency for shrines and the hermit merchant.'] };
    case 'consumable': {
      const d = CONSUMABLES[item.def];
      return { title: `${d?.name ?? item.def}${item.count > 1 ? ` ×${item.count}` : ''}${price}`, color: d?.color, lines: [d?.desc ?? '', vault].filter(Boolean) };
    }
    case 'weapon': {
      const w = WEAPONS[item.def];
      const ups = (item.upgrades ?? []).map((u) => WEAPON_UPGRADES[u]?.name).filter(Boolean);
      return { title: `${w?.name ?? item.def}${price}`, color: w?.color, lines: [`Damage ${w?.dmg}. ${w?.rule ?? ''}`, ups.length ? `Upgrades: ${ups.join(', ')}` : '', 'Swapping leaves your current weapon (and its upgrades) behind.', vault].filter(Boolean) };
    }
    case 'relic': {
      const r = RELICS[item.def];
      return { title: `${r?.name ?? item.def}${price}`, color: r?.color, lines: [r?.desc ?? '', vault].filter(Boolean) };
    }
  }
}

export function describeTile(state: GameState, x: number, y: number): InfoBlock[] {
  const f = state.floor;
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return [];
  const i = y * f.w + x;
  if (!f.seen[i]) return [{ title: 'Unexplored', lines: [] }];
  const out: InfoBlock[] = [];
  const visible = f.vis[i] === 1;
  const p = player(state);
  const a = f.actors.find((q) => !q.dead && q.x === x && q.y === y);
  if (a && visible) {
    if (a.def === 'player') {
      out.push({ title: 'You', lines: [`HP ${Math.ceil(a.hp)}/${a.maxHp}. Breath ${Math.max(0, a.breath)}/${playerMaxBreath(state)}.`] });
    } else if (a.submerged) {
      out.push({ title: 'Ripples', lines: ['Something moves beneath the surface.'] });
    } else out.push(describeMonster(state, a));
  }
  const it = f.items.find((q) => q.x === x && q.y === y);
  if (it && visible) out.push(describeItem(it));
  const ft = f.features.find((q) => q.x === x && q.y === y);
  if (ft) {
    switch (ft.kind) {
      case 'exit':
        out.push({ title: ft.route === 'rift' ? 'The Rift (way up)' : 'The Stair (way up)', color: ft.route === 'rift' ? '#c890ff' : '#ffd86b', lines: [ft.omen ?? '', 'Stand here and press < to climb.'] });
        break;
      case 'entry': out.push({ title: 'Flooded stair', lines: ['The way you came. The sea has already taken it.'] }); break;
      case 'shrine':
        out.push({ title: 'Tide Shrine', color: '#6fe6d2', lines: ft.used ? ['Its offering bowl is full. It will not answer again.'] : SHRINE_OPTIONS.map((o) => `${o.name} (${o.cost} pearls): ${o.desc}`) });
        break;
      case 'spring': out.push({ title: 'Freshwater spring', color: '#8cd2ff', lines: [ft.used ? 'Drunk dry.' : 'Stand on it and press g: heal 12 and cure poison. Useless once the sea covers it.'] }); break;
      case 'merchant': out.push({ title: 'The Hermit', color: '#ffb060', lines: ['An old diver who never left. Walk onto his wares and press g to buy.'] }); break;
      case 'beacon': out.push({ title: 'The Beacon', color: '#ffdc78', lines: [`Stand beside it and press g three turns running to light it${ft.progress ? ` (${ft.progress}/3)` : ''}.`, ft.called ? 'The storm has been called.' : 'The first flame calls the storm: two storm wisps will come for you.'] }); break;
      case 'altar': out.push({ title: 'Offering altar', lines: ['Three relics were laid here. You may take one.'] }); break;
      default: break;
    }
  }
  const t = f.terrain[i] as number;
  const td = TERRAIN[t];
  if (td) {
    const pal = ZONES[f.zone]?.palette[td.key];
    const lines: string[] = [];
    const name = pal?.name ?? td.name;
    const depth = td.flood && (!td.bridge || f.waterLevel >= BRIDGE_DECK) ? rawDepth(f, i) : 0;
    let title = name.charAt(0).toUpperCase() + name.slice(1);
    if ((f.surface[i] as number) === SURF.ICE) {
      title = 'Ice';
      lines.push(`Walkable. Anything stepping onto it slides one more tile. Melts in ${f.surfaceT[i]} turns or when burned.`);
    } else if (depth >= 2) {
      title = `Deep water (${name} below)`;
      lines.push(`Swimming: you lose 1 breath a turn (you have ${Math.max(0, p.breath)}). At 0 you drown, faster each turn.`);
    } else if (depth === 1) {
      title = `Shallow water (${name})`;
      lines.push('Wading makes you Wet: fire hurts half, lightning twice.');
    } else if (pal?.desc ?? td.desc) lines.push(pal?.desc ?? td.desc);
    if ((f.surface[i] as number) === SURF.OIL) lines.push('Slick with lamp oil: it coats whoever steps in, and burns fiercely — even on water.');
    if ((f.fire[i] as number) > 0) lines.push(`On fire (${f.fire[i]} turns of fuel). 2 fire damage and Burning to anyone standing here.`);
    const g = f.gas[i] as number;
    if (g !== GAS.NONE && (f.gasAmt[i] as number) > 3) lines.push(`${(GASES[g]?.name ?? '').replace(/^./, (s) => s.toUpperCase())} (${f.gasAmt[i]}): ${GASES[g]?.desc ?? ''}`);
    if (td.flood) {
      const e = f.elev[i] as number;
      const ft = floodTimes(state, i);
      if (ft.bridge && !isWater(f, i)) lines.push(`The deck stays dry until the water reaches ${BRIDGE_DECK}: ~${ft.deep} turns.`);
      else if (!isWater(f, i)) lines.push(`Ground height ${e}. Floods in ~${ft.wade} turns; deep in ~${ft.deep}.`);
      else if (!isDeep(f, i) && !td.bridge) lines.push(`Deep in ~${ft.deep} turns.`);
    }
    out.push({ title, lines });
  }
  return out;
}

export function describeAbility(key: string): InfoBlock {
  const d = ABILITIES[key];
  if (!d) return { title: key, lines: [] };
  return { title: d.name, color: d.color, lines: [d.desc, `${shapeText(d.shape)} · ${d.charges} per floor`] };
}

export function describeStatus(id: keyof typeof STATUSES): string {
  return STATUSES[id].desc;
}

/** The last blows, with runs of identical ticks (burning, poison, drowning) merged into one line. */
export function recapLines(recap: DamageRecord[]): string[] {
  const groups: { first: DamageRecord; last: DamageRecord; total: number; n: number }[] = [];
  for (const r of recap) {
    const g = groups[groups.length - 1];
    if (g && g.last.source === r.source && g.last.cause === r.cause && g.last.dtype === r.dtype && r.turn - g.last.turn <= 1) {
      g.last = r;
      g.total += r.amount;
      g.n += 1;
    } else groups.push({ first: r, last: r, total: r.amount, n: 1 });
  }
  return groups.map((g) => {
    const when = g.n > 1 ? `turns ${g.first.turn}–${g.last.turn}` : `turn ${g.first.turn}`;
    const kind = g.first.dtype === 'physical' ? '' : `${g.first.dtype} `;
    const from = g.first.source === g.first.cause ? g.first.source : `${g.first.source} (${g.first.cause})`;
    return `${when}: ${g.total} ${kind}damage from ${from}${g.n > 1 ? `, ${g.n} hits` : ''} → ${Math.max(0, g.last.hpAfter)} HP`;
  });
}
