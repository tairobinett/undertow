// Belt items: the "outs". Four belt slots, stacks of up to three.

import type { EffectSpec, Shape } from './spec.ts';

export interface ConsumableDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  /** 'drink' affects you; 'throw'/'use' need a target. */
  use: 'drink' | 'throw' | 'use';
  shape: Shape;
  effect: EffectSpec;
  desc: string;
  /** Merchant price in pearls. */
  price: number;
}

export const MAX_STACK = 3;

export const CONSUMABLES: Record<string, ConsumableDef> = {
  tonic: {
    key: 'tonic',
    name: 'Brine Tonic',
    glyph: '!',
    color: '#ff6b6b',
    use: 'drink',
    shape: { k: 'self' },
    effect: { heal: 10 },
    desc: 'Heals 10.',
    price: 12,
  },
  draught: {
    key: 'draught',
    name: 'Coral Draught',
    glyph: '!',
    color: '#ff9ad5',
    use: 'drink',
    shape: { k: 'self' },
    effect: { heal: 20, cleanse: true },
    desc: 'Heals 20 and cures poison, burning, chills and oil.',
    price: 24,
  },
  oil_flask: {
    key: 'oil_flask',
    name: 'Oil Flask',
    glyph: '!',
    color: '#d9a441',
    use: 'throw',
    shape: { k: 'lob', range: 6, radius: 1 },
    effect: { element: 'oil' },
    desc: 'Shatters into a slick of lamp oil (radius 1). Oiled creatures take double fire damage. Oil floats on water.',
    price: 8,
  },
  firepot: {
    key: 'firepot',
    name: 'Firepot',
    glyph: '!',
    color: '#ff7a2f',
    use: 'throw',
    shape: { k: 'lob', range: 6, radius: 1 },
    effect: { dmg: 4, dtype: 'fire', element: 'fire', power: 1, special: 'firepot' },
    desc: 'Bursts into flame (radius 1): 4 fire damage to everything in it (you too, if you are), and sets the area alight — even on water, if there is oil.',
    price: 14,
  },
  frost_flask: {
    key: 'frost_flask',
    name: 'Frost Flask',
    glyph: '!',
    color: '#bfefff',
    use: 'throw',
    shape: { k: 'lob', range: 6, radius: 1 },
    effect: { dmg: 3, dtype: 'cold', element: 'cold', power: 1 },
    desc: 'Freezing burst (radius 1): 3 cold damage, turns water to ice, freezes wet creatures solid — you too, if you are in it.',
    price: 14,
  },
  shock_jar: {
    key: 'shock_jar',
    name: 'Shock Jar',
    glyph: '!',
    color: '#ffe96b',
    use: 'throw',
    shape: { k: 'lob', range: 6, radius: 0 },
    effect: { dmg: 6, dtype: 'lightning', element: 'lightning', power: 6 },
    desc: '6 lightning damage where it lands. In water, the charge arcs up to 6 tiles through the connected water.',
    price: 14,
  },
  smoke_pot: {
    key: 'smoke_pot',
    name: 'Smoke Pot',
    glyph: '!',
    color: '#b0b0bc',
    use: 'throw',
    shape: { k: 'lob', range: 6, radius: 2 },
    effect: { element: 'smoke', power: 90 },
    desc: 'A choking cloud (radius 2) that blocks all sight. Monsters lose track of what they cannot see.',
    price: 10,
  },
  blink_shell: {
    key: 'blink_shell',
    name: 'Blink Shell',
    glyph: '?',
    color: '#c7a6ff',
    use: 'use',
    shape: { k: 'tile', range: 6 },
    effect: { special: 'blink' },
    desc: 'Hold it to your ear and step through to any visible tile up to 6 away.',
    price: 16,
  },
  air_bladder: {
    key: 'air_bladder',
    name: 'Air Bladder',
    glyph: '?',
    color: '#7fd7ff',
    use: 'drink',
    shape: { k: 'self' },
    effect: { status: { id: 'gills', turns: 15 }, special: 'refill_breath' },
    desc: 'Refills your breath, and for 15 turns your breath does not drop while swimming.',
    price: 10,
  },
  tide_glass: {
    key: 'tide_glass',
    name: 'Tide Glass',
    glyph: '?',
    color: '#8fc9ff',
    use: 'drink',
    shape: { k: 'self' },
    effect: { special: 'tide_glass' },
    desc: 'Turn the little hourglass: the tide stops rising for 15 turns.',
    price: 18,
  },
};
