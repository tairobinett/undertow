// Core data types. GameState is plain data (plus typed arrays) so it can be cloned with
// structuredClone (for action previews) and serialised for saves. No classes, no functions.

import type { RngState } from './rng.ts';

export type DamageType = 'physical' | 'fire' | 'cold' | 'lightning' | 'poison' | 'drown' | 'pure';

/** Things that can be applied to tiles by abilities, items and hazards. */
export type Element = 'fire' | 'cold' | 'lightning' | 'water' | 'oil' | 'poison' | 'steam' | 'smoke';

export type MoveMode = 'walk' | 'swim' | 'amphibious' | 'fly' | 'phase';

export type Team = 'player' | 'monster';

export type ZoneId = 'deep' | 'cloister' | 'caves' | 'surface';

export type StatusId =
  | 'wet'
  | 'oiled'
  | 'burning'
  | 'chilled'
  | 'frozen'
  | 'poisoned'
  | 'stunned'
  | 'rooted'
  | 'hasted'
  | 'slowed'
  | 'shielded'
  | 'hidden'
  | 'blind'
  | 'charmed'
  | 'enraged'
  | 'gills';

export interface StatusInst {
  id: StatusId;
  turns: number;
  /** Magnitude for statuses that need one (shielded armor, poison damage, ...). */
  power?: number;
  source?: number;
  /** The tick it counts from: it neither ticks down nor deals damage on that tick (see statusStart). */
  t0?: number;
}

export interface Intent {
  /** Ability key on the acting monster's definition. */
  ability: string;
  /** Tiles that will be affected (indices), used for drawing and resolution. */
  tiles: number[];
  aimX?: number;
  aimY?: number;
  targetId?: number;
  /** Plain-language description shown to the player. */
  label: string;
  /** Player turns left before it lands (1 = right after your next action). Kept in sync each tick. */
  turns: number;
  /**
   * The world tick on which it lands: on the monster's first action at or after it. Never the
   * tick it was declared in, so you always get at least one turn to answer a wind-up.
   */
  resolveTurn?: number;
}

export type AIMode = 'asleep' | 'wander' | 'alert' | 'hunt' | 'flee' | 'search' | 'guard';

export interface AIState {
  mode: AIMode;
  /** Tick on which it noticed you: it spends the rest of that tick reacting. */
  alertTurn?: number;
  targetId?: number;
  lastX?: number;
  lastY?: number;
  lastSeenTurn?: number;
  intent?: Intent;
  /** Ability cooldowns (turns remaining) keyed by ability key. */
  cd: Record<string, number>;
  wanderX?: number;
  wanderY?: number;
  homeX?: number;
  homeY?: number;
  /** Deterministic pathing tie-break offset. */
  tie: number;
  phase?: number;
  memo?: Record<string, number>;
}

export interface Actor {
  id: number;
  /** 'player' or a monster definition key. */
  def: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  team: Team;
  statuses: StatusInst[];
  breath: number;
  ai?: AIState;
  /** Aquatic ambushers hide under the surface; shown only as ripples. */
  submerged?: boolean;
  summoner?: number;
  dead?: boolean;
  /** Expiry turn for summoned/temporary creatures. */
  expires?: number;
}

export type ItemKind = 'weapon' | 'relic' | 'consumable' | 'pearls';

export interface ItemInst {
  kind: ItemKind;
  def: string;
  count: number;
  /** Weapon upgrades carried by this specific weapon. */
  upgrades?: string[];
}

export interface FloorItem {
  id: number;
  x: number;
  y: number;
  item: ItemInst;
  /** Items sharing a vault group: taking one sinks the rest. */
  vault?: number;
  /** Merchant goods: price in pearls. */
  price?: number;
}

export type FeatureKind = 'exit' | 'entry' | 'shrine' | 'spring' | 'merchant' | 'beacon' | 'altar';

export type Route = 'stair' | 'rift';

export interface Feature {
  id: number;
  kind: FeatureKind;
  x: number;
  y: number;
  route?: Route;
  /** Next-floor modifiers granted by taking this exit. */
  nextMods?: string[];
  omen?: string;
  used?: boolean;
  progress?: number;
  /** The beacon's light has called the storm down (once per run). */
  called?: boolean;
}

export interface FloorState {
  index: number;
  zone: ZoneId;
  name: string;
  w: number;
  h: number;
  seed: number;
  terrain: Uint8Array;
  elev: Int8Array;
  /** Surface overlay: see SURF constants. */
  surface: Uint8Array;
  /** Surface timers (ice melt countdown, etc.). */
  surfaceT: Uint8Array;
  /** Remaining burn turns of fire on the tile (0 = none). */
  fire: Uint8Array;
  /** Ignition progress for flammable tiles adjacent to fire. */
  heat: Uint8Array;
  gas: Uint8Array;
  gasAmt: Uint8Array;
  /** Player's map memory. */
  seen: Uint8Array;
  /** Currently visible to the player (derived each turn). */
  vis: Uint8Array;
  /** Light intensity 0-255 (derived each turn). */
  light: Uint8Array;
  /** Occupancy: actor id standing on each tile, 0 if empty (derived, maintained by setPos). */
  occ: Int32Array;
  /** Tiles in line of sight of the player regardless of light (derived; symmetric FOV). */
  los: Uint8Array;
  waterLevel: number;
  tideInterval: number;
  tideTimer: number;
  tidePaused: number;
  /** Ambient light 0..1 for the whole floor. */
  ambient: number;
  mods: string[];
  actors: Actor[];
  items: FloorItem[];
  features: Feature[];
  entryX: number;
  entryY: number;
  turnArrived: number;
  /** Rain soaks everything (surface storm). */
  raining: boolean;
  /** Turn of the last "oil ignites" message (dedupes log spam). */
  lastOilMsg?: number;
  /** Who set each burning tile alight (tile index → actor id), so fire kills are credited. */
  fireBy?: Record<number, number>;
}

export interface WeaponInst {
  def: string;
  upgrades: string[];
}

export interface AbilityInst {
  def: string;
  charges: number;
  max: number;
}

export interface BeltSlot {
  def: string;
  count: number;
}

export interface PlayerBuild {
  weapon: WeaponInst;
  relics: string[];
  relicSlots: number;
  abilities: AbilityInst[];
  abilitySlots: number;
  belt: (BeltSlot | null)[];
  pearls: number;
  armor: number;
  /** Max HP gained from boons (relic modifiers are applied on top). */
  maxHpBonus: number;
  maxBreath: number;
  lantern: number;
  boons: string[];
  /** Flat bonus weapon damage from boons. */
  bonusDamage: number;
  /** Turn on which the spear's Set Against Charge last triggered. */
  braceTurn?: number;
  /** Turn on which you last stepped to a new tile (a set spear needs you to hold your ground). */
  movedTurn?: number;
  /** Consecutive turns spent lighting the beacon. */
  beaconTurn?: number;
  /** Relics whose max-HP bonus has already been paid out as health this run. */
  hpGranted?: string[];
}

export type Tone = 'info' | 'good' | 'bad' | 'warn' | 'dmg' | 'lore' | 'system';

export interface LogEntry {
  turn: number;
  text: string;
  tone: Tone;
  /** Repeat counter for identical consecutive messages. */
  n?: number;
}

export interface DamageRecord {
  turn: number;
  amount: number;
  dtype: DamageType;
  source: string;
  cause: string;
  hpAfter: number;
}

export interface DeathInfo {
  cause: string;
  killer: string;
  /** Monster key of the killer, when a creature dealt the final blow. */
  killerDef?: string;
  floor: number;
  turn: number;
  recap: DamageRecord[];
  unusedOuts: string[];
}

export interface RunStats {
  kills: number;
  killsByDef: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  pearlsFound: number;
  itemsUsed: number;
  abilitiesUsed: number;
  floorTurns: number[];
  deepest: number;
  swims: number;
  /** Bosses that died this run, by any means (fire, steam and beaching count). */
  bossesSlain?: string[];
}

export type Pending = { kind: 'weapon'; options: string[] } | { kind: 'boon'; options: string[] };

export type GameStatus = 'playing' | 'dead' | 'won';

export interface Chronicle {
  turn: number;
  floor: number;
  text: string;
}

export interface GameState {
  v: number;
  seed: number;
  rng: RngState;
  turn: number;
  floor: FloorState;
  build: PlayerBuild;
  playerId: number;
  nextId: number;
  status: GameStatus;
  pending: Pending | null;
  log: LogEntry[];
  events: GameEvent[];
  stats: RunStats;
  dmgLog: DamageRecord[];
  chronicle: Chronicle[];
  death?: DeathInfo;
  /** Commands issued so far (for replays / bug reports). */
  commands: Command[];
  /** True while computing a preview on a cloned state (suppresses logging side effects). */
  preview?: boolean;
  /** True while the world tick runs (monsters and environment), false during the player's action. */
  ticking?: boolean;
  /** Floor names already used this run (so no two floors share one). */
  usedNames?: string[];
}

// ---------------------------------------------------------------------------
// Commands (player input) — the only way the UI changes the game.

export type Command =
  | { t: 'move'; dx: number; dy: number }
  | { t: 'attack'; x: number; y: number }
  | { t: 'wait' }
  | { t: 'ability'; slot: number; x?: number; y?: number }
  | { t: 'use'; slot: number; x?: number; y?: number }
  | { t: 'pickup'; replace?: number }
  | { t: 'drop'; slot: number }
  | { t: 'ascend' }
  | { t: 'choose'; index: number }
  | { t: 'shrine'; option: number }
  | { t: 'interact' };

// ---------------------------------------------------------------------------
// Events emitted during a command, consumed by the UI for animation/feedback.

export type FxKind =
  | 'fire'
  | 'frost'
  | 'shock'
  | 'steam'
  | 'oil'
  | 'smoke'
  | 'poison'
  | 'water'
  | 'blink'
  | 'heal'
  | 'boom'
  | 'tide'
  | 'hit';

export type GameEvent =
  | { t: 'dmg'; id: number; x: number; y: number; amount: number; dtype: DamageType }
  | { t: 'heal'; id: number; x: number; y: number; amount: number }
  | { t: 'die'; id: number; x: number; y: number; def: string }
  | { t: 'move'; id: number; fx: number; fy: number; tx: number; ty: number; how: 'step' | 'push' | 'pull' | 'blink' | 'slide' | 'lunge' }
  | { t: 'melee'; id: number; tx: number; ty: number }
  | { t: 'shot'; fx: number; fy: number; tx: number; ty: number; kind: FxKind }
  | { t: 'fx'; tiles: number[]; kind: FxKind }
  | { t: 'tide'; level: number }
  | { t: 'floor'; index: number }
  | { t: 'telegraph'; id: number };
