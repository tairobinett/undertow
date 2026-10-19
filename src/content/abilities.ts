// Player abilities. Charges refill when you climb to a new floor — never by waiting.

import type { EffectSpec, Shape } from './spec.ts';

export type School = 'fire' | 'frost' | 'storm' | 'tide' | 'shadow' | 'body';

export interface AbilityDef {
  key: string;
  name: string;
  school: School;
  color: string;
  /** Base charges per floor. */
  charges: number;
  shape: Shape;
  effect: EffectSpec;
  desc: string;
}

export const ABILITIES: Record<string, AbilityDef> = {
  flare: {
    key: 'flare',
    name: 'Flare',
    school: 'fire',
    color: '#ff8a3d',
    charges: 2,
    shape: { k: 'bolt', range: 7 },
    effect: { dmg: 5, dtype: 'fire', element: 'fire', power: 1 },
    desc: 'Hurl a spark: 5 fire damage to the first thing it hits, and anything flammable where it lands catches fire. Turns water to scalding steam.',
  },
  kindle: {
    key: 'kindle',
    name: 'Kindle',
    school: 'fire',
    color: '#ffb347',
    charges: 2,
    shape: { k: 'burst', radius: 1.5 },
    effect: { dmg: 3, dtype: 'fire', element: 'fire', power: 1 },
    desc: 'Flames burst from your hands: 3 fire damage to everything adjacent, and grass, brush, wood or oil around you catches fire.',
  },
  frost_breath: {
    key: 'frost_breath',
    name: 'Frost Breath',
    school: 'frost',
    color: '#9fe3ff',
    charges: 2,
    shape: { k: 'cone', range: 3 },
    effect: { dmg: 3, dtype: 'cold', element: 'cold', power: 1 },
    desc: 'A cone of freezing air: 3 cold damage, water becomes walkable ice, wet creatures freeze solid.',
  },
  spark: {
    key: 'spark',
    name: 'Spark',
    school: 'storm',
    color: '#ffe96b',
    charges: 2,
    shape: { k: 'bolt', range: 7 },
    effect: { dmg: 5, dtype: 'lightning', element: 'lightning', power: 5 },
    desc: 'A crackling bolt: 5 lightning damage to the first thing it hits. If it strikes water, it arcs through the connected water.',
  },
  thunderclap: {
    key: 'thunderclap',
    name: 'Thunderclap',
    school: 'storm',
    color: '#fff3a0',
    charges: 2,
    shape: { k: 'burst', radius: 1.5 },
    effect: { dmg: 3, dtype: 'lightning', push: 1, status: { id: 'stunned', turns: 1 } },
    desc: 'A deafening crack: 3 lightning damage to everything adjacent, knocking them back and stunning them.',
  },
  surge: {
    key: 'surge',
    name: 'Surge',
    school: 'tide',
    color: '#4fb3ff',
    charges: 2,
    shape: { k: 'wave', length: 4 },
    effect: { dmg: 1, dtype: 'physical', element: 'water', push: 2 },
    desc: 'Call a wave three tiles wide: shoves everything in it 2 tiles, soaks it and douses fire.',
  },
  stillwater: {
    key: 'stillwater',
    name: 'Stillwater',
    school: 'tide',
    color: '#8fc9ff',
    charges: 1,
    shape: { k: 'self' },
    effect: { special: 'stillwater' },
    desc: 'Hold back the sea: the tide stops rising for 12 turns.',
  },
  blink: {
    key: 'blink',
    name: 'Blink',
    school: 'shadow',
    color: '#c7a6ff',
    charges: 2,
    shape: { k: 'tile', range: 5 },
    effect: { special: 'blink' },
    desc: 'Step through the dark to a visible tile up to 5 away.',
  },
  smoke_veil: {
    key: 'smoke_veil',
    name: 'Smoke Veil',
    school: 'shadow',
    color: '#9a9aa8',
    charges: 2,
    shape: { k: 'lob', range: 5, radius: 2 },
    effect: { element: 'smoke', power: 90 },
    desc: 'Throw a cloud of smoke that blocks all sight. Monsters lose track of what they cannot see.',
  },
  second_wind: {
    key: 'second_wind',
    name: 'Second Wind',
    school: 'body',
    color: '#ff9a9a',
    charges: 1,
    shape: { k: 'self' },
    effect: { heal: 8, cleanse: true },
    desc: 'Catch your breath: heal 8 and shake off harmful effects.',
  },
  brace: {
    key: 'brace',
    name: 'Brace',
    school: 'body',
    color: '#c0c8d8',
    charges: 2,
    shape: { k: 'self' },
    effect: { status: { id: 'shielded', turns: 4, power: 3 } },
    desc: 'Set your feet: +3 armor against physical blows for 4 turns.',
  },
};
