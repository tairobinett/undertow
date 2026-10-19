// Save/load (versioned JSON) and deterministic replay from the command log.

import { newGame, submit, SAVE_VERSION } from './game.ts';
import { rebuildOcc } from './floor.ts';
import type { Command, FloorState, GameState } from './types.ts';
import { refreshVision } from './vision.ts';

const TYPED_KEYS = ['terrain', 'elev', 'surface', 'surfaceT', 'fire', 'heat', 'gas', 'gasAmt', 'seen'] as const;
const DERIVED_KEYS = ['vis', 'light', 'occ', 'los'] as const;

function toB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serialize(state: GameState): string {
  const f = state.floor;
  const floor: Record<string, unknown> = { ...f };
  for (const k of TYPED_KEYS) {
    const arr = f[k];
    floor[k] = toB64(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  }
  for (const k of DERIVED_KEYS) delete floor[k];
  const out = { ...state, floor, events: [], preview: undefined };
  return JSON.stringify(out);
}

export function deserialize(json: string): GameState {
  const raw = JSON.parse(json) as { v: number; floor: Record<string, unknown> };
  if (raw.v !== SAVE_VERSION) throw new Error(`save version ${raw.v} is not supported (expected ${SAVE_VERSION})`);
  const fr = raw.floor;
  const n = (fr.w as number) * (fr.h as number);
  const str = (k: string): string => fr[k] as string;
  const f = fr as unknown as FloorState;
  f.terrain = fromB64(str('terrain'));
  f.elev = new Int8Array(fromB64(str('elev')).buffer);
  f.surface = fromB64(str('surface'));
  f.surfaceT = fromB64(str('surfaceT'));
  f.fire = fromB64(str('fire'));
  f.heat = fromB64(str('heat'));
  f.gas = fromB64(str('gas'));
  f.gasAmt = fromB64(str('gasAmt'));
  f.seen = fromB64(str('seen'));
  f.vis = new Uint8Array(n);
  f.light = new Uint8Array(n);
  f.los = new Uint8Array(n);
  f.occ = new Int32Array(n);
  const state = raw as unknown as GameState;
  state.floor = f;
  state.events = [];
  delete state.preview;
  rebuildOcc(f);
  refreshVision(state);
  return state;
}

/** Rebuilds a run from its seed and command log. */
export function replay(seed: number, commands: readonly Command[], upTo = commands.length): GameState {
  const state = newGame(seed);
  for (let i = 0; i < upTo; i++) submit(state, commands[i] as Command);
  return state;
}

/** Cheap structural hash of the gameplay-relevant state (for determinism checks). */
export function stateHash(state: GameState): string {
  const f = state.floor;
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    h ^= v & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const k of TYPED_KEYS) {
    const a = f[k];
    for (let i = 0; i < a.length; i++) mix(a[i] as number);
  }
  for (const a of f.actors) {
    mix(a.id);
    mix(a.x);
    mix(a.y);
    mix(Math.round(a.hp * 10));
    mix(a.dead ? 1 : 0);
  }
  mix(state.turn);
  mix(f.waterLevel);
  mix(state.rng.a);
  mix(state.rng.b);
  return h.toString(16);
}
