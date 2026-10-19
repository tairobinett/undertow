// Terrain definitions. One table drives movement, sight, flooding, burning and rendering,
// so every rule reads the same properties (no special-cased tiles scattered around).

export interface TerrainDef {
  id: number;
  key: string;
  name: string;
  glyph: string;
  fg: string;
  bg: string;
  /** Creatures can stand here (when not deep water). */
  walk: boolean;
  /** Blocks line of sight. */
  opaque: boolean;
  /** Blocks gas, projectiles and flooding (wall-like). */
  solid: boolean;
  /** Can hold water when the tide reaches it. */
  flood: boolean;
  /** Standing here keeps you above the water (bridges). */
  bridge?: boolean;
  /** Burn duration in turns when ignited (0 = not flammable). */
  fuel: number;
  /** Turns of adjacent fire needed to ignite. */
  delay: number;
  /** Terrain left behind after burning out. */
  burnsTo: number;
  /** Light radius emitted (0 = none). */
  light: number;
  desc: string;
}

export const T = {
  VOID: 0,
  WALL: 1,
  FLOOR: 2,
  SAND: 3,
  GRASS: 4,
  BRUSH: 5,
  DOOR: 6,
  DOOR_OPEN: 7,
  BRIDGE: 8,
  CORAL: 9,
  BOOKSHELF: 10,
  PILLAR: 11,
  STATUE: 12,
  RUBBLE: 13,
  ASH: 14,
  TREE: 15,
  BRAZIER: 16,
  BARREL: 17,
  PEW: 18,
  PLANKS: 19,
  GLOWMOSS: 20,
  TOMB: 21,
  WALL_LAMP: 22,
} as const;

const defs: TerrainDef[] = [];

function def(d: Omit<TerrainDef, 'id'> & { id: number }): void {
  defs[d.id] = d;
}

def({ id: T.VOID, key: 'void', name: 'solid rock', glyph: ' ', fg: '#000000', bg: '#000000', walk: false, opaque: true, solid: true, flood: false, fuel: 0, delay: 0, burnsTo: T.VOID, light: 0, desc: 'Unbroken rock.' });
def({ id: T.WALL, key: 'wall', name: 'wall', glyph: '#', fg: '#8a8f99', bg: '#3b3f48', walk: false, opaque: true, solid: true, flood: false, fuel: 0, delay: 0, burnsTo: T.WALL, light: 0, desc: 'Solid stone.' });
def({ id: T.FLOOR, key: 'floor', name: 'stone floor', glyph: '.', fg: '#6f7480', bg: '#1b1d22', walk: true, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.FLOOR, light: 0, desc: 'Worn flagstones.' });
def({ id: T.SAND, key: 'sand', name: 'sand', glyph: '.', fg: '#b9a57a', bg: '#2a2419', walk: true, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.SAND, light: 0, desc: 'Damp, packed sand.' });
def({ id: T.GRASS, key: 'grass', name: 'grass', glyph: '"', fg: '#6fae52', bg: '#16200f', walk: true, opaque: false, solid: false, flood: true, fuel: 2, delay: 1, burnsTo: T.ASH, light: 0, desc: 'Dry grass. Catches fire the turn after flames touch it.' });
def({ id: T.BRUSH, key: 'brush', name: 'brush', glyph: '♣', fg: '#4f9a4a', bg: '#122016', walk: true, opaque: true, solid: false, flood: true, fuel: 3, delay: 1, burnsTo: T.ASH, light: 0, desc: 'Tall growth that blocks sight. Burns readily when dry.' });
def({ id: T.DOOR, key: 'door', name: 'wooden door', glyph: '+', fg: '#c8914f', bg: '#2e2013', walk: true, opaque: true, solid: false, flood: true, fuel: 6, delay: 2, burnsTo: T.FLOOR, light: 0, desc: 'A closed door. Blocks sight and gas until opened. Wood burns.' });
def({ id: T.DOOR_OPEN, key: 'door_open', name: 'open door', glyph: "'", fg: '#c8914f', bg: '#1f1810', walk: true, opaque: false, solid: false, flood: true, fuel: 6, delay: 2, burnsTo: T.FLOOR, light: 0, desc: 'An open door. Wood burns.' });
def({ id: T.BRIDGE, key: 'bridge', name: 'rope bridge', glyph: '=', fg: '#b08850', bg: '#2a1d10', walk: true, opaque: false, solid: false, flood: true, bridge: true, fuel: 6, delay: 2, burnsTo: T.FLOOR, light: 0, desc: 'Planks strung over the water. Keeps you dry — until it burns.' });
def({ id: T.CORAL, key: 'coral', name: 'glowing coral', glyph: '#', fg: '#e58fb8', bg: '#3a2233', walk: false, opaque: true, solid: true, flood: false, fuel: 0, delay: 0, burnsTo: T.CORAL, light: 2, desc: 'Coral that sheds a faint light.' });
def({ id: T.BOOKSHELF, key: 'bookshelf', name: 'bookshelf', glyph: '▤', fg: '#a8733d', bg: '#2a1a0e', walk: false, opaque: true, solid: true, flood: false, fuel: 8, delay: 2, burnsTo: T.RUBBLE, light: 0, desc: 'Swollen, mouldering books: they block the way and the view, like a wall. They still burn.' });
def({ id: T.PILLAR, key: 'pillar', name: 'pillar', glyph: 'O', fg: '#9aa0aa', bg: '#2c2f36', walk: false, opaque: true, solid: true, flood: false, fuel: 0, delay: 0, burnsTo: T.PILLAR, light: 0, desc: 'A carved stone column.' });
def({ id: T.STATUE, key: 'statue', name: 'statue', glyph: 'Ω', fg: '#b5bcc6', bg: '#1b1d22', walk: false, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.STATUE, light: 0, desc: 'A drowned saint. Blocks movement but not sight.' });
def({ id: T.RUBBLE, key: 'rubble', name: 'rubble', glyph: ',', fg: '#7d7466', bg: '#1d1b18', walk: true, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.RUBBLE, light: 0, desc: 'Broken stone and charred wood.' });
def({ id: T.ASH, key: 'ash', name: 'ash', glyph: '.', fg: '#5c5a57', bg: '#161515', walk: true, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.ASH, light: 0, desc: 'Burnt ground. Nothing left to burn.' });
def({ id: T.TREE, key: 'tree', name: 'twisted tree', glyph: '♠', fg: '#3f8a45', bg: '#101a10', walk: false, opaque: true, solid: false, flood: true, fuel: 8, delay: 3, burnsTo: T.ASH, light: 0, desc: 'A wind-bent tree. Blocks movement and sight; burns slowly.' });
def({ id: T.BRAZIER, key: 'brazier', name: 'brazier', glyph: '¥', fg: '#ffb347', bg: '#2a1a0a', walk: false, opaque: false, solid: false, flood: false, fuel: 0, delay: 0, burnsTo: T.BRAZIER, light: 5, desc: 'An iron brazier. Lights the room.' });
def({ id: T.BARREL, key: 'barrel', name: 'oil barrel', glyph: '0', fg: '#c9a14a', bg: '#2a200e', walk: false, opaque: false, solid: false, flood: true, fuel: 1, delay: 1, burnsTo: T.RUBBLE, light: 0, desc: 'Lamp oil. Smash it to spill oil around it; set it alight and it bursts into flame.' });
def({ id: T.PEW, key: 'pew', name: 'pew', glyph: '╥', fg: '#9b6a3a', bg: '#1f160e', walk: false, opaque: false, solid: false, flood: true, fuel: 5, delay: 2, burnsTo: T.ASH, light: 0, desc: 'A waterlogged wooden pew. Blocks movement, not sight.' });
def({ id: T.PLANKS, key: 'planks', name: 'planks', glyph: '_', fg: '#a07a4a', bg: '#23190f', walk: true, opaque: false, solid: false, flood: true, fuel: 4, delay: 2, burnsTo: T.ASH, light: 0, desc: 'Salvaged ship planking. Flammable.' });
def({ id: T.GLOWMOSS, key: 'glowmoss', name: 'glowmoss', glyph: '"', fg: '#56d6c0', bg: '#0c1c1c', walk: true, opaque: false, solid: false, flood: true, fuel: 2, delay: 1, burnsTo: T.ASH, light: 1, desc: 'Luminous moss. Dry enough to burn.' });
def({ id: T.TOMB, key: 'tomb', name: 'sarcophagus', glyph: '▬', fg: '#a6a095', bg: '#22201c', walk: false, opaque: false, solid: false, flood: true, fuel: 0, delay: 0, burnsTo: T.TOMB, light: 0, desc: 'A stone coffin. Blocks movement, not sight.' });
def({ id: T.WALL_LAMP, key: 'wall_lamp', name: 'wall lamp', glyph: '#', fg: '#ffcf7a', bg: '#4a3b2a', walk: false, opaque: true, solid: true, flood: false, fuel: 0, delay: 0, burnsTo: T.WALL_LAMP, light: 5, desc: 'An oil lamp set into the wall.' });

export const TERRAIN: readonly TerrainDef[] = defs;

export function terrainDef(id: number): TerrainDef {
  const d = TERRAIN[id];
  if (!d) throw new Error(`unknown terrain ${id}`);
  return d;
}

/** Surface overlays. */
export const SURF = {
  NONE: 0,
  OIL: 1,
  ICE: 2,
  BLOOD: 3,
} as const;

export const SURF_NAMES = ['', 'oil slick', 'ice', 'blood'];

/** Gas types. */
export const GAS = {
  NONE: 0,
  STEAM: 1,
  SMOKE: 2,
  MIASMA: 3,
} as const;

export interface GasDef {
  name: string;
  /** Fraction of amount lost per turn. */
  decay: number;
  /** Amount at or above which the gas blocks sight. */
  opaqueAt: number;
  desc: string;
}

export const GASES: readonly GasDef[] = [
  { name: '', decay: 0, opaqueAt: 999, desc: '' },
  { name: 'steam', decay: 0.2, opaqueAt: 40, desc: 'Scalding steam: 2 fire damage per turn to anything inside. Blocks sight when thick.' },
  { name: 'smoke', decay: 0.1, opaqueAt: 25, desc: 'Thick smoke. Blocks sight; creatures inside cannot be seen.' },
  { name: 'miasma', decay: 0.08, opaqueAt: 999, desc: 'Rot-gas. Poisons anything that breathes it (1 per turn, stacking).' },
];

export const ICE_TURNS = 16;
