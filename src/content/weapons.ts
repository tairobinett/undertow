// Weapons. Each family has one verb that is used simply by attacking — no charges.
// Upgrades belong to the weapon item: switching weapons gives them up.

export type WeaponVerb = 'sneak' | 'lunge' | 'reach' | 'cleave' | 'knockback' | 'pull' | 'pierce' | 'focus';

export interface WeaponDef {
  key: string;
  name: string;
  color: string;
  dmg: number;
  verb: WeaponVerb;
  /** One-line rule text. */
  rule: string;
  flavor: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  knife: {
    key: 'knife',
    name: 'Gutting Knife',
    color: '#cfd6e0',
    dmg: 3,
    verb: 'sneak',
    rule: 'Sneak attacks (on sleeping or unaware foes) deal triple damage instead of double.',
    flavor: 'A diver\'s knife, thin enough to slip between scales.',
  },
  cutlass: {
    key: 'cutlass',
    name: 'Cutlass',
    color: '#e0c890',
    dmg: 4,
    verb: 'lunge',
    rule: 'Lunge: step straight toward an enemy two tiles away to strike it at once for +2 damage.',
    flavor: 'Short, curved, and made for boarding actions.',
  },
  spear: {
    key: 'spear',
    name: 'Fishing Spear',
    color: '#c8b48a',
    dmg: 4,
    verb: 'reach',
    rule: 'Reach: attack enemies two tiles away in a straight line — across water, fire or a doorway.',
    flavor: 'Long enough to keep the teeth at a distance.',
  },
  axe: {
    key: 'axe',
    name: 'Boarding Axe',
    color: '#d8a080',
    dmg: 4,
    verb: 'cleave',
    rule: 'Cleave: each blow also strikes the two tiles beside your target that are adjacent to you.',
    flavor: 'Built to cut rigging, and whatever is tangled in it.',
  },
  maul: {
    key: 'maul',
    name: 'Anchor Maul',
    color: '#a0a8b8',
    dmg: 5,
    verb: 'knockback',
    rule: 'Knockback: hits drive the target back a tile. Slamming into a wall or creature deals +3 to both.',
    flavor: 'A ship\'s anchor on a haft. Subtle it is not.',
  },
  harpoon: {
    key: 'harpoon',
    name: 'Harpoon',
    color: '#9fd0d0',
    dmg: 3,
    verb: 'pull',
    rule: 'Pull: attack an enemy up to 4 tiles away in a straight line to drag it next to you, then strike.',
    flavor: 'Barbed, on a length of tarred line.',
  },
  trident: {
    key: 'trident',
    name: 'Trident',
    color: '#8fd8ff',
    dmg: 4,
    verb: 'pierce',
    rule: 'Pierce: each blow also strikes the tile behind your target. +2 damage against targets standing in water.',
    flavor: 'Three tines of green bronze, still sharp.',
  },
  staff: {
    key: 'staff',
    name: 'Driftwood Staff',
    color: '#c9a36b',
    dmg: 2,
    verb: 'focus',
    rule: 'Focus: every ability you know gains +1 charge per floor.',
    flavor: 'Salt-bleached wood, humming faintly with the tide.',
  },
};

export interface WeaponUpgradeDef {
  key: string;
  weapon: string | 'any';
  name: string;
  desc: string;
  /** How many times it can be taken. */
  max: number;
}

export const WEAPON_UPGRADES: Record<string, WeaponUpgradeDef> = {
  honed: { key: 'honed', weapon: 'any', name: 'Honed', desc: '+1 damage with this weapon.', max: 3 },
  knife_ghost: { key: 'knife_ghost', weapon: 'knife', name: 'Ghost Blade', desc: 'Killing an enemy makes you Hidden for 3 turns.', max: 1 },
  knife_assassin: { key: 'knife_assassin', weapon: 'knife', name: 'Assassin\'s Grip', desc: 'Sneak attacks deal quadruple damage.', max: 1 },
  cutlass_long: { key: 'cutlass_long', weapon: 'cutlass', name: 'Running Lunge', desc: 'You can lunge from up to 3 tiles away.', max: 1 },
  cutlass_flourish: { key: 'cutlass_flourish', weapon: 'cutlass', name: 'Flourish', desc: 'A lunge also strikes every other enemy adjacent to where you land.', max: 1 },
  spear_long: { key: 'spear_long', weapon: 'spear', name: 'Long Haft', desc: 'Reach extends to 3 tiles.', max: 1 },
  spear_brace: { key: 'spear_brace', weapon: 'spear', name: 'Set Against Charge', desc: 'If you hold your ground, an enemy that steps next to you is struck first (once per turn).', max: 1 },
  axe_whirl: { key: 'axe_whirl', weapon: 'axe', name: 'Whirlwind', desc: 'Cleave strikes every enemy adjacent to you.', max: 1 },
  axe_sunder: { key: 'axe_sunder', weapon: 'axe', name: 'Sunder', desc: 'Ignores 2 armor.', max: 1 },
  maul_heavy: { key: 'maul_heavy', weapon: 'maul', name: 'Heavy Head', desc: 'Knockback drives targets 2 tiles.', max: 1 },
  maul_quake: { key: 'maul_quake', weapon: 'maul', name: 'Concussive', desc: 'Knocked-back targets are Stunned for a turn.', max: 1 },
  harpoon_line: { key: 'harpoon_line', weapon: 'harpoon', name: 'Longer Line', desc: 'Pull reaches 6 tiles.', max: 1 },
  harpoon_barb: { key: 'harpoon_barb', weapon: 'harpoon', name: 'Barbed Head', desc: 'Pulled targets are Rooted for 2 turns.', max: 1 },
  trident_fork: { key: 'trident_fork', weapon: 'trident', name: 'Long Tines', desc: 'Pierce strikes 2 tiles behind the target.', max: 1 },
  trident_tide: { key: 'trident_tide', weapon: 'trident', name: 'Tidecaller', desc: 'Bonus against targets in water rises to +4, and your blows leave them Wet.', max: 1 },
  staff_well: { key: 'staff_well', weapon: 'staff', name: 'Deep Well', desc: 'Every ability gains a further +1 charge per floor.', max: 1 },
  staff_echo: { key: 'staff_echo', weapon: 'staff', name: 'Echoing Focus', desc: 'Your abilities deal +2 damage.', max: 1 },
};
