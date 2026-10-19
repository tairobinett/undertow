import type { StatusId } from '../core/types.ts';

export interface StatusDef {
  id: StatusId;
  name: string;
  color: string;
  /** Harmful statuses are cured by cleansing effects. */
  harmful: boolean;
  desc: string;
}

export const STATUSES: Record<StatusId, StatusDef> = {
  wet: { id: 'wet', name: 'Wet', color: '#5fa8ff', harmful: false, desc: 'Soaked. Fire damage is halved; lightning damage is doubled. Cold freezes you solid. Washes off oil.' },
  oiled: { id: 'oiled', name: 'Oiled', color: '#d9a441', harmful: true, desc: 'Coated in lamp oil. Fire damage is doubled and sets you Burning. Deep water washes it off.' },
  burning: { id: 'burning', name: 'Burning', color: '#ff7a2f', harmful: true, desc: 'On fire: 2 fire damage at the end of each turn, and flammable ground beneath catches. Water or cold puts it out.' },
  chilled: { id: 'chilled', name: 'Chilled', color: '#a8dcff', harmful: true, desc: 'Numbed by cold: acts only every other turn.' },
  frozen: { id: 'frozen', name: 'Frozen', color: '#dff4ff', harmful: true, desc: 'Encased in ice: cannot act. The next physical hit deals double damage and shatters the ice. Fire thaws it.' },
  poisoned: { id: 'poisoned', name: 'Poisoned', color: '#9fd356', harmful: true, desc: 'Takes 1 poison damage per turn for the remaining duration. More poison adds duration.' },
  stunned: { id: 'stunned', name: 'Stunned', color: '#ffe066', harmful: true, desc: 'Reeling: loses its next action.' },
  rooted: { id: 'rooted', name: 'Rooted', color: '#9c7a4f', harmful: true, desc: 'Held fast: cannot move, but can still attack and act.' },
  hasted: { id: 'hasted', name: 'Hasted', color: '#7dffb0', harmful: false, desc: 'Acts twice per turn.' },
  slowed: { id: 'slowed', name: 'Slowed', color: '#8888aa', harmful: true, desc: 'Acts every other turn.' },
  shielded: { id: 'shielded', name: 'Braced', color: '#c0c8d8', harmful: false, desc: 'Extra armor against physical blows.' },
  hidden: { id: 'hidden', name: 'Hidden', color: '#7a7aa8', harmful: false, desc: 'Unseen: monsters lose track of you and your attacks count as sneak attacks.' },
  blind: { id: 'blind', name: 'Blinded', color: '#555566', harmful: true, desc: 'Can only see adjacent tiles.' },
  charmed: { id: 'charmed', name: 'Charmed', color: '#ff9ad5', harmful: true, desc: 'Fighting for the other side.' },
  enraged: { id: 'enraged', name: 'Enraged', color: '#ff4040', harmful: false, desc: 'Deals +2 damage.' },
  gills: { id: 'gills', name: 'Air Bladder', color: '#7fd7ff', harmful: false, desc: 'Breathing from a sealed bladder: breath does not drop while swimming.' },
};
