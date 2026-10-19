// Text-mode play harness: play UNDERTOW one command batch at a time from the shell.
// Each call loads a session, runs commands, prints what the browser UI would show, and saves.
//
//   node scripts/tplay.ts <session> new <seed>          start a run
//   node scripts/tplay.ts <session> new <seed> auto=N   a bot plays the first N floors, then it is yours
//   node scripts/tplay.ts <session> "<cmd>; <cmd>; …"   run commands, then print the view
//   node scripts/tplay.ts help                           command reference
//
// Sessions live in .tmp/tplay/. The view mirrors the sidebar, log, hover text and targeting
// previews of the browser UI, so a playtester sees the same information a player would.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ABILITIES } from '../src/content/abilities.ts';
import { CONSUMABLES } from '../src/content/consumables.ts';
import { MONSTERS } from '../src/content/monsters.ts';
import { RELICS } from '../src/content/relics.ts';
import { STATUSES } from '../src/content/statuses.ts';
import { VARIANTS } from '../src/content/variants.ts';
import { WEAPONS, WEAPON_UPGRADES } from '../src/content/weapons.ts';
import { ZONES } from '../src/content/zones.ts';
import { arcRadius, elementReach } from '../src/core/elements.ts';
import { actorAt, BRIDGE_DECK, idx, isDeep, isWater } from '../src/core/floor.ts';
import { chebyshev } from '../src/core/geom.ts';
import { exitHere, newGame, previewCommand, submit } from '../src/core/game.ts';
import { SHRINE_OPTIONS } from '../src/core/player.ts';
import { describeBoon } from '../src/core/progression.ts';
import { shapeTiles } from '../src/core/resolve.ts';
import { seedFromText, seedRng } from '../src/core/rng.ts';
import { heuristicCommand } from '../src/bot/bot.ts';
import { deserialize, serialize } from '../src/core/save.ts';
import { freshAir, nearestAir, player, playerBaseDamage, playerMaxBreath, speedOf, weaponDef } from '../src/core/state.ts';
import { effectiveTideInterval, tideForecast } from '../src/core/systems.ts';
import { GAS, SURF, T, TERRAIN } from '../src/core/terrain.ts';
import type { Command, GameState, LogEntry } from '../src/core/types.ts';
import { depthName as depthLabel, describeItem, describeTile, floodTimes, floorSights, modeText, recapLines, shapeText, turnsUntilLevel, wayUpDeadline } from '../src/ui/inspect.ts';
import { featureGlyph, itemGlyph } from '../src/ui/render.ts';
import { checkTips } from '../src/ui/tips.ts';
import { startTravel, telegraphTiles, travelNext, unseenWindups, visibleEnemies } from '../src/ui/travel.ts';
import { SightMemory } from '../src/ui/memory.ts';
import type { Sighting } from '../src/ui/memory.ts';

const memory = new SightMemory();

const HELP = `UNDERTOW text harness — commands (separate several with ';'):
  n s e w ne nw se sw      step (or attack) in a direction; add a count to repeat: "n 3"
                           (a repeat stops early if you're hurt, something hunts you or the
                           tide rises around you; a ";" batch stops if you're hurt, a wind-up
                           aims at you or the tide rises around you)
  wait | .                 wait a turn
  attack X Y               weapon attack at a tile (reach, lunge and harpoon weapons hit from range)
  ability K [X Y]          use ability slot K (1-4); self/burst abilities need no target
  use K [X Y]              use belt slot K (1-5); drinks need no target
  preview ability|use K X Y  |  preview attack X Y
                           show the affected tiles and predicted HP changes without acting
  pickup [R] [yes]         pick up / buy / drink at a spring (R = slot to replace when full;
                           taking an altar relic sinks the others, so it asks for "yes")
  drop K                   drop belt slot K
  interact | g             what the UI's "g" does here: pick up, use a shrine/beacon/spring, or climb
  shrine K                 make shrine offering K (1-3) while next to a tide shrine
  climb | <                climb the way up you are standing on
  choose K                 pick option K (1-3) of a pending choice (kit or boon)
  look X Y                 inspect a tile (terrain, creature, item, feature)
  travel X Y [swim]        walk to a known tile until something interrupts you
  explore | z  [swim]      auto-explore until something interrupts you
  exit | >  [swim]         travel to the nearest known way up
                           (travel stops at the edge of deep water and quotes the swim; add "swim" to agree to that crossing)
  elev                     print the elevation of known tiles (0-9, then a-z)
  view                     just print the (compact) view
  full                     print the full view: descriptions of everything you carry, the whole
                           known map and the glyph legend
The compact view shows the map within 24 columns / 12 rows of you; coordinates are on the edges.
Map glyphs: @ you, # wall, rock or coral, . floor, ~ shallow water, ≈ deep water, X a telegraphed attack (lands
next turn), , floods at the next tide, ^ fire, : gas, o oil, _ ice, < way up, ∩ tide shrine,
○ spring, • pearls, ! belt item, ) weapon, ♦ relic, letters are creatures ("full" lists terrain).`;

type Session = { save: string; prefs: Record<string, unknown>; sightings?: Sighting[] };

// ---------------------------------------------------------------------------
// Storage shim so first-time tips work (and persist per session).

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

// ---------------------------------------------------------------------------

const depthName = (i: number): string => depthLabel(i, true);

const DIRS: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1] };

function tileGlyph(s: GameState, i: number, showDynamic: boolean): string {
  const f = s.floor;
  const t = f.terrain[i] as number;
  const td = TERRAIN[t];
  if (!td) return '?';
  let g = td.glyph;
  if (td.solid && !td.walk) g = td.glyph === ' ' ? '#' : td.glyph;
  // Flooded brush still blocks sight: '♣' in shallows, '♧' where it's deep enough to swim.
  if (t === T.BRUSH) {
    if (isDeep(f, i)) g = '♧';
  } else if (isDeep(f, i)) g = '≈';
  else if (isWater(f, i)) g = '~';
  if (!showDynamic) return g;
  const surf = f.surface[i] as number;
  if (surf === SURF.ICE) g = '_';
  else if (surf === SURF.OIL) g = 'o';
  if ((f.fire[i] as number) > 0) g = '^';
  else if ((f.gas[i] as number) !== GAS.NONE && (f.gasAmt[i] as number) > 20) g = ':';
  return g;
}

function featureName(ft: { kind: string; route?: string; used?: boolean }): string {
  switch (ft.kind) {
    case 'exit': return ft.route === 'rift' ? 'the Rift up' : 'the way up';
    case 'merchant': return 'the hermit';
    case 'shrine': return `tide shrine${ft.used ? ' (used)' : ''}`;
    case 'spring': return `spring${ft.used ? ' (dry)' : ''}`;
    case 'altar': return 'relic altar';
    default: return `${ft.kind}${ft.used ? ' (used)' : ''}`;
  }
}

/** Full detail (descriptions, whole map, legend) instead of the compact view. */
let verbose = false;
const WIN_X = 24;
const WIN_Y = 12;

/** Terrain glyphs that appeared in the last printed map, with their names (for the compact legend). */
const shownTerrain = new Map<string, string>();
const BASIC_GLYPHS = new Set(['#', '.', '~', '≈', ' ', '·']);

function renderMap(s: GameState, overlay?: { tiles: Set<number>; ch: string }): string {
  const f = s.floor;
  const p = player(s);
  let x0 = f.w;
  let y0 = f.h;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < f.w * f.h; i++) {
    if (!f.seen[i]) continue;
    const x = i % f.w;
    const y = (i - x) / f.w;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  // The window snaps to a 10-tile grid so it stays put while you move around inside it.
  const wx = Math.floor((p.x - WIN_X) / 10) * 10;
  const wy = Math.floor((p.y - WIN_Y) / 10) * 10;
  x0 = Math.max(0, x0 - 1, verbose ? 0 : wx);
  y0 = Math.max(0, y0 - 1, verbose ? 0 : wy);
  x1 = Math.min(f.w - 1, x1 + 1, verbose ? f.w : wx + 2 * WIN_X + 10);
  y1 = Math.min(f.h - 1, y1 + 1, verbose ? f.h : wy + 2 * WIN_Y + 10);
  const danger = new Set<number>();
  for (const t of telegraphTiles(s)) danger.add(t);
  const flood = f.tideTimer <= 4 && f.tidePaused === 0 ? new Set(tideForecast(s)) : new Set<number>();
  const rows: string[] = [];
  // Column ruler: tens digit line, then units.
  let tens = '     ';
  let units = '     ';
  for (let x = x0; x <= x1; x++) {
    tens += x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' ';
    units += String(x % 10);
  }
  rows.push(tens, units);
  for (let y = y0; y <= y1; y++) {
    let row = `${String(y).padStart(3)}  `;
    for (let x = x0; x <= x1; x++) {
      const i = y * f.w + x;
      if (!f.seen[i]) {
        row += ' ';
        continue;
      }
      const vis = f.vis[i] === 1;
      let g = tileGlyph(s, i, vis);
      const td = TERRAIN[f.terrain[i] as number];
      if (td && g === td.glyph && !BASIC_GLYPHS.has(g)) shownTerrain.set(g, td.name.toLowerCase());
      const ft = f.features.find((q) => q.x === x && q.y === y);
      if (ft) g = featureGlyph(ft.kind, ft.route, !!ft.used)?.glyph ?? g;
      const it = f.items.find((q) => q.x === x && q.y === y);
      if (it) g = itemGlyph(it).glyph;
      if (vis) {
        if (flood.has(i) && g !== '~' && g !== '≈') g = ',';
        if (danger.has(i)) g = 'X';
        if (overlay?.tiles.has(i)) g = overlay.ch;
        const a = actorAt(f, x, y);
        if (a && !a.dead && a.submerged && a.id !== p.id && (g === '≈' || g === '~')) g = '≋';
        else if (a && !a.dead && !(a.submerged && a.id !== p.id)) g = a.id === p.id ? '@' : (MONSTERS[a.def]?.glyph ?? 'M');
      } else if (overlay?.tiles.has(i)) g = overlay.ch;
      row += g;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

function legend(s: GameState): string {
  const f = s.floor;
  const parts = ['@ you', '# wall, rock or coral', '. floor', '~ shallow water', '≈ deep water (swim: breath)', 'X telegraphed attack (lands next turn)'];
  if (f.tideTimer <= 4 && f.tidePaused === 0) parts.push(', floods at the next tide');
  const seenTerrain = new Set<number>();
  for (let i = 0; i < f.w * f.h; i++) if (f.seen[i]) seenTerrain.add(f.terrain[i] as number);
  for (const t of seenTerrain) {
    const td = TERRAIN[t];
    if (!td || ['#', '.', ' '].includes(td.glyph)) continue;
    parts.push(`${td.glyph} ${td.name.toLowerCase()}`);
  }
  parts.push('^ fire', ': gas cloud', 'o oil', '_ ice', '≋ ripples (something under the water)', '< way up (stair)', '« way up (Rift: harder floor, relic vault above)', '> flooded stair you came up (inert)', '∩ tide shrine', '○ spring', '& the hermit (merchant)', 'π altar', '♧ brush under deep water (swim; blocks sight)', '• pearls', '! ? belt items', ') weapon', '♦ relic');
  return `Legend: ${[...new Set(parts)].join(' · ')}. Tiles outside your sight show what you remember (no creatures).`;
}

function sidebar(s: GameState): string {
  const f = s.floor;
  const p = player(s);
  const b = s.build;
  const out: string[] = [];
  const vars = f.mods.filter((m) => VARIANTS[m]).map((m) => `${VARIANTS[m]?.name} (${VARIANTS[m]?.desc})`);
  out.push(`== ${depthName(f.index)} — ${f.name}${f.mods.includes('rift') ? ' [Rift]' : ''} · ${ZONES[f.zone]?.name ?? ''} · turn ${s.turn} ==`);
  if (vars.length) out.push(`Floor: ${vars.join('; ')}`);
  const boss = f.actors.find((a) => !a.dead && MONSTERS[a.def]?.boss && (f.vis[idx(f, a.x, a.y)] === 1 || a.ai?.mode === 'hunt'));
  if (boss) out.push(`BOSS ${MONSTERS[boss.def]?.name}: ${Math.ceil(boss.hp)}/${boss.maxHp}`);
  const maxB = playerMaxBreath(s);
  const here = idx(f, p.x, p.y);
  const swimming = isDeep(f, here);
  const armor = b.armor + (b.relics.includes('anchor_charm') ? 1 : 0) + (b.relics.includes('barnacle_plate') ? 2 : 0);
  out.push(`HP ${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}${swimming || p.breath < maxB ? ` · ${p.breath >= 0 ? `Breath ${p.breath}/${maxB}` : `DROWNING (${-p.breath})`}` : ''} · pearls ${b.pearls}${armor ? ` · armor ${armor}` : ''} · you are at (${p.x},${p.y})`);
  const nair = nearestAir(s);
  if (nair) out.push(`Nearest air: ${nair.word}, ${nair.dist} tile${nair.dist === 1 ? '' : 's'}${nair.dist > Math.max(0, p.breath) ? ' (farther than your breath lasts!)' : ''}`);
  if (speedOf(s, p) > 100 && !p.statuses.some((x) => x.id === 'hasted')) out.push('Swift: your Riptide Boots let you act twice per turn while in water.');
  if (p.statuses.length) out.push(`Statuses: ${p.statuses.map((st) => `${STATUSES[st.id].name} ${st.turns}${verbose ? ` (${STATUSES[st.id].desc})` : ''}`).join('; ')}`);
  const e = f.elev[here] as number;
  const exits = f.features.filter((x) => x.kind === 'exit');
  const exitE = exits.length ? Math.min(...exits.map((x) => f.elev[idx(f, x.x, x.y)] as number)) : 0;
  const air = freshAir(s);
  const tide = f.tidePaused ? `Tide held for ${f.tidePaused} turns` : `Tide rises in ${f.tideTimer} (every ${effectiveTideInterval(s)})`;
  const where = isWater(f, here) ? (swimming ? 'You are swimming.' : 'You are wading.') : `Your ground goes under in ~${floodTimes(s, here).deep} turns.`;
  const dl = air && f.index < 9 ? wayUpDeadline(s) : undefined;
  const dlText = dl === undefined ? '' : dl === 0 ? ' · From here, the way up is cut off by deep water (more than one breath).' : ` · From here, the way up stays open for ~${dl} turns.`;
  out.push(`${tide} · water ${f.waterLevel} · your ground ${TERRAIN[f.terrain[here] as number]?.bridge ? `a bridge (dry to water ${BRIDGE_DECK})` : e}${exits.length ? ` · way up ${exitE}` : ''} · ${where}${air ? ` · ${f.index === 9 ? 'The beacon' : 'Fresh air'}: ${air.word}${air.deep ? ` (swims ahead: the longest ~${air.longestSwim} tile${air.longestSwim === 1 ? '' : 's'}${air.longestSwim > playerMaxBreath(s) ? ', more than one breath' : ''})` : ''}` : ''}${dlText}`);
  const w = weaponDef(s);
  const ups = b.weapon.upgrades.map((u) => WEAPON_UPGRADES[u] ? `${WEAPON_UPGRADES[u]?.name}: ${WEAPON_UPGRADES[u]?.desc}` : '').filter(Boolean);
  out.push(`Weapon: ${w.name} · ${playerBaseDamage(s)} dmg${b.relics.includes('tide_pearl') ? ` (+2 while you stand in water${isWater(f, here) ? ', as you do now' : ''})` : ''}${swimming && !b.relics.includes('gillcharm') ? ' (half while swimming)' : ''}${verbose ? ` — ${w.rule}` : ''}${ups.length ? ` [${ups.join(', ')}]` : ''}`);
  out.push(`Abilities (refill each floor): ${b.abilities.length ? b.abilities.map((ab, i) => {
    const d = ABILITIES[ab.def];
    return `[${i + 1}] ${d?.name} ${ab.charges}/${ab.max}${verbose ? ` (${d ? shapeText(d.shape) : ''}): ${d?.desc}` : ''}`;
  }).join(' | ') : 'none'}`);
  out.push(`Belt ${b.belt.filter(Boolean).length}/${b.belt.length}: ${b.belt.map((sl, i) => {
    if (!sl) return `[${i + 1}] empty`;
    const d = CONSUMABLES[sl.def];
    return `[${i + 1}] ${d?.name}${sl.count > 1 ? ` ×${sl.count}` : ''}${verbose ? `: ${d?.desc}` : ''}`;
  }).join(' | ')}`);
  out.push(`Relics ${b.relics.length}/${b.relicSlots}: ${b.relics.length ? b.relics.map((r) => `${RELICS[r]?.name}${verbose ? ` (${RELICS[r]?.desc})` : ''}`).join('; ') : 'none'}${floorSights(s).length ? ` · Somewhere on this floor: ${floorSights(s).join(', ')}.` : ''}`);
  const threats = visibleEnemies(s).sort((a1, a2) => chebyshev(a1.x, a1.y, p.x, p.y) - chebyshev(a2.x, a2.y, p.x, p.y));
  for (const a of unseenWindups(s)) {
    const it = a.ai!.intent!;
    out.push(`Something you can't see is winding up ${it.label} (${it.turns <= 1 ? 'next turn' : `in ${it.turns} turns`})${it.tiles.includes(idx(f, p.x, p.y)) ? ' — you are in it!' : ''} Its marks are the X tiles.`);
  }
  if (threats.length === 0) out.push('In sight: nothing hostile.');
  else {
    out.push('In sight:');
    for (const a of threats.slice(0, 8)) {
      const d = MONSTERS[a.def];
      const inIt = a.ai?.intent?.tiles.includes(idx(f, p.x, p.y)) ? ' — you are in it!' : '';
      out.push(`  ${d?.glyph} ${d?.name} ${Math.max(0, Math.ceil(a.hp))}/${a.maxHp} at (${a.x},${a.y}), ${chebyshev(a.x, a.y, p.x, p.y)} away — ${modeText(a, s)}${inIt}${a.statuses.length ? ` [${a.statuses.map((st) => `${STATUSES[st.id].name} ${st.turns}`).join(', ')}]` : ''}`);
    }
  }
  // Standing in a wind-up: which single steps get out of every marked tile (the browser shows
  // this at a glance as red tiles around you; shallow diagonal lines are easy to misread as text).
  const marked = telegraphTiles(s);
  if (marked.has(idx(f, p.x, p.y))) {
    const outs = Object.entries(DIRS).filter(([, [dx, dy]]) => {
      const x = p.x + dx;
      const y = p.y + dy;
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) return false;
      const i = idx(f, x, y);
      return !!TERRAIN[f.terrain[i] as number]?.walk && !f.actors.some((a) => !a.dead && a.x === x && a.y === y) && !marked.has(i);
    }).map(([k]) => k);
    out.push(`You stand in a marked tile. Steps that leave every marked tile: ${outs.length ? outs.join(', ') : 'none (break its line, or interrupt it)'}.`);
  }
  // Things in view with coordinates, so nobody has to count columns against the ruler.
  const things: string[] = [];
  for (const ft of f.features) {
    if (ft.kind === 'entry' || !f.vis[idx(f, ft.x, ft.y)]) continue;
    const g = featureGlyph(ft.kind, ft.route, !!ft.used)?.glyph ?? '?';
    things.push(`${g} ${featureName(ft)} (${ft.x},${ft.y})`);
  }
  for (const it of f.items) {
    if (!f.vis[idx(f, it.x, it.y)]) continue;
    const bl = describeItem(it);
    things.push(`${itemGlyph(it).glyph} ${bl.title} (${it.x},${it.y})`);
  }
  if (things.length) out.push(`In view: ${things.slice(0, 10).join(' · ')}${things.length > 10 ? ` · and ${things.length - 10} more` : ''}`);
  const ghosts = memory.ghosts(s);
  if (ghosts.length) out.push(`Last seen (out of sight now): ${ghosts.map((g) => `${MONSTERS[g.def]?.name} at (${g.x},${g.y}), ${s.turn - g.turn} turn${s.turn - g.turn === 1 ? '' : 's'} ago`).join('; ')}`);
  const near = f.features.filter((ft) => chebyshev(ft.x, ft.y, p.x, p.y) <= 1 && ft.kind !== 'entry');
  for (const ft of near) out.push(`${ft.x === p.x && ft.y === p.y ? 'Here' : 'Next to you'}: ${featureName(ft)} at (${ft.x},${ft.y})`);
  const it = f.items.find((q) => q.x === p.x && q.y === p.y);
  if (it) out.push(`Underfoot: ${describeTile(s, p.x, p.y).filter((bl) => bl.title !== 'You').map((bl) => `${bl.title} — ${bl.lines.join(' ')}`).join(' / ')}`);
  return out.join('\n');
}

function pendingText(s: GameState): string {
  const pd = s.pending;
  if (!pd) return '';
  const out: string[] = [];
  if (pd.kind === 'weapon') {
    out.push('CHOOSE HOW YOU FIGHT (choose 1-3): three kits lie among the broken seals. Your weapon\'s move works just by attacking; your art refills every floor.');
    pd.options.forEach((o, i) => {
      const [k, art] = o.split('|') as [string, string | undefined];
      const w = WEAPONS[k];
      const a = art ? ABILITIES[art] : undefined;
      out.push(`  ${i + 1}. ${w?.name}${a ? ` + ${a.name}` : ''} (${w?.dmg} damage): ${w?.rule}${a ? ` — ${a.name} (${a.charges}/floor): ${a.desc}` : ''}`);
    });
  } else {
    const f = s.floor;
    const zone = ZONES[f.zone];
    const omen = zone && zone.floors[0] === f.index ? ` ${zone.intro} Omens: ${zone.omens.join(' ')}` : '';
    out.push(`${depthName(f.index)}: ${f.name}. You climb out of the water, gasping. Choose a boon (choose 1-3).${omen}`);
    pd.options.forEach((id, i) => {
      const v = describeBoon(s, id);
      out.push(`  ${i + 1}. [${v.group === 'vital' ? 'Body' : v.group === 'weapon' ? 'Weapon' : 'Art'}] ${v.name}: ${v.desc}`);
    });
  }
  return out.join('\n');
}

function elevMap(s: GameState): string {
  const f = s.floor;
  const rows: string[] = [];
  for (let y = 0; y < f.h; y++) {
    let row = `${String(y).padStart(3)}  `;
    let any = false;
    for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x;
      const td = TERRAIN[f.terrain[i] as number];
      if (!f.seen[i] || !td?.walk) {
        row += f.seen[i] ? '#' : ' ';
        continue;
      }
      any = true;
      const e = Math.max(0, f.elev[i] as number);
      row += e < 10 ? String(e) : String.fromCharCode(87 + Math.min(e, 35));
    }
    if (any) rows.push(row.trimEnd());
  }
  return `Elevation of known ground (water level ${f.waterLevel}; a tile is shallow at depth 1 and deep at 2+):\n${rows.join('\n')}`;
}

// ---------------------------------------------------------------------------

function parse(tok: string[]): Command | { meta: string; args: number[] } | { err: string } {
  const [c, ...rest] = tok;
  const nums = rest.map(Number);
  if (!c) return { err: 'empty command' };
  if (c in DIRS) {
    const d = DIRS[c] as [number, number];
    return { t: 'move', dx: d[0], dy: d[1] };
  }
  switch (c) {
    case 'wait': case '.': return { t: 'wait' };
    case 'attack': return { t: 'attack', x: nums[0] ?? 0, y: nums[1] ?? 0 };
    case 'ability': return rest.length >= 3 ? { t: 'ability', slot: (nums[0] ?? 1) - 1, x: nums[1] as number, y: nums[2] as number } : { t: 'ability', slot: (nums[0] ?? 1) - 1 };
    case 'use': return rest.length >= 3 ? { t: 'use', slot: (nums[0] ?? 1) - 1, x: nums[1] as number, y: nums[2] as number } : { t: 'use', slot: (nums[0] ?? 1) - 1 };
    case 'pickup': {
      const n = rest.find((r) => /^\d+$/.test(r));
      return n ? { t: 'pickup', replace: Number(n) - 1 } : { t: 'pickup' };
    }
    case 'drop': return { t: 'drop', slot: (nums[0] ?? 1) - 1 };
    case 'climb': case '<': case 'ascend': return { t: 'ascend' };
    case 'choose': return { t: 'choose', index: (nums[0] ?? 1) - 1 };
    case 'shrine': return { t: 'shrine', option: (nums[0] ?? 1) - 1 };
    case 'interact': case 'g': case 'look': case 'travel': case 'explore': case 'z': case 'exit': case '>': case 'elev': case 'view': case 'full': case 'preview': case 'bot':
      return { meta: c, args: nums };
    default: return { err: `unknown command "${c}" (try: node scripts/tplay.ts help)` };
  }
}

function main(): void {
  const [name, ...argv] = process.argv.slice(2);
  if (!name || name === 'help') {
    console.log(HELP);
    return;
  }
  mkdirSync('.tmp/tplay', { recursive: true });
  const file = `.tmp/tplay/${name}.json`;
  let s: GameState;
  let sess: Session;
  if (argv[0] === 'new') {
    const seedArg = argv[1] ?? '1';
    const seed = /^\d+$/.test(seedArg) ? Number(seedArg) >>> 0 : seedFromText(seedArg);
    s = newGame(seed);
    sess = { save: '', prefs: {} };
    console.log(`New run, seed ${seed}. You broke the seal at the bottom of the Drowned Deep. Now the sea is coming in. Climb ten floors to the surface; every floor floods from below.`);
    // auto=N: a bot plays the first N floors (loot, fights, boons), then hands the run over.
    const auto = Number(argv.find((a) => a.startsWith('auto='))?.slice(5) ?? 0);
    if (auto > 0) {
      const rng = seedRng(seed ^ 0x9e3779b9);
      for (let n = 0; n < 20000 && s.status === 'playing' && s.floor.index < auto; n++) {
        const r = submit(s, heuristicCommand(s, rng, { knowMap: true }));
        if (!r.ok) submit(s, { t: 'wait' });
      }
      if (s.status !== 'playing') {
        console.log(`The bot died on the way (${s.death?.cause}). Try another seed.`);
        return;
      }
      console.log(`A stand-in played the first ${auto} floor${auto > 1 ? 's' : ''} for you (turn ${s.turn}). The story so far:`);
      for (const c of s.chronicle) console.log(`  [${c.floor === 9 ? 'Surface' : `D${10 - c.floor}`} t${c.turn}] ${c.text}`);
      console.log('It is your run from here.');
    }
  } else {
    if (!existsSync(file)) {
      console.log(`No session "${name}". Start one with: node scripts/tplay.ts ${name} new <seed>`);
      return;
    }
    sess = JSON.parse(readFileSync(file, 'utf8')) as Session;
    s = deserialize(sess.save);
  }
  store.set('undertow.prefs.v1', JSON.stringify(sess.prefs ?? {}));
  memory.floor = s.floor.index;
  for (const m of sess.sightings ?? []) memory.seen.set(m.id, m);
  const lastRef: LogEntry | undefined = s.log[s.log.length - 1];
  const lastN = lastRef?.n ?? 1;
  const notes: string[] = [];
  let extra = '';
  const run = (cmd: Command): boolean => {
    if (s.status !== 'playing') {
      notes.push(`The run is over (${s.status}).`);
      return false;
    }
    const res = submit(s, cmd);
    if (!res.ok) {
      if (res.needs === 'belt') notes.push('Your belt is full: use "pickup R" to leave belt slot R behind.');
      else if (res.needs === 'relic') notes.push('Your relic slots are full: use "pickup R" to set down relic R.');
      else notes.push(`Not possible${res.reason ? `: ${res.reason}` : ''}.`);
      return false;
    }
    if (s.status === 'playing' && !s.pending) for (const text of checkTips(s)) s.log.push({ turn: s.turn, text: `Tip: ${text}`, tone: 'system' });
    memory.update(s);
    return true;
  };
  const script = argv[0] === 'new' ? [] : argv.join(' ').split(';').map((x) => x.trim()).filter(Boolean);
  // Taking an altar relic sinks the others: like the browser's confirm dialog, ask first.
  const altarWarning = (line: string): string | undefined => {
    const it = s.floor.items.find((q) => q.x === player(s).x && q.y === player(s).y);
    if (!it || it.vault === undefined || /\byes\b/.test(line)) return undefined;
    const others = s.floor.items.filter((q) => q.vault === it.vault && q !== it).map((q) => RELICS[q.item.def]?.name ?? q.item.def);
    return `Take the ${RELICS[it.item.def]?.name}? ${RELICS[it.item.def]?.desc ?? ''} The other relic${others.length === 1 ? '' : 's'} on the altar (${others.join(', ')}) will sink. To take it, use "pickup yes".`;
  };
  // A batch stops as soon as a command hurts you or leaves a wind-up newly aimed at you: a
  // player at the keyboard would see that before pressing the next key.
  const aimedAtYou = (): boolean => telegraphTiles(s).has(idx(s.floor, player(s).x, player(s).y));
  // The tide rose while you stand in water: you'd want to look before the next key.
  const tideRoseOnYou = (level: number): string | undefined => {
    const here = idx(s.floor, player(s).x, player(s).y);
    if (s.floor.waterLevel <= level || !isWater(s.floor, here)) return undefined;
    return isDeep(s.floor, here) ? 'the tide rose over your head: you are swimming' : 'the tide rose around you';
  };
  let hpAtLine = player(s).hp;
  let aimedAtLine = aimedAtYou();
  let waterAtLine = s.floor.waterLevel;
  let floorAtLine = s.floor.index;
  outer: for (const [li, line] of script.entries()) {
    if (li > 0 && s.status === 'playing') {
      const hurt = player(s).hp < hpAtLine;
      const aimed = !aimedAtLine && aimedAtYou();
      const tide = s.floor.index === floorAtLine ? tideRoseOnYou(waterAtLine) : undefined;
      if (hurt || aimed || tide) {
        notes.push(`Stopped the batch after "${script[li - 1]}": ${hurt ? `you were hurt (${Math.ceil(hpAtLine)} → ${Math.ceil(player(s).hp)} HP)` : aimed ? 'a wind-up is aimed at you' : tide}. Skipped: ${script.slice(li).join('; ')}.`);
        break;
      }
    }
    hpAtLine = player(s).hp;
    aimedAtLine = aimedAtYou();
    waterAtLine = s.floor.waterLevel;
    floorAtLine = s.floor.index;
    const tok = line.split(/\s+/);
    // "n 3" repeats a step.
    if (tok[0] && tok[0] in DIRS && tok.length === 2 && /^\d+$/.test(tok[1] as string)) {
      for (let k = 0; k < Number(tok[1]); k++) {
        const hp = player(s).hp;
        const level = s.floor.waterLevel;
        const fl = s.floor.index;
        if (!run(parse([tok[0]]) as Command)) continue outer;
        const threat = visibleEnemies(s).find((a) => a.ai?.intent || a.ai?.mode === 'hunt' || a.ai?.mode === 'alert');
        const tide = s.floor.index === fl ? tideRoseOnYou(level) : undefined;
        if (player(s).hp < hp || s.pending || (tide && k + 1 < Number(tok[1])) || (threat && k + 1 < Number(tok[1]))) {
          notes.push(`Stopped repeating "${line}" after ${k + 1} steps: ${s.pending ? 'a choice is pending' : player(s).hp < hp ? 'you were hurt' : tide ?? `${MONSTERS[threat?.def ?? '']?.name ?? 'something'} is after you`}.`);
          continue outer;
        }
      }
      continue;
    }
    const cmd = parse(tok);
    if ('err' in cmd) {
      notes.push(cmd.err);
      continue;
    }
    if ('meta' in cmd) {
      const [a0, a1, a2] = cmd.args;
      const f = s.floor;
      const p = player(s);
      switch (cmd.meta) {
        case 'view':
          break;
        case 'bot': {
          // Debugging aid (not for playtesters): the stand-in plays up to N turns, stopping
          // at a new floor, a pending choice, or when a boss comes into view.
          const rng = seedRng((s.seed ^ s.turn) >>> 0);
          const floor0 = f.index;
          for (let k = 0; k < (a0 || 50) && s.status === 'playing' && !s.pending && s.floor.index === floor0; k++) {
            if (visibleEnemies(s).some((m) => MONSTERS[m.def]?.boss)) break;
            if (!run(heuristicCommand(s, rng, { knowMap: true }))) run({ t: 'wait' });
          }
          break;
        }
        case 'full':
          verbose = true;
          break;
        case 'elev':
          extra += `${elevMap(s)}\n`;
          break;
        case 'look': {
          const x = a0 ?? p.x;
          const y = a1 ?? p.y;
          if (!f.seen[idx(f, x, y)]) extra += `(${x},${y}): unknown.\n`;
          else extra += `Look (${x},${y}), elevation ${f.elev[idx(f, x, y)]}${f.vis[idx(f, x, y)] ? '' : ' (remembered)'}:\n${describeTile(s, x, y).map((bl) => `  ${bl.title}: ${bl.lines.join(' ')}${bl.tip ? ` Tip: ${bl.tip}` : ''}`).join('\n')}\n`;
          break;
        }
        case 'interact':
        case 'g': {
          const shrine = f.features.find((ft) => ft.kind === 'shrine' && !ft.used && chebyshev(ft.x, ft.y, p.x, p.y) <= 1);
          const beacon = f.features.find((ft) => ft.kind === 'beacon' && chebyshev(ft.x, ft.y, p.x, p.y) <= 1);
          const item = f.items.find((it) => it.x === p.x && it.y === p.y);
          const spring = f.features.find((ft) => ft.kind === 'spring' && !ft.used && ft.x === p.x && ft.y === p.y);
          if (beacon) run({ t: 'interact' });
          else if (item && altarWarning(line)) notes.push(altarWarning(line) as string);
          else if (item || spring) run({ t: 'pickup' });
          else if (shrine) extra += `Tide Shrine — you carry ${s.build.pearls} pearls. The shrine answers a single offering, then falls silent: choose one ("shrine K"):\n${SHRINE_OPTIONS.map((o, i) => `  ${i + 1}. ${o.name} — ${o.cost} pearls: ${o.desc}${s.build.pearls >= o.cost ? '' : ' (too costly)'}`).join('\n')}\n`;
          else if (exitHere(s)) run({ t: 'ascend' });
          else notes.push('Nothing to pick up or use here.');
          break;
        }
        case 'preview': {
          const [kind, ...r] = tok.slice(1);
          const n = r.map(Number);
          let pc: Command;
          if (kind === 'attack') pc = { t: 'attack', x: n[0] as number, y: n[1] as number };
          else if (kind === 'ability') pc = { t: 'ability', slot: (n[0] as number) - 1, x: n[1] as number, y: n[2] as number };
          else if (kind === 'use') pc = { t: 'use', slot: (n[0] as number) - 1, x: n[1] as number, y: n[2] as number };
          else {
            notes.push('preview ability|use K X Y, or preview attack X Y');
            break;
          }
          const spec = pc.t === 'ability' ? ABILITIES[s.build.abilities[pc.slot]?.def ?? ''] : pc.t === 'use' ? CONSUMABLES[s.build.belt[pc.slot]?.def ?? ''] : undefined;
          let tiles = new Set<number>();
          if (spec && pc.t !== 'attack' && 'x' in pc && pc.x !== undefined && pc.y !== undefined) {
            const shape = spec.shape;
            const res = shapeTiles(s, p, shape, pc.x, pc.y, true);
            let ts = res.tiles;
            if (shape.k === 'bolt' || shape.k === 'ray') ts = res.path ?? ts;
            if (shape.k === 'bolt' && res.impact && shape.radius) ts = [...ts, ...shapeTiles(s, p, shape, pc.x, pc.y).tiles];
            const eff = spec.effect;
            const el = eff?.element ?? (eff?.dtype === 'fire' ? 'fire' : eff?.dtype === 'lightning' ? 'lightning' : undefined);
            if (eff && (el === 'fire' || el === 'lightning')) {
              const impact = shape.k === 'bolt' ? shapeTiles(s, p, shape, pc.x, pc.y).tiles : ts;
              ts = [...new Set([...ts, ...elementReach(s, impact, el, arcRadius(s, p, eff.power ?? 4))])];
            }
            tiles = new Set(ts);
          } else if (pc.t === 'attack') tiles = new Set([idx(f, pc.x, pc.y)]);
          const pr = previewCommand(s, pc);
          const lines = pr.changes.filter((ch) => {
            const a = f.actors.find((q) => q.id === ch.id);
            return !!a && (a.id === p.id || (!a.submerged && f.vis[idx(f, a.x, a.y)] === 1));
          }).map((ch) => {
            const a = f.actors.find((q) => q.id === ch.id);
            const nm = a?.id === p.id ? 'You' : (MONSTERS[a?.def ?? '']?.name ?? a?.def);
            return `  ${nm}: ${Math.ceil(ch.before)} → ${ch.died ? 'dies' : Math.ceil(ch.after)}${ch.moved ? ` (moved to ${ch.moved.x},${ch.moved.y})` : ''}`;
          });
          extra += `Preview of ${line}: ${pr.ok ? 'valid' : `NOT valid${pr.reason ? ` (${pr.reason})` : ''}`}. Affected tiles marked * below.\n${lines.join('\n') || '  (no HP changes predicted)'}\n${pr.warning ? `  ⚠ ${pr.warning}\n` : ''}${renderMap(s, { tiles, ch: '*' })}\n`;
          break;
        }
        case 'travel':
        case 'explore':
        case 'z':
        case 'exit':
        case '>': {
          const kind = cmd.meta === 'travel' ? 'travel' : cmd.meta === 'exit' || cmd.meta === '>' ? 'exit' : 'explore';
          if (kind === 'travel' && (a0 === undefined || a1 === undefined || !f.seen[idx(f, a0, a1)])) {
            notes.push('travel X Y needs a known tile.');
            break;
          }
          const t = startTravel(s, kind, kind === 'travel' ? idx(f, a0 as number, a1 as number) : undefined);
          if (tok.includes('swim')) t.swim = true;
          let steps = 0;
          for (; steps < 300; steps++) {
            const nx = travelNext(s, t);
            if ('stop' in nx) {
              notes.push(`${kind} stopped after ${steps} steps${nx.stop ? `: ${nx.stop}` : '.'}${nx.swimTiles !== undefined ? ` (You hold ${player(s).breath} breaths. Add "swim" to the command to cross, e.g. "${/\bswim\b/.test(line) ? line : `${line} swim`}".)` : ''}`);
              break;
            }
            if (nx.note) s.log.push({ turn: s.turn, text: nx.note, tone: 'system' });
            if (!run(nx.cmd)) break;
          }
          break;
        }
      }
      void a2;
      continue;
    }
    if (cmd.t === 'pickup' && altarWarning(line)) {
      notes.push(altarWarning(line) as string);
      continue;
    }
    run(cmd);
  }
  // Output.
  const idxLast = lastRef ? s.log.indexOf(lastRef) : -1;
  const fresh: LogEntry[] = [];
  if (lastRef && idxLast >= 0 && (lastRef.n ?? 1) > lastN) fresh.push(lastRef);
  fresh.push(...s.log.slice(idxLast + 1));
  const shownN = (l: LogEntry): string => {
    if (!l.n || l.n <= 1) return '';
    return l === lastRef ? ` (again${(l.n ?? 1) - lastN > 1 ? ` ×${(l.n ?? 1) - lastN}` : ''})` : ` ×${l.n}`;
  };
  if (fresh.length) console.log(`Messages:\n${fresh.map((l) => `  [t${l.turn}] ${l.text}${shownN(l)}`).join('\n')}`);
  if (notes.length) console.log(notes.map((n) => `>> ${n}`).join('\n'));
  if (extra) console.log(extra.trimEnd());
  if (s.status === 'dead' && s.death) {
    const d = s.death;
    console.log(`\n*** THE SEA TAKES YOU — ${d.cause}, ${depthName(s.floor.index)}, turn ${s.turn}. ***`);
    for (const line of recapLines(d.recap)) console.log(`  ${line}`);
    if (d.unusedOuts.length) console.log(`  Unused: ${d.unusedOuts.join(', ')}`);
    console.log('The story:');
    for (const c of s.chronicle) console.log(`  [${c.floor === 9 ? 'Surface' : `D${10 - c.floor}`} t${c.turn}] ${c.text}`);
  } else if (s.status === 'won') {
    console.log('\n*** YOU ESCAPED THE DROWNED DEEP. ***');
    for (const c of s.chronicle) console.log(`  [${c.floor === 9 ? 'Surface' : `D${10 - c.floor}`} t${c.turn}] ${c.text}`);
  } else {
    console.log(sidebar(s));
    const pend = pendingText(s);
    if (pend) console.log(pend);
    console.log(renderMap(s));
    if (verbose) console.log(legend(s));
    else if (shownTerrain.size) console.log(`Terrain here: ${[...shownTerrain].map(([g, n]) => `${g} ${n}`).join(' · ')}`);
  }
  memory.update(s);
  sess.sightings = [...memory.seen.values()];
  sess.save = serialize(s);
  const prefsRaw = store.get('undertow.prefs.v1');
  sess.prefs = prefsRaw ? (JSON.parse(prefsRaw) as Record<string, unknown>) : {};
  writeFileSync(file, JSON.stringify(sess));
}

main();
