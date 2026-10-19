// Boons: after every climb, choose 1 of 3.
// Offers are drawn one per group (vital / weapon / arcana) so every pick is a real trade.
// Weapon-upgrade boons and ability boons are generated from WEAPON_UPGRADES and ABILITIES.

export type BoonGroup = 'vital' | 'weapon' | 'arcana';

export interface BoonEffect {
  maxHp?: number;
  heal?: number;
  /** Heal a fraction of max HP. */
  healPct?: number;
  armor?: number;
  breath?: number;
  pearls?: number;
  relicSlot?: number;
  beltSlot?: number;
  lantern?: number;
  /** Weapon upgrade key (applies to the equipped weapon). */
  upgrade?: string;
  /** Learn this ability. */
  learn?: string;
  /** +1 max charge for this ability. */
  charge?: string;
}

export interface BoonDef {
  key: string;
  name: string;
  group: BoonGroup;
  desc: string;
  weight: number;
  /** Max times it can be taken in a run (default 1). */
  max?: number;
  effect: BoonEffect;
}

export const STATIC_BOONS: Record<string, BoonDef> = {
  vigor: { key: 'vigor', name: 'Vigor', group: 'vital', desc: '+6 max HP, and heal 6.', weight: 6, max: 4, effect: { maxHp: 6, heal: 6 } },
  mend: { key: 'mend', name: 'Mend', group: 'vital', desc: 'Heal half your max HP.', weight: 8, max: 9, effect: { healPct: 0.5 } },
  deep_lungs: { key: 'deep_lungs', name: 'Deep Lungs', group: 'vital', desc: '+4 breath.', weight: 5, max: 2, effect: { breath: 4 } },
  thick_skin: { key: 'thick_skin', name: 'Thick Skin', group: 'vital', desc: '+1 armor against physical blows.', weight: 5, max: 2, effect: { armor: 1 } },
  pearl_cache: { key: 'pearl_cache', name: 'Pearl Cache', group: 'vital', desc: 'Gain 30 pearls.', weight: 4, max: 3, effect: { pearls: 30 } },
  relic_slot: { key: 'relic_slot', name: 'Reliquary', group: 'arcana', desc: '+1 relic slot.', weight: 4, max: 1, effect: { relicSlot: 1 } },
  belt_slot: { key: 'belt_slot', name: 'Bandolier', group: 'vital', desc: '+1 belt slot.', weight: 4, max: 1, effect: { beltSlot: 1 } },
  lantern: { key: 'lantern', name: 'Whale-Oil Wick', group: 'vital', desc: 'Your lantern burns brighter: +2 light radius.', weight: 3, max: 1, effect: { lantern: 2 } },
};
