// Relics: three slots. Every relic changes a verb or makes a trade — no plain stat sticks.

import type { DamageType, StatusId } from '../core/types.ts';

export interface RelicMods {
  maxHp?: number;
  armor?: number;
  breath?: number;
  lantern?: number;
  damage?: number;
  /** Multiplies the tide interval (>1 = slower tide). */
  tideMult?: number;
  pearlMult?: number;
  abilityCharges?: number;
  abilityDamage?: number;
  resist?: Partial<Record<DamageType, number>>;
  immune?: StatusId[];
  /** Multiplier on the noise you make. */
  noise?: number;
  /** Monsters only notice you within this many tiles. */
  stealthRange?: number;
}

export interface RelicDef {
  key: string;
  name: string;
  color: string;
  tags: string[];
  mods?: RelicMods;
  /** Named behaviours implemented in the engine. */
  hooks?: string[];
  desc: string;
  price: number;
}

export const RELICS: Record<string, RelicDef> = {
  salamander_scale: {
    key: 'salamander_scale', name: 'Salamander Scale', color: '#ff7a2f', tags: ['fire'],
    mods: { resist: { fire: 0, cold: 2 }, immune: ['burning'] },
    desc: 'You are immune to fire and Burning. Cold damage against you is doubled.', price: 45,
  },
  ember_heart: {
    key: 'ember_heart', name: 'Ember Heart', color: '#ff9a4a', tags: ['fire'], hooks: ['ember_heart'],
    desc: 'Your fire damage is +2, and creatures you set Burning burn for 3 extra turns.', price: 40,
  },
  tar_gauntlets: {
    key: 'tar_gauntlets', name: 'Tarred Gauntlets', color: '#d9a441', tags: ['fire', 'melee'], hooks: ['oil_gloves'],
    desc: 'Your melee blows coat targets in oil (Oiled: fire damage doubled, sets them Burning).', price: 35,
  },
  rime_anklet: {
    key: 'rime_anklet', name: 'Rime Anklet', color: '#bfefff', tags: ['frost', 'tide'], hooks: ['rime_step'],
    desc: 'Water freezes beneath your feet as you step: you walk on water, and never slip on ice.', price: 45,
  },
  frostbite_ring: {
    key: 'frostbite_ring', name: 'Frostbite Ring', color: '#9fe3ff', tags: ['frost', 'melee'], hooks: ['frostbite'],
    desc: 'Your melee blows Chill their target. Wet targets freeze solid instead.', price: 40,
  },
  heart_of_winter: {
    key: 'heart_of_winter', name: 'Heart of Winter', color: '#dff4ff', tags: ['frost'], hooks: ['heart_of_winter'],
    desc: 'Frozen creatures take triple damage from your blows (instead of double).', price: 40,
  },
  eelskin: {
    key: 'eelskin', name: 'Eelskin Mantle', color: '#7fd7c0', tags: ['storm', 'tide'], hooks: ['eelskin'],
    mods: { resist: { lightning: 0 } },
    desc: 'You are immune to lightning. While you are Wet, anything that strikes you in melee takes 3 lightning.', price: 45,
  },
  stormglass: {
    key: 'stormglass', name: 'Stormglass', color: '#ffe96b', tags: ['storm'], hooks: ['stormglass'],
    desc: 'Your lightning damage is +2 and arcs twice as far through water.', price: 40,
  },
  gillcharm: {
    key: 'gillcharm', name: 'Gillcharm', color: '#5fd0ff', tags: ['tide'], hooks: ['gillcharm'],
    mods: { breath: 8 },
    desc: '+8 breath, and you fight at full strength while swimming.', price: 35,
  },
  tide_pearl: {
    key: 'tide_pearl', name: 'Tide Pearl', color: '#e8f4ff', tags: ['tide', 'melee'], hooks: ['tide_pearl'],
    desc: 'While you stand in water, your attacks deal +2 damage.', price: 35,
  },
  tidewatch: {
    key: 'tidewatch', name: 'Tidewatch', color: '#8fc9ff', tags: ['tide'],
    mods: { tideMult: 1.35 },
    desc: 'A drowned captain\'s watch. The tide rises a third slower.', price: 45,
  },
  riptide_boots: {
    key: 'riptide_boots', name: 'Riptide Boots', color: '#4fb3ff', tags: ['tide'], hooks: ['riptide'],
    desc: 'In water you are Hasted: you act twice per turn.', price: 45,
  },
  anchor_charm: {
    key: 'anchor_charm', name: 'Anchor Charm', color: '#a0a8b8', tags: ['defense'], hooks: ['anchor'],
    mods: { armor: 1 },
    desc: '+1 armor, and nothing can push, pull or knock you back.', price: 30,
  },
  silent_soles: {
    key: 'silent_soles', name: 'Silent Soles', color: '#7a7aa8', tags: ['shadow'],
    mods: { noise: 0.4 },
    desc: 'You make far less noise: sleeping creatures stay asleep unless you come close.', price: 30,
  },
  dark_lantern: {
    key: 'dark_lantern', name: 'Hooded Lantern', color: '#6a6a88', tags: ['shadow'],
    mods: { lantern: -3, stealthRange: 3 },
    desc: 'Your light shrinks by 3 — but monsters only notice you within 3 tiles.', price: 35,
  },
  coral_heart: {
    key: 'coral_heart', name: 'Coral Heart', color: '#ff8fa8', tags: ['defense'],
    mods: { maxHp: 12, breath: -2 },
    desc: '+12 max HP, but −2 breath: it sits heavy in your chest.', price: 35,
  },
  leech_hook: {
    key: 'leech_hook', name: 'Leech Hook', color: '#c05a6a', tags: ['melee'], hooks: ['leech'],
    desc: 'Heal 2 whenever a creature dies by your hand.', price: 40,
  },
  brine_blood: {
    key: 'brine_blood', name: 'Brine Blood', color: '#9fd356', tags: ['defense'], hooks: ['brine_blood'],
    mods: { immune: ['poisoned'] },
    desc: 'You are immune to poison, and miasma heals you 1 per turn instead.', price: 30,
  },
  barnacle_plate: {
    key: 'barnacle_plate', name: 'Barnacle Plate', color: '#9a9080', tags: ['defense'],
    mods: { armor: 2, breath: -3 },
    desc: '+2 armor, but −3 breath. You sink like a stone.', price: 35,
  },
  pearl_divers_charm: {
    key: 'pearl_divers_charm', name: 'Pearl Diver\'s Charm', color: '#f0e6ff', tags: ['greed'],
    mods: { pearlMult: 1.6 },
    desc: 'You find 60% more pearls.', price: 20,
  },
  tide_chart: {
    key: 'tide_chart', name: 'Tide Chart', color: '#d8c89a', tags: ['greed'], hooks: ['cartographer'],
    desc: 'On each new floor you already know the layout — exits, vaults and shrines included.', price: 30,
  },
  glass_heart: {
    key: 'glass_heart', name: 'Glass Heart', color: '#ff5f7a', tags: ['melee', 'curse'],
    mods: { damage: 3, maxHp: -10 },
    desc: '+3 damage with every blow. −10 max HP.', price: 30,
  },
  drowned_idol: {
    key: 'drowned_idol', name: 'Drowned Idol', color: '#5f8f7a', tags: ['curse'],
    mods: { abilityCharges: 1, tideMult: 0.8 },
    desc: 'Every ability gains +1 charge per floor. The tide rises 25% faster.', price: 35,
  },
};
