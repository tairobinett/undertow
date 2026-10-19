// Boons offered on each climb (choose 1 of 3), and their application.
// Boon ids: static keys ('vigor'), 'up:<upgrade>', 'learn:<ability>', 'charge:<ability>'.

import { ABILITIES } from '../content/abilities.ts';
import { STATIC_BOONS } from '../content/boons.ts';
import type { BoonGroup } from '../content/boons.ts';
import { WEAPON_UPGRADES, WEAPONS } from '../content/weapons.ts';
import { heal } from './effects.ts';
import { float } from './rng.ts';
import { log, player, playerMaxBreath, playerMaxHp, upgradeCount } from './state.ts';
import { refreshAbilityMax } from './player.ts';
import type { GameState } from './types.ts';

export interface BoonView {
  id: string;
  name: string;
  desc: string;
  group: BoonGroup;
}

function timesTaken(state: GameState, id: string): number {
  return state.build.boons.filter((b) => b === id).length;
}

export function describeBoon(state: GameState, id: string): BoonView {
  if (id.startsWith('up:')) {
    const u = WEAPON_UPGRADES[id.slice(3)];
    const wname = WEAPONS[state.build.weapon.def]?.name ?? 'weapon';
    return { id, name: `${u?.name ?? id} (${wname})`, desc: u?.desc ?? '', group: 'weapon' };
  }
  if (id.startsWith('learn:')) {
    const a = ABILITIES[id.slice(6)];
    return { id, name: `Learn ${a?.name ?? id}`, desc: `${a?.desc ?? ''} (${a?.charges ?? 1} per floor)`, group: 'arcana' };
  }
  if (id.startsWith('charge:')) {
    const a = ABILITIES[id.slice(7)];
    return { id, name: `${a?.name ?? id} +1`, desc: `+1 charge per floor for ${a?.name ?? id}.`, group: 'arcana' };
  }
  const b = STATIC_BOONS[id];
  return { id, name: b?.name ?? id, desc: b?.desc ?? '', group: b?.group ?? 'vital' };
}

function candidates(state: GameState): Record<BoonGroup, [string, number][]> {
  const out: Record<BoonGroup, [string, number][]> = { vital: [], weapon: [], arcana: [] };
  const p = player(state);
  const hurt = p.hp < p.maxHp * 0.5;
  for (const b of Object.values(STATIC_BOONS)) {
    if (timesTaken(state, b.key) >= (b.max ?? 1)) continue;
    if (b.key === 'relic_slot' && state.build.relicSlots >= 4) continue;
    if (b.key === 'belt_slot' && state.build.belt.length >= 5) continue;
    let w = b.weight;
    if (b.key === 'mend') w = hurt ? 14 : p.hp >= p.maxHp ? 0 : 4;
    if (w > 0) out[b.group].push([b.key, w]);
  }
  const wkey = state.build.weapon.def;
  for (const u of Object.values(WEAPON_UPGRADES)) {
    if (u.weapon !== 'any' && u.weapon !== wkey) continue;
    if (upgradeCount(state, u.key) >= u.max) continue;
    out.weapon.push([`up:${u.key}`, u.weapon === 'any' ? 6 : 10]);
  }
  const known = new Set(state.build.abilities.map((a) => a.def));
  const canLearn = state.build.abilities.length < state.build.abilitySlots;
  for (const a of Object.values(ABILITIES)) {
    if (known.has(a.key)) {
      if (timesTaken(state, `charge:${a.key}`) < 2) out.arcana.push([`charge:${a.key}`, 4]);
    } else if (canLearn) {
      out.arcana.push([`learn:${a.key}`, 6]);
    }
  }
  return out;
}

function pickWeighted(state: GameState, list: [string, number][], exclude: Set<string>): string | undefined {
  const avail = list.filter(([k]) => !exclude.has(k));
  let total = 0;
  for (const [, w] of avail) total += w;
  if (total <= 0) return undefined;
  let r = float(state.rng) * total;
  for (const [k, w] of avail) {
    r -= w;
    if (r < 0) return k;
  }
  return avail[avail.length - 1]?.[0];
}

/** Rolls three boons: one per group where possible. */
export function rollBoons(state: GameState): string[] {
  const c = candidates(state);
  const chosen: string[] = [];
  const ex = new Set<string>();
  for (const g of ['vital', 'weapon', 'arcana'] as BoonGroup[]) {
    const k = pickWeighted(state, c[g], ex);
    if (k) {
      chosen.push(k);
      ex.add(k);
    }
  }
  const all = [...c.vital, ...c.weapon, ...c.arcana];
  while (chosen.length < 3) {
    const k = pickWeighted(state, all, ex);
    if (!k) break;
    chosen.push(k);
    ex.add(k);
  }
  return chosen;
}

export function applyBoon(state: GameState, id: string): void {
  const b = state.build;
  const p = player(state);
  b.boons.push(id);
  if (id.startsWith('up:')) {
    b.weapon.upgrades.push(id.slice(3));
    refreshAbilityMax(state);
    log(state, `Your ${WEAPONS[b.weapon.def]?.name} is improved: ${WEAPON_UPGRADES[id.slice(3)]?.name}.`, 'good');
    return;
  }
  if (id.startsWith('learn:')) {
    const key = id.slice(6);
    const d = ABILITIES[key];
    if (d) {
      b.abilities.push({ def: key, charges: 0, max: 0 });
      refreshAbilityMax(state);
      const ab = b.abilities[b.abilities.length - 1];
      if (ab) ab.charges = ab.max;
      log(state, `You learn ${d.name}.`, 'good');
    }
    return;
  }
  if (id.startsWith('charge:')) {
    refreshAbilityMax(state);
    const ab = b.abilities.find((a) => a.def === id.slice(7));
    if (ab) ab.charges = Math.min(ab.max, ab.charges + 1);
    log(state, 'You feel your power deepen.', 'good');
    return;
  }
  const s = STATIC_BOONS[id];
  if (!s) return;
  const e = s.effect;
  if (e.maxHp) {
    b.maxHpBonus += e.maxHp;
    const max = playerMaxHp(state);
    p.hp += max - p.maxHp;
    p.maxHp = max;
  }
  if (e.heal) heal(state, p, e.heal, true);
  if (e.healPct) heal(state, p, Math.ceil(p.maxHp * e.healPct), true);
  if (e.armor) b.armor += e.armor;
  if (e.breath) {
    b.maxBreath += e.breath;
    p.breath = playerMaxBreath(state);
  }
  if (e.pearls) b.pearls += e.pearls;
  if (e.relicSlot) b.relicSlots += e.relicSlot;
  if (e.beltSlot) b.belt.push(null);
  if (e.lantern) b.lantern += e.lantern;
  log(state, `${s.name}: ${s.desc}`, 'good');
}
