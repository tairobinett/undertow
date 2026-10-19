// Zones: floor layout parameters, tide pace, encounter tables and loot.

import type { ZoneId } from '../core/types.ts';

export type Where = 'land' | 'water' | 'shore' | 'chokepoint' | 'grotto' | 'deadend' | 'any' | 'high';

export interface EncounterDef {
  key: string;
  group: [string, number][];
  cost: number;
  where: Where;
  /** Inclusive floor-index range. */
  floors: [number, number];
  weight: number;
}

export interface PaletteEntry {
  fg?: string;
  bg?: string;
  name?: string;
  desc?: string;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  floors: number[];
  size: [number, number];
  ambient: number;
  gen: 'caves' | 'cloister' | 'wreck' | 'surface';
  intro: string;
  /** Things this zone will test you on — shown on arrival. */
  omens: string[];
  floorNames: string[];
  palette: Record<string, PaletteEntry>;
  encounters: EncounterDef[];
  loot: [string, number][];
}

/** Turns per tide rise, by floor index (0-9). */
export const TIDE_INTERVAL = [34, 31, 29, 28, 27, 26, 25, 24, 23, 18];

/** Monster budget by floor index. */
export const THREAT_BUDGET = [7, 10, 12, 12, 14, 13, 23, 27, 30, 16];

export const FLOOR_COUNT = 10;

export const ZONES: Record<ZoneId, ZoneDef> = {
  deep: {
    id: 'deep',
    name: 'The Deep',
    floors: [0, 1, 2],
    size: [50, 32],
    ambient: 0,
    gen: 'caves',
    intro: 'Black water and cold light. Things live beneath the surface here.',
    omens: ['Ripples mean something waits under the water.', 'Glowing jellies electrify the pools around them.', 'Scuttlers hunt in packs.'],
    floorNames: ['The Reliquary Floor', 'Lantern Grottos', 'The Coral Throat', 'Brine Wells', 'The Pale Galleries'],
    palette: {
      floor: { fg: '#3f5a66', bg: '#0b141a', name: 'wet rock', desc: 'Slick, pitted rock.' },
      wall: { fg: '#4b6475', bg: '#16232d', name: 'cave wall', desc: 'Cold, sweating rock.' },
      sand: { fg: '#6f7c78', bg: '#141a1a', name: 'silt', desc: 'Grey silt left by old floods.' },
      brush: { fg: '#3fae8a', bg: '#0a1a17', name: 'tubeweed', desc: 'Tall tubeweed that blocks sight. Dry enough to burn.' },
      grass: { fg: '#4fa07a', bg: '#0b1714', name: 'sea moss', desc: 'Dry sea moss. Catches fire the turn after flames touch it.' },
    },
    encounters: [
      { key: 'drowned_pair', group: [['drowned', 2]], cost: 3, where: 'land', floors: [0, 2], weight: 10 },
      { key: 'drowned_solo', group: [['drowned', 1]], cost: 2, where: 'any', floors: [0, 2], weight: 6 },
      { key: 'scuttlers', group: [['scuttler', 3]], cost: 4, where: 'land', floors: [0, 2], weight: 8 },
      { key: 'scuttlers_big', group: [['scuttler', 5]], cost: 6, where: 'grotto', floors: [1, 2], weight: 5 },
      { key: 'moray', group: [['moray', 1]], cost: 3, where: 'water', floors: [0, 2], weight: 9 },
      { key: 'bloom', group: [['bloom', 1]], cost: 2, where: 'water', floors: [0, 2], weight: 7 },
      { key: 'bloom_pair', group: [['bloom', 2]], cost: 3, where: 'water', floors: [1, 2], weight: 4 },
      { key: 'urchin', group: [['urchin', 1]], cost: 3, where: 'chokepoint', floors: [0, 2], weight: 7 },
      { key: 'urchin_nest', group: [['urchin', 2], ['scuttler', 2]], cost: 7, where: 'land', floors: [1, 2], weight: 4 },
      { key: 'diver', group: [['drowned_diver', 1]], cost: 5, where: 'land', floors: [1, 2], weight: 5 },
      { key: 'angler', group: [['angler', 1]], cost: 7, where: 'water', floors: [2, 2], weight: 6 },
    ],
    loot: [
      ['tonic', 10], ['oil_flask', 4], ['firepot', 4], ['frost_flask', 5], ['shock_jar', 6],
      ['smoke_pot', 3], ['blink_shell', 3], ['air_bladder', 6], ['tide_glass', 3], ['draught', 2],
    ],
  },
  cloister: {
    id: 'cloister',
    name: 'The Sunken Cloister',
    floors: [3, 4, 5],
    size: [56, 34],
    ambient: 0.1,
    gen: 'cloister',
    intro: 'Halls of drowned stone lit by oil lamps that never went out.',
    omens: ['Lamplighters splash oil, then throw fire.', 'Bloats burst into poison — or explode if burned.', 'The Bell Warden\'s toll can be outrun. Its armor cannot be out-muscled.', 'The Drowned Abbot keeps the last floor of the Cloister, Depth 5.'],
    floorNames: ['The Drowned Nave', 'The Scriptorium', 'The Ossuary', 'Cloister Garth', 'The Bell Tower Roots'],
    palette: {
      floor: { fg: '#5d5a52', bg: '#15130f', name: 'flagstones', desc: 'Worn flagstones.' },
      wall: { fg: '#8a8272', bg: '#2e2a22', name: 'cloister wall' },
      grass: { fg: '#6f8f4a', bg: '#141a0f', name: 'weeds' },
      brush: { fg: '#5f7f3a', bg: '#121a0c', name: 'overgrowth' },
    },
    encounters: [
      { key: 'monks', group: [['monk', 2]], cost: 5, where: 'land', floors: [3, 5], weight: 9 },
      { key: 'monk_solo', group: [['monk', 1]], cost: 3, where: 'any', floors: [3, 5], weight: 5 },
      { key: 'lamplighter', group: [['lamplighter', 1], ['monk', 1]], cost: 6, where: 'land', floors: [3, 5], weight: 8 },
      { key: 'lamplighters', group: [['lamplighter', 2]], cost: 6, where: 'land', floors: [4, 5], weight: 4 },
      { key: 'bloats', group: [['bloat', 2]], cost: 3, where: 'any', floors: [3, 5], weight: 7 },
      { key: 'rats', group: [['ossuary_rat', 4]], cost: 5, where: 'deadend', floors: [3, 5], weight: 7 },
      { key: 'wraith', group: [['wraith', 1]], cost: 4, where: 'any', floors: [3, 5], weight: 6 },
      { key: 'warden', group: [['warden', 1]], cost: 8, where: 'high', floors: [4, 5], weight: 5 },
      { key: 'drowned_mob', group: [['drowned', 3]], cost: 4, where: 'water', floors: [3, 4], weight: 4 },
      { key: 'moray_cloister', group: [['moray', 1]], cost: 3, where: 'water', floors: [3, 5], weight: 4 },
    ],
    loot: [
      ['tonic', 10], ['oil_flask', 6], ['firepot', 6], ['frost_flask', 6], ['shock_jar', 5],
      ['smoke_pot', 5], ['blink_shell', 4], ['air_bladder', 4], ['tide_glass', 4], ['draught', 4],
    ],
  },
  caves: {
    id: 'caves',
    name: 'The Wreckers\' Caves',
    floors: [6, 7, 8],
    size: [60, 36],
    ambient: 0.2,
    gen: 'wreck',
    intro: 'Sea caves where wreckers hoard what the rocks take. They are organized, and armed.',
    omens: ['Gunners aim for a turn, fire, then reload for two.', 'Powder monkeys lob bombs a turn ahead.', 'Skuas steal from your belt.', 'The siren\'s song pulls you toward deep water.'],
    floorNames: ['Wreckers\' Landing', 'The Kelp Cathedral', 'Smugglers\' Stair', 'The Salt Vault', 'Gull Rookery'],
    palette: {
      floor: { fg: '#6d6557', bg: '#17140f', name: 'rock shelf', desc: 'A shelf of barnacled rock.' },
      wall: { fg: '#7a6f5f', bg: '#2a241c', name: 'sea cave wall' },
      sand: { fg: '#c2ad80', bg: '#241e14', name: 'sand' },
      brush: { fg: '#5a9a4a', bg: '#0f1a0c', name: 'kelp', desc: 'Drying kelp heaps that block sight. They burn.' },
      grass: { fg: '#7a9a5a', bg: '#141a0f', name: 'sea grass' },
    },
    encounters: [
      { key: 'cutthroats', group: [['cutthroat', 2]], cost: 6, where: 'land', floors: [6, 8], weight: 8 },
      { key: 'gun_team', group: [['gunner', 1], ['cutthroat', 1]], cost: 7, where: 'land', floors: [6, 8], weight: 9 },
      { key: 'gunners', group: [['gunner', 2]], cost: 7, where: 'high', floors: [7, 8], weight: 4 },
      { key: 'monkey', group: [['powder_monkey', 1], ['cutthroat', 1]], cost: 6, where: 'land', floors: [6, 8], weight: 7 },
      { key: 'skuas', group: [['skua', 2]], cost: 4, where: 'any', floors: [6, 8], weight: 6 },
      { key: 'king_crab', group: [['king_crab', 1]], cost: 7, where: 'shore', floors: [6, 8], weight: 5 },
      { key: 'siren', group: [['siren', 1]], cost: 5, where: 'water', floors: [6, 8], weight: 6 },
      { key: 'morays', group: [['moray', 2]], cost: 5, where: 'water', floors: [6, 8], weight: 4 },
      { key: 'scuttler_swarm', group: [['scuttler', 5]], cost: 5, where: 'grotto', floors: [6, 7], weight: 3 },
      { key: 'wrecker_crew', group: [['gunner', 1], ['cutthroat', 2], ['powder_monkey', 1]], cost: 13, where: 'land', floors: [7, 8], weight: 5 },
    ],
    loot: [
      ['tonic', 10], ['oil_flask', 4], ['firepot', 5], ['frost_flask', 5], ['shock_jar', 5],
      ['smoke_pot', 7], ['blink_shell', 5], ['air_bladder', 4], ['tide_glass', 4], ['draught', 5],
    ],
  },
  surface: {
    id: 'surface',
    name: 'The Surface',
    floors: [9],
    size: [56, 34],
    ambient: 0.55,
    gen: 'surface',
    intro: 'Rain. Wind. The lighthouse on the cliff — and behind you, the sea is rising to meet you.',
    omens: ['The rain soaks everything: lightning strikes twice as hard.', 'Storm wisps mark where lightning will fall.', 'Light the beacon (the first flame calls the storm), or drive the Leviathan off.'],
    floorNames: ['The Lighthouse Cliffs'],
    palette: {
      floor: { fg: '#5f6a5a', bg: '#12160f', name: 'wet stone', desc: 'Rain-slick stone.' },
      wall: { fg: '#7b8478', bg: '#262b24', name: 'cliff rock' },
      grass: { fg: '#6aa060', bg: '#0f180d', name: 'storm grass' },
      brush: { fg: '#4f8a4a', bg: '#0c150a', name: 'gorse', desc: 'Thick gorse that blocks sight. Too wet to burn well in the rain.' },
    },
    encounters: [
      { key: 'wisps', group: [['storm_wisp', 2]], cost: 4, where: 'any', floors: [9, 9], weight: 8 },
      { key: 'skuas_s', group: [['skua', 2]], cost: 4, where: 'any', floors: [9, 9], weight: 5 },
      { key: 'wreckers_s', group: [['cutthroat', 1], ['gunner', 1]], cost: 7, where: 'land', floors: [9, 9], weight: 5 },
    ],
    loot: [['tonic', 10], ['draught', 6], ['blink_shell', 5], ['air_bladder', 5], ['smoke_pot', 4]],
  },
};

export function zoneForFloor(index: number): ZoneDef {
  for (const z of Object.values(ZONES)) if (z.floors.includes(index)) return z;
  return ZONES.surface;
}
