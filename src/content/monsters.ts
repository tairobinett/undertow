// Monsters. Every monster should change what the right move is — no stat bags.
// Strong attacks have a wind-up (windup >= 1) and are drawn on the map before they land.

import type { DamageType, MoveMode } from '../core/types.ts';
import type { EffectSpec, Shape } from './spec.ts';

export type BrainId =
  | 'melee'
  | 'ranged'
  | 'turret'
  | 'aquatic'
  | 'drifter'
  | 'bomber'
  | 'skirmisher'
  | 'thief'
  | 'siren'
  | 'summoner'
  | 'abbot'
  | 'leviathan';

export type AbilityWhen =
  /** Target is adjacent. */
  | 'adjacent'
  /** Target is within range and in line of sight. */
  | 'inRange'
  /** A creature is standing in water within range (for water-borne attacks). */
  | 'waterNear'
  /** Hurt below half health. */
  | 'hurt'
  /** Any time the monster is hunting. */
  | 'hunting';

export interface MonsterAbility {
  key: string;
  name: string;
  shape: Shape;
  effect: EffectSpec;
  /** Turns of wind-up before it resolves (0 = immediate). */
  windup: number;
  cooldown: number;
  when: AbilityWhen;
  minRange?: number;
  /** Lands only if the user can still see its target (brush, smoke and hiding break it). */
  needsSight?: boolean;
  /** Message when winding up: "{name} {telegraph}". */
  telegraph: string;
  /** Message when it resolves. */
  verb: string;
}

export interface MonsterDef {
  key: string;
  name: string;
  glyph: string;
  color: string;
  hp: number;
  /** Basic melee damage (0 = no melee). */
  dmg: number;
  armor?: number;
  /** 100 = normal, 200 = fast, 50 = slow. */
  speed?: number;
  move: MoveMode;
  /** Undead and constructs don't breathe (they walk underwater). */
  breathes?: boolean;
  sight: number;
  tags: string[];
  /** Damage multipliers by type (0 = immune, 0.5 = resist, 2 = weak). */
  resist?: Partial<Record<DamageType, number>>;
  brain: BrainId;
  abilities?: MonsterAbility[];
  light?: number;
  /** Chance to be asleep when the floor is generated. */
  sleep?: number;
  /** Hides beneath the water surface until it strikes. */
  submerge?: boolean;
  /** Flees below this fraction of HP. */
  flee?: number;
  /** Pearls dropped on death. */
  pearls?: number;
  /** Special on-death behaviour. */
  onDeath?: 'burst_miasma' | 'drop_stolen';
  boss?: boolean;
  desc: string;
  /** Tactical note shown in the inspect panel. */
  tip: string;
}

const M: Record<string, MonsterDef> = {};
function mon(d: MonsterDef): void {
  M[d.key] = d;
}

// ===========================================================================
// Zone I — The Deep (floors 1-3): dark water, things beneath the surface.

mon({
  key: 'drowned', name: 'Drowned Sailor', glyph: 'z', color: '#8fb3a0',
  hp: 9, dmg: 3, speed: 50, move: 'walk', breathes: false, sight: 6,
  tags: ['undead'], brain: 'melee', sleep: 0.5,
  desc: 'A sailor the sea gave back, barnacled and slow.',
  tip: 'Slow — acts every other turn. It does not breathe, so deep water will not stop it.',
});

mon({
  key: 'scuttler', name: 'Scuttler', glyph: 'c', color: '#e8844a',
  hp: 4, dmg: 2, armor: 1, move: 'walk', sight: 5,
  tags: ['beast', 'small', 'pack'], brain: 'melee', sleep: 0.35,
  desc: 'A pale crab the size of a dog. They never come alone.',
  tip: 'Comes in packs. Armor 1 dulls weak blows — fight them where only one can reach you.',
});

mon({
  key: 'moray', name: 'Moray', glyph: 'e', color: '#5fb89a',
  hp: 8, dmg: 4, move: 'swim', sight: 4, tags: ['beast', 'aquatic'], brain: 'aquatic', submerge: true,
  desc: 'A long, patient eel.',
  tip: 'Hides under the surface (watch for ripples) and bites anything next to its water. It cannot leave the water — and the water rises.',
});

mon({
  key: 'bloom', name: 'Bloom Jelly', glyph: 'j', color: '#d58fe0',
  hp: 5, dmg: 0, speed: 50, move: 'swim', sight: 3, tags: ['aquatic'], brain: 'drifter', light: 2,
  resist: { lightning: 0 },
  abilities: [
    {
      key: 'discharge', name: 'Discharge', shape: { k: 'burst', radius: 2.5, includeSelf: false },
      effect: { dmg: 4, dtype: 'lightning', element: 'lightning', power: 3 }, windup: 1, cooldown: 4, when: 'waterNear',
      telegraph: 'begins to glow', verb: 'discharges into the water',
    },
  ],
  desc: 'A drifting bell of light, trailing stinging threads.',
  tip: 'When anything wades near, it glows for a turn, then electrifies the water around it. The charge travels through connected water — lure enemies in.',
});

mon({
  key: 'urchin', name: 'Spine Urchin', glyph: 'u', color: '#b07ad8',
  hp: 6, dmg: 0, armor: 2, move: 'walk', sight: 6, tags: ['beast', 'rooted'], brain: 'turret',
  abilities: [
    {
      key: 'spines', name: 'Spine Volley', shape: { k: 'ray', range: 6 },
      effect: { dmg: 4, dtype: 'physical' }, windup: 1, cooldown: 2, when: 'inRange',
      telegraph: 'bristles, aiming its spines', verb: 'fires a volley of spines',
    },
  ],
  desc: 'A violet pincushion clamped to the rock.',
  tip: 'Rooted in place: it aims a line for one turn, then fires down it. Step out of the line, or put something in the way. Knockback cannot move it, but still breaks its aim.',
});

mon({
  key: 'angler', name: 'Angler', glyph: 'A', color: '#e6c74c',
  hp: 18, dmg: 5, move: 'swim', sight: 7, tags: ['beast', 'aquatic', 'elite'], brain: 'aquatic', light: 3, pearls: 6,
  abilities: [
    {
      key: 'lunge', name: 'Lunge', shape: { k: 'ray', range: 3 },
      effect: { dmg: 8, dtype: 'physical' }, windup: 1, cooldown: 3, when: 'inRange', minRange: 2,
      telegraph: 'coils in the water', verb: 'lunges out of the water',
    },
  ],
  desc: 'A lure of cold light, and beneath it a mouth.',
  tip: 'Its lure lights the water. Before it strikes it coils — get out of the marked line. It cannot leave the water.',
});

mon({
  key: 'drowned_diver', name: 'Drowned Diver', glyph: 'Z', color: '#6fa0b8',
  hp: 14, dmg: 4, move: 'walk', breathes: false, sight: 7, tags: ['undead'], brain: 'melee', sleep: 0.3, pearls: 4,
  abilities: [
    {
      key: 'harpoon', name: 'Harpoon', shape: { k: 'ray', range: 5 },
      effect: { dmg: 3, dtype: 'physical', pull: 4 }, windup: 1, cooldown: 4, when: 'inRange', minRange: 2,
      telegraph: 'levels a rusted harpoon', verb: 'fires its harpoon',
    },
  ],
  desc: 'Someone who came for the Tidestone before you.',
  tip: 'It aims a harpoon for a turn, then drags whatever it hits to its side. Break the line.',
});

// ===========================================================================
// Zone II — The Sunken Cloister (floors 4-6): oil, fire, the restless dead.

mon({
  key: 'monk', name: 'Drowned Monk', glyph: 'm', color: '#93a7c2',
  hp: 14, dmg: 4, move: 'walk', breathes: false, sight: 6, tags: ['undead'], brain: 'melee', sleep: 0.45,
  abilities: [
    {
      key: 'grasp', name: 'Drowning Grasp', shape: { k: 'melee' },
      effect: { dmg: 6, dtype: 'physical', status: { id: 'rooted', turns: 2 } }, windup: 1, cooldown: 3, when: 'adjacent',
      telegraph: 'reaches for you with both hands', verb: 'clutches',
    },
  ],
  desc: 'Still at prayer, a century underwater.',
  tip: 'Before it grabs, it reaches out for a turn — step away and the grasp closes on nothing.',
});

mon({
  key: 'lamplighter', name: 'Lamplighter', glyph: 'l', color: '#ffae42',
  hp: 10, dmg: 3, move: 'walk', sight: 7, tags: ['human'], brain: 'ranged', flee: 0.3, pearls: 3,
  abilities: [
    {
      key: 'douse', name: 'Douse', shape: { k: 'lob', range: 5, radius: 1 },
      effect: { element: 'oil' }, windup: 1, cooldown: 5, when: 'inRange', minRange: 2,
      telegraph: 'swings back a jug of lamp oil', verb: 'splashes oil',
    },
    {
      key: 'torch', name: 'Torch', shape: { k: 'lob', range: 6, radius: 0 },
      effect: { dmg: 1, dtype: 'fire', element: 'fire', power: 1 }, windup: 1, cooldown: 3, when: 'inRange',
      telegraph: 'raises a burning torch', verb: 'hurls the torch',
    },
  ],
  desc: 'Keeper of the cloister lamps. Still devoted to the flame.',
  tip: 'Splashes oil, then throws a torch. Get out of the slick — or lure its friends into it. With both in hand it keeps its distance; once it has thrown them, close in.',
});

mon({
  key: 'bloat', name: 'Censer Bloat', glyph: 'b', color: '#c8c85a',
  hp: 4, dmg: 0, speed: 50, move: 'fly', breathes: false, sight: 6, tags: ['construct'], brain: 'bomber',
  resist: { poison: 0 }, onDeath: 'burst_miasma',
  abilities: [
    {
      key: 'burst', name: 'Burst', shape: { k: 'burst', radius: 1.5, includeSelf: true },
      effect: { special: 'self_destruct' }, windup: 1, cooldown: 1, when: 'adjacent',
      telegraph: 'swells, straining at its seams', verb: 'bursts',
    },
  ],
  desc: 'A swollen censer drifting on its own foul breath.',
  tip: 'Pops into poison gas when killed or when it swells beside you, and the cloud drifts and lingers for a while. If fire touches it, it explodes instead. Kill it at range or knock it away.',
});

mon({
  key: 'ossuary_rat', name: 'Ossuary Rat', glyph: 'r', color: '#b89c7a',
  hp: 3, dmg: 2, speed: 200, move: 'walk', sight: 6, tags: ['beast', 'small', 'pack'], brain: 'melee', sleep: 0.3,
  desc: 'Fat on old bones.',
  tip: 'Fast — two moves a turn — and in packs. Make them come through a doorway.',
});

mon({
  key: 'wraith', name: 'Choir Wraith', glyph: 'W', color: '#b9a3ff',
  hp: 10, dmg: 3, move: 'phase', breathes: false, sight: 7, tags: ['undead', 'spirit'], brain: 'melee',
  resist: { physical: 0.5, cold: 0 },
  abilities: [
    {
      key: 'wail', name: 'Wail', shape: { k: 'cone', range: 3 },
      effect: { dmg: 3, dtype: 'cold', element: 'cold', status: { id: 'chilled', turns: 2 } }, windup: 1, cooldown: 5, when: 'inRange',
      telegraph: 'draws a long, rattling breath', verb: 'wails',
    },
  ],
  desc: 'The last note of a drowned hymn.',
  tip: 'Drifts through walls. Physical blows only half land — fire and lightning hurt it fully. Its wail chills you (you act at half speed) and freezes wet things: step out of the cone.',
});

mon({
  key: 'warden', name: 'Bell Warden', glyph: 'G', color: '#c9b37a',
  hp: 30, dmg: 6, armor: 3, speed: 50, move: 'walk', breathes: false, sight: 6, tags: ['construct', 'metal', 'elite'],
  brain: 'melee', resist: { lightning: 2, fire: 0.5, poison: 0 }, pearls: 8,
  abilities: [
    {
      key: 'toll', name: 'Toll', shape: { k: 'burst', radius: 2.5 },
      effect: { dmg: 7, dtype: 'physical', status: { id: 'stunned', turns: 1 } }, windup: 2, cooldown: 5, when: 'inRange',
      telegraph: 'lifts its great bell', verb: 'brings the bell down',
    },
  ],
  desc: 'A bronze guardian with a bell for a head.',
  tip: 'Armored and slow. When it lifts its bell (two turns), get clear of the ring. Lightning rings right through it.',
});

mon({
  key: 'faithful', name: 'Drowned Faithful', glyph: 'm', color: '#7f95ad',
  hp: 6, dmg: 2, move: 'walk', breathes: false, sight: 8, tags: ['undead', 'summoned'], brain: 'melee',
  desc: 'A cloistered soul the Abbot will not let rest.',
  tip: 'Raised from the water by the Abbot. Frail, and never more than two or three at once — but he calls more as they fall, while the water lasts.',
});

mon({
  key: 'abbot', name: 'The Drowned Abbot', glyph: 'P', color: '#9fe0c8',
  hp: 60, dmg: 5, move: 'walk', breathes: false, sight: 9, tags: ['undead', 'boss'], brain: 'abbot', boss: true, pearls: 25,
  resist: { cold: 0.5 },
  abilities: [
    {
      key: 'raise', name: 'Raise the Faithful', shape: { k: 'self' },
      effect: { special: 'raise_drowned' }, windup: 1, cooldown: 7, when: 'hunting',
      telegraph: 'lifts his hands toward the water', verb: 'calls the drowned up from the water',
    },
    {
      key: 'censer', name: 'Censer Swing', shape: { k: 'lob', range: 6, radius: 1 },
      effect: { dmg: 2, dtype: 'fire', element: 'fire', power: 1, special: 'firepot' }, windup: 1, cooldown: 4, when: 'inRange', minRange: 2,
      telegraph: 'swings his burning censer', verb: 'casts burning oil',
    },
    {
      key: 'toll', name: 'Last Rites', shape: { k: 'burst', radius: 1.5 },
      effect: { dmg: 8, dtype: 'cold', element: 'cold', push: 1 }, windup: 1, cooldown: 3, when: 'adjacent',
      telegraph: 'begins the last rites', verb: 'speaks the last rites',
    },
  ],
  desc: 'He opened the sea-doors to save the cloister. It did not work.',
  tip: 'Raises his drowned faithful out of any water near him, never more than two at a time (three once he is below half health) — and the water keeps rising. Burning oil at range: in grass or brush the fire spreads and lingers, so meet him on stone (or wet). Cold rites up close. Nothing interrupts him: when he begins the rites, step two tiles away.',
});

// ===========================================================================
// Zone III — The Wreckers' Caves (floors 7-9): coordinated humans, the siren.

mon({
  key: 'cutthroat', name: 'Wrecker Cutthroat', glyph: 'h', color: '#d0605a',
  hp: 16, dmg: 6, move: 'walk', sight: 7, tags: ['human'], brain: 'melee', sleep: 0.25, pearls: 3,
  abilities: [
    {
      key: 'slash', name: 'Reckless Slash', shape: { k: 'melee' },
      effect: { dmg: 11, dtype: 'physical' }, windup: 1, cooldown: 3, when: 'adjacent',
      telegraph: 'draws back for a heavy slash', verb: 'slashes',
    },
  ],
  desc: 'Lures ships onto the rocks, then collects.',
  tip: 'Winds up a heavy slash — step away or take 11.',
});

mon({
  key: 'gunner', name: 'Wrecker Gunner', glyph: 'g', color: '#e09a6a',
  hp: 12, dmg: 3, move: 'walk', sight: 9, tags: ['human'], brain: 'ranged', flee: 0.25, pearls: 4,
  abilities: [
    {
      key: 'musket', name: 'Musket', shape: { k: 'ray', range: 9 },
      effect: { dmg: 10, dtype: 'physical' }, windup: 1, cooldown: 3, when: 'inRange', minRange: 2,
      telegraph: 'shoulders a musket and takes aim', verb: 'fires',
    },
  ],
  desc: 'A wrecker with a long gun and a steady hand.',
  tip: 'Aims for a turn, fires down the line, then needs two turns to reload. Close in while it reloads, or break line of sight. The shot hits whatever is in the way.',
});

mon({
  key: 'powder_monkey', name: 'Powder Monkey', glyph: 'p', color: '#e6a23c',
  hp: 8, dmg: 2, move: 'walk', sight: 8, tags: ['human', 'small'], brain: 'skirmisher', flee: 0.5, pearls: 3,
  abilities: [
    {
      key: 'bomb', name: 'Powder Bomb', shape: { k: 'lob', range: 6, radius: 1 },
      effect: { dmg: 6, dtype: 'fire', element: 'fire', power: 1 }, windup: 1, cooldown: 3, when: 'inRange', minRange: 2,
      telegraph: 'lights a fuse', verb: 'lobs a bomb',
    },
  ],
  desc: 'Quick hands, short fuses.',
  tip: 'Lobs bombs that land a turn later — watch the marked tiles (a diagonal step clears the blast). It keeps away from you, but after each throw it fumbles for the next fuse: that is when to close in. Grass and planks burn.',
});

mon({
  key: 'skua', name: 'Skua', glyph: 'v', color: '#e8e8e8',
  hp: 6, dmg: 2, speed: 200, move: 'fly', sight: 8, tags: ['beast', 'flying'], brain: 'thief', onDeath: 'drop_stolen',
  abilities: [
    {
      key: 'snatch', name: 'Snatch', shape: { k: 'melee' },
      effect: { special: 'snatch' }, windup: 1, cooldown: 6, when: 'adjacent',
      telegraph: 'eyes your belt', verb: 'snatches',
    },
  ],
  desc: 'A thieving sea-bird.',
  tip: 'Fast. It eyes your belt for a turn, then steals an item and flies off. Kill it to get the item back.',
});

mon({
  key: 'king_crab', name: 'King Crab', glyph: 'K', color: '#e0603a',
  hp: 26, dmg: 6, armor: 4, move: 'amphibious', sight: 6, tags: ['beast', 'elite'], brain: 'melee', pearls: 7,
  resist: { cold: 0.5 },
  abilities: [
    {
      key: 'crush', name: 'Crushing Claw', shape: { k: 'melee' },
      effect: { dmg: 10, dtype: 'physical', status: { id: 'rooted', turns: 2 } }, windup: 1, cooldown: 3, when: 'adjacent',
      telegraph: 'opens its great claw', verb: 'crushes',
    },
  ],
  desc: 'An armored tank on eight legs.',
  tip: 'Armor 4 blunts weak weapons. Use elements, knock it somewhere nasty, or leave it behind. Its claw winds up — step away.',
});

mon({
  key: 'siren', name: 'Siren', glyph: 'S', color: '#7fe0d4',
  hp: 12, dmg: 3, move: 'swim', sight: 8, tags: ['aquatic'], brain: 'siren', pearls: 5,
  abilities: [
    {
      key: 'song', name: 'Drowning Song', shape: { k: 'ray', range: 8 },
      effect: { pull: 2, special: 'song' }, windup: 1, cooldown: 3, when: 'inRange', needsSight: true,
      telegraph: 'begins to sing', verb: 'sings',
    },
  ],
  desc: 'She sings from the deep water.',
  tip: 'Her song drags you toward her, into the deep. Brush, walls and smoke break her line — so does killing her.',
});

// ===========================================================================
// The Surface (floor 10): storm, lightning, the Leviathan.

mon({
  key: 'storm_wisp', name: 'Storm Wisp', glyph: 'w', color: '#bfe3ff',
  hp: 6, dmg: 0, move: 'fly', breathes: false, sight: 8, tags: ['spirit', 'flying'], brain: 'skirmisher', light: 2,
  resist: { lightning: 0 },
  abilities: [
    {
      key: 'strike', name: 'Call Lightning', shape: { k: 'lob', range: 8, radius: 0 },
      effect: { dmg: 5, dtype: 'lightning', element: 'lightning', power: 4 }, windup: 1, cooldown: 3, when: 'inRange',
      telegraph: 'crackles, marking the ground', verb: 'calls down lightning',
    },
  ],
  desc: 'A knot of storm given a mind.',
  tip: 'Marks where lightning will fall a turn ahead. In the rain everyone is Wet — lightning hits twice as hard. It keeps its distance, but hangs still for a moment after each strike.',
});

mon({
  key: 'leviathan', name: 'The Leviathan', glyph: 'L', color: '#3fd0c0',
  hp: 110, dmg: 8, move: 'swim', sight: 14, tags: ['aquatic', 'boss'], brain: 'leviathan', boss: true, light: 3,
  resist: { cold: 0.5, lightning: 0.5 },
  abilities: [
    {
      key: 'maw', name: 'Maw', shape: { k: 'beam', range: 9 },
      effect: { dmg: 12, dtype: 'physical' }, windup: 2, cooldown: 4, when: 'inRange',
      telegraph: 'rears back, jaws opening', verb: 'lunges across the shore',
    },
    {
      key: 'wave', name: 'Breaker', shape: { k: 'wave', length: 6 },
      effect: { dmg: 4, dtype: 'physical', element: 'water', push: 3 }, windup: 2, cooldown: 5, when: 'inRange',
      telegraph: 'gathers a wall of water', verb: 'hurls a breaker',
    },
    {
      key: 'call', name: 'Call of the Deep', shape: { k: 'self' },
      effect: { special: 'call_deep' }, windup: 1, cooldown: 8, when: 'hunting',
      telegraph: 'sinks, and the sea churns', verb: 'calls its brood',
    },
  ],
  desc: 'It has followed you up from the bottom of the world.',
  tip: 'It cannot leave the sea, but its maw reaches far up the shore and its breakers throw you around. Light the beacon, or drive it off.',
});

export const MONSTERS: Readonly<Record<string, MonsterDef>> = M;

export function monsterDef(key: string): MonsterDef {
  const d = M[key];
  if (!d) throw new Error(`unknown monster ${key}`);
  return d;
}
