// Declarative action specs shared by player abilities, consumables and monster abilities.
// The engine (core/actions.ts) interprets them, so the same rules apply to everyone and
// previews/descriptions can be generated from the data.

import type { DamageType, Element, StatusId } from '../core/types.ts';

export type Shape =
  /** The user only. */
  | { k: 'self' }
  /** An adjacent tile. */
  | { k: 'melee' }
  /** Flies toward the target and stops at the first creature or obstacle; affects that tile (plus radius). */
  | { k: 'bolt'; range: number; radius?: number }
  /** Locked direction: travels to max range, stops at the first creature or obstacle. */
  | { k: 'ray'; range: number }
  /** Hits every tile along a straight line until a wall. */
  | { k: 'beam'; range: number }
  /** 90-degree cone. */
  | { k: 'cone'; range: number }
  /** Arcs over obstacles to a target tile, affecting a radius around it. */
  | { k: 'lob'; range: number; radius: number }
  /** Radius around the user (excluding the user unless includeSelf). */
  | { k: 'burst'; radius: number; includeSelf?: boolean }
  /** A wave: 3 tiles wide, `length` tiles long, in a direction. */
  | { k: 'wave'; length: number }
  /** A visible, standable tile within range (teleports). */
  | { k: 'tile'; range: number };

export interface EffectSpec {
  dmg?: number;
  dtype?: DamageType;
  /** Element applied to every tile in the area (after damage). */
  element?: Element;
  /** Gas amount / fire strength for element application. */
  power?: number;
  status?: { id: StatusId; turns: number; power?: number };
  /** Push creatures away from the origin by N tiles. */
  push?: number;
  /** Pull creatures toward the user by N tiles. */
  pull?: number;
  heal?: number;
  /** Removes harmful statuses from creatures hit. */
  cleanse?: boolean;
  /** Custom handler implemented in core/specials.ts. */
  special?: string;
  /** If true the effect never harms the user's allies. Default: areas hit everyone. */
  selective?: boolean;
}
