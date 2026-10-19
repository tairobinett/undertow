// The application shell: owns the GameState, turns input into commands, and renders.

import { ABILITIES } from '../content/abilities.ts';
import { CONSUMABLES } from '../content/consumables.ts';
import { MONSTERS } from '../content/monsters.ts';
import { RELICS } from '../content/relics.ts';
import type { Shape } from '../content/spec.ts';
import { STATUSES } from '../content/statuses.ts';
import { WEAPONS, WEAPON_UPGRADES } from '../content/weapons.ts';
import { ZONES } from '../content/zones.ts';
import { VARIANTS } from '../content/variants.ts';
import { chebyshev } from '../core/geom.ts';
import { exitHere, newGame, previewCommand, submit } from '../core/game.ts';
import type { SubmitResult } from '../core/game.ts';
import { actorAt as floorActorAt, BRIDGE_DECK, idx, isDeep, isWater } from '../core/floor.ts';
import { TERRAIN } from '../core/terrain.ts';
import { describeBoon } from '../core/progression.ts';
import { attackProblem, SHRINE_OPTIONS, targetProblem, weaponRange } from '../core/player.ts';
import { shapeTiles } from '../core/resolve.ts';
import { arcRadius, elementReach } from '../core/elements.ts';
import { seedFromText, seedRng } from '../core/rng.ts';
import { heuristicCommand } from '../bot/bot.ts';
import { deserialize, serialize } from '../core/save.ts';
import { enemies, freshAir, nearestAir, player, playerBaseDamage, playerMaxBreath, speedOf, weaponDef } from '../core/state.ts';
import { effectiveTideInterval, tideForecast } from '../core/systems.ts';
import type { Actor, Command, GameState } from '../core/types.ts';
import { Anims } from './anim.ts';
import { $, el, esc } from './dom.ts';
import { depthName, floorSights, describeAbility, describeItem, describeMonsterDef, describeTile, effectText, floodTimes, modeText, recapLines, shapeText, turnsUntilLevel, wayUpDeadline } from './inspect.ts';
import type { InfoBlock } from './inspect.ts';
import { MapRenderer } from './render.ts';
import type { Overlay } from './render.ts';
import { clearSave, loadCodex, loadGame, loadHistory, loadPrefs, pushHistory, saveCodex, saveGame, savePrefs } from './storage.ts';
import type { Codex } from './storage.ts';
import { checkTips } from './tips.ts';
import { pathTo, startTravel, telegraphTiles, travelNext, unseenWindups, visibleEnemies as enemiesInView } from './travel.ts';
import { SightMemory } from './memory.ts';
import type { Travel } from './travel.ts';
import { Audio } from './audio.ts';

type Mode =
  | { k: 'play' }
  | { k: 'target'; source: 'ability' | 'item' | 'attack'; slot: number; shape: Shape; x: number; y: number; name: string }
  | { k: 'look'; x: number; y: number };

interface UiTravel extends Travel {
  last: number;
}

const DIR_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
  KeyK: [0, -1], KeyJ: [0, 1], KeyH: [-1, 0], KeyL: [1, 0],
  KeyY: [-1, -1], KeyU: [1, -1], KeyB: [-1, 1], KeyN: [1, 1],
};
const ABILITY_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'];
const ABILITY_LABEL = ['Q', 'W', 'E', 'R'];

export class App {
  state: GameState | null = null;
  readonly renderer: MapRenderer;
  readonly anims = new Anims();
  readonly audio = new Audio();
  mode: Mode = { k: 'play' };
  hover: { x: number; y: number } | null = null;
  travel: UiTravel | null = null;
  modalOpen = false;
  private dirty = true;
  private lastSide = '';
  private deepWarned = -1;
  private pendingDrop = false;
  private touchTimer: number | undefined;
  private codex: Codex = loadCodex();
  private sightings = new SightMemory();
  /** Creatures first met during the current run (for the end screen). */
  private codexNew: string[] = [];

  constructor() {
    this.renderer = new MapRenderer($('map') as HTMLCanvasElement);
    window.addEventListener('resize', () => this.relayout());
    window.addEventListener('keydown', (e) => this.onKey(e));
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    this.audio.enabled = loadPrefs().sound !== false;
    const canvas = this.renderer.canvas;
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
      this.dirty = true;
      this.renderHover();
    });
    canvas.addEventListener('click', (e) => this.onClick(e));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = this.renderer.tileAt(e.clientX, e.clientY);
      if (t && this.state) this.startLook(t.x, t.y);
    });
    canvas.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      this.touchTimer = window.setTimeout(() => {
        const t = this.renderer.tileAt(touch.clientX, touch.clientY);
        if (t) this.startLook(t.x, t.y);
        this.touchTimer = undefined;
      }, 450);
    }, { passive: true });
    canvas.addEventListener('touchend', () => {
      if (this.touchTimer !== undefined) window.clearTimeout(this.touchTimer);
    });
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------------------
  // Run lifecycle

  showTitle(): void {
    this.relayout();
    const saved = loadGame();
    const hist = loadHistory();
    const wins = hist.filter((h) => h.won).length;
    const best = hist.reduce((m, h) => Math.max(m, h.depth), 0);
    const body = el('div', { class: 'title' },
      el('h1', {}, 'UNDERTOW'),
      el('p', { class: 'tag' }, 'You broke the seal at the bottom of the Drowned Deep. Now the sea is coming in.'),
      el('p', { class: 'sub' }, 'Climb ten floors to the surface. Every floor floods from below.'),
    );
    const buttons = el('div', { class: 'menu' });
    if (saved) buttons.append(this.button('Continue run', () => this.continueRun(), 'primary'));
    buttons.append(this.button('New run', () => this.newRun(Math.floor(Math.random() * 1e9)), saved ? '' : 'primary'));
    // The same dungeon for everyone today: compare your climb with a friend's.
    const today = new Date().toISOString().slice(0, 10);
    const daily = el('button', { class: 'btn', title: `Seed "undertow ${today}": the same dungeon for everyone today.` }, `Daily tide · ${today}`);
    daily.addEventListener('click', () => this.newRun(seedFromText(`undertow ${today}`)));
    buttons.append(daily);
    const seedIn = el('input', { type: 'text', placeholder: 'seed (text or number)', class: 'seed', 'aria-label': 'Seed' }) as HTMLInputElement;
    buttons.append(el('div', { class: 'seedrow' }, seedIn, this.button('Seeded run', () => {
      if (seedIn.value.trim()) this.newRun(seedFromText(seedIn.value));
    })));
    buttons.append(this.button('How to play', () => this.showHelp(() => this.showTitle())));
    if (Object.keys(this.codex.monsters).length) buttons.append(this.button('Codex', () => this.showCodex(() => this.showTitle())));
    body.append(buttons);
    if (hist.length) {
      body.append(el('p', { class: 'hist' }, `${hist.length} run${hist.length > 1 ? 's' : ''} · ${wins} escaped · best depth reached: ${depthName(best)}`));
      const list = el('div', { class: 'histlist' });
      for (const h of hist.slice(0, 5)) {
        list.append(el('div', {}, `${h.won ? '★ Escaped' : `✝ ${depthName(h.depth, true)}`} — ${h.cause} · ${WEAPONS[h.weapon]?.name ?? h.weapon} · seed ${h.seed}`));
      }
      body.append(list);
    }
    body.append(el('p', { class: 'foot' }, 'Knowledge is the only thing that carries over between runs.'));
    this.openModal(body, false);
    $('modal').classList.add('titlebg');
  }

  newRun(seed: number): void {
    clearSave();
    this.codexNew = [];
    this.state = newGame(seed);
    this.afterStateChange();
    this.closeModal();
    this.relayout();
    const prefs = loadPrefs();
    if (!prefs.seenHelp) {
      prefs.seenHelp = true;
      savePrefs(prefs);
      this.showHelp(() => this.showPending());
    } else this.showPending();
  }

  /** Serialized current run (for hot reloads). */
  serialize(): string | null {
    return this.state ? serialize(this.state) : null;
  }

  /** Resumes a serialized run. Returns false if it can't be loaded. */
  resume(json: string): boolean {
    try {
      this.state = deserialize(json);
    } catch {
      return false;
    }
    this.closeModal();
    this.relayout();
    this.afterStateChange();
    this.showPending();
    return true;
  }

  continueRun(): void {
    const json = loadGame();
    if (!json) return this.showTitle();
    try {
      this.state = deserialize(json);
    } catch (e) {
      console.error(e);
      clearSave();
      return this.showTitle();
    }
    this.closeModal();
    this.relayout();
    this.afterStateChange();
    this.showPending();
  }

  relayout(): void {
    $('app').classList.toggle('idle', !this.state);
    if (!this.state) return;
    const main = $('main');
    const logH = $('log').offsetHeight || 110;
    const availW = main.clientWidth - 4;
    const availH = Math.max(200, window.innerHeight - logH - 24);
    const f = this.state.floor;
    this.renderer.layout(availW, availH, f.w, f.h);
    const p = player(this.state);
    this.renderer.camX = Math.max(0, Math.min(f.w - this.renderer.viewW, p.x - Math.floor(this.renderer.viewW / 2)));
    this.renderer.camY = Math.max(0, Math.min(f.h - this.renderer.viewH, p.y - Math.floor(this.renderer.viewH / 2)));
    this.dirty = true;
  }

  /** Debug/testing: climb to floor `n` immediately (used by the screenshot tooling). */
  debugWarp(n: number, boonPick = 0): void {
    const s = this.state;
    if (!s) return;
    if (s.pending) submit(s, { t: 'choose', index: boonPick });
    while (s.floor.index < n && s.status === 'playing') {
      const p = player(s);
      const exit = s.floor.features.find((f) => f.kind === 'exit' && f.route === 'stair') ?? s.floor.features.find((f) => f.kind === 'exit');
      if (!exit) break;
      s.floor.occ[p.y * s.floor.w + p.x] = 0;
      p.x = exit.x;
      p.y = exit.y;
      submit(s, { t: 'ascend' });
      submit(s, { t: 'choose', index: boonPick });
    }
    // Reveal the map for inspection.
    this.relayout();
    this.afterStateChange();
  }

  /** Debug/testing: let the heuristic bot play through the real UI for n commands. */
  debugAutoplay(n: number, seed = 1): string {
    const s = this.state;
    if (!s) return 'no game';
    const rng = seedRng(seed);
    let k = 0;
    for (; k < n && s.status === 'playing'; k++) {
      const cmd = heuristicCommand(s, rng, { knowMap: true });
      const res = this.do(cmd);
      if (!res?.ok) this.do({ t: 'wait' });
      if (this.modalOpen && (s.pending || s.status !== 'playing')) this.closeModal();
    }
    return `${k} commands, status ${s.status}, depth ${10 - s.floor.index}, hp ${player(s).hp}/${player(s).maxHp}`;
  }

  /** Debug: reveal the whole floor in memory. */
  debugReveal(): void {
    const s = this.state;
    if (!s) return;
    s.floor.seen.fill(1);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Commands

  do(cmd: Command): SubmitResult | undefined {
    const s = this.state;
    if (!s || s.status !== 'playing') return undefined;
    const floorBefore = s.floor.index;
    const res = submit(s, cmd);
    if (!res.ok && res.needs) {
      this.stopTravel();
      if (res.needs === 'belt') this.promptBeltSwap();
      else this.promptRelicSwap();
      return res;
    }
    this.anims.ingest(s.events, s, performance.now());
    this.audio.ingest(s.events, s);
    if (s.floor.index !== floorBefore) {
      this.relayout();
      this.deepWarned = -1;
    }
    this.afterStateChange();
    const status = s.status as GameState['status'];
    if (status === 'dead') {
      this.stopTravel();
      this.audio.play('death');
      window.setTimeout(() => this.showDeath(), 650);
    } else if (status === 'won') {
      this.audio.play('win');
      this.stopTravel();
      window.setTimeout(() => this.showVictory(), 650);
    } else if (s.pending) {
      this.stopTravel();
      this.showPending();
    }
    return res;
  }

  private afterStateChange(): void {
    const s = this.state;
    if (!s) return;
    this.renderer.invalidateLight();
    const p = player(s);
    this.renderer.follow(p.x, p.y, s.floor.w, s.floor.h);
    this.dirty = true;
    if (s.status === 'playing' && !s.pending) {
      for (const text of checkTips(s)) {
        s.log.push({ turn: s.turn, text: `Tip: ${text}`, tone: 'system' });
        this.toast(text);
      }
    }
    this.sightings.update(s);
    this.renderSide();
    this.renderLog();
    this.renderHover();
    this.noteCodex();
    if (s.status === 'playing') saveGame(serialize(s));
  }

  /** Records newly met creatures, relics and items in the Codex. */
  private noteCodex(): void {
    const s = this.state;
    if (!s) return;
    const f = s.floor;
    const c = this.codex;
    let changed = false;
    for (const a of f.actors) {
      if (a.dead || a.id === s.playerId || a.submerged || !MONSTERS[a.def] || c.monsters[a.def] || !f.vis[idx(f, a.x, a.y)]) continue;
      c.monsters[a.def] = { killedYou: 0 };
      this.codexNew.push(a.def);
      changed = true;
    }
    const noteItem = (kind: string, def: string): void => {
      const list = kind === 'relic' ? c.relics : kind === 'consumable' ? c.items : undefined;
      if (list && !list.includes(def)) {
        list.push(def);
        changed = true;
      }
    };
    for (const it of f.items) if (f.vis[idx(f, it.x, it.y)]) noteItem(it.item.kind, it.item.def);
    for (const r of s.build.relics) noteItem('relic', r);
    for (const b of s.build.belt) if (b) noteItem('consumable', b.def);
    if (changed) saveCodex(c);
  }

  private toastTimer: number | undefined;
  private toast(text: string): void {
    const t = $('toast');
    t.textContent = text;
    t.style.display = 'block';
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.style.display = 'none';
    }, 7000);
  }

  private showPending(): void {
    const s = this.state;
    if (!s?.pending) return;
    if (s.pending.kind === 'weapon') this.showWeaponChoice();
    else this.showBoonChoice();
  }

  // -------------------------------------------------------------------------
  // Frame loop

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const s = this.state;
    if (!s) return;
    this.anims.prune(now);
    if (this.travel && !this.modalOpen && now - this.travel.last > 55 && !this.anims.busy(now)) {
      this.travel.last = now;
      this.travelStep();
    }
    const ov = this.overlay();
    this.renderer.draw(s, ov, this.anims, now);
  }

  private overlay(): Overlay {
    const s = this.state as GameState;
    const f = s.floor;
    const ov: Overlay = { showTide: f.tideTimer <= 4 && f.tidePaused === 0, ghosts: this.sightings.ghosts(s) };
    if (ov.showTide) ov.tideTiles = tideForecast(s);
    if (this.mode.k === 'target') {
      const m = this.mode;
      const p = player(s);
      const res = shapeTiles(s, p, m.shape, m.x, m.y, true);
      let tiles = res.tiles;
      if (m.shape.k === 'bolt' || m.shape.k === 'ray') tiles = res.path ?? tiles;
      if (m.shape.k === 'bolt' && res.impact && m.shape.radius) tiles = [...tiles, ...shapeTiles(s, p, m.shape, m.x, m.y).tiles];
      if (m.source === 'attack') tiles = [idx(f, m.x, m.y)];
      const spec = m.source === 'ability' ? ABILITIES[s.build.abilities[m.slot]?.def ?? '']?.effect : m.source === 'item' ? CONSUMABLES[s.build.belt[m.slot]?.def ?? '']?.effect : undefined;
      const el = spec?.element ?? (spec?.dtype === 'fire' ? 'fire' : spec?.dtype === 'lightning' ? 'lightning' : undefined);
      if (spec && (el === 'fire' || el === 'lightning')) {
        const impact = m.shape.k === 'bolt' ? shapeTiles(s, p, m.shape, m.x, m.y).tiles : tiles;
        tiles = [...new Set([...tiles, ...elementReach(s, impact, el, arcRadius(s, p, spec.power ?? 4))])];
      }
      ov.target = { tiles, valid: this.targetValid() };
      ov.cursor = { x: m.x, y: m.y };
      ov.predict = this.predict();
    } else if (this.mode.k === 'look') {
      ov.cursor = { x: this.mode.x, y: this.mode.y };
    } else if (this.hover && !this.travel) {
      ov.cursor = this.hover;
      const path = this.pathTo(idx(f, this.hover.x, this.hover.y));
      if (path.length > 1) ov.path = path;
    }
    return ov;
  }

  // -------------------------------------------------------------------------
  // Input

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const s = this.state;
    if (this.modalOpen) {
      if (e.key === 'Escape' && this.modalEscape) {
        e.preventDefault();
        this.modalEscape();
      } else if (this.modalKey) this.modalKey(e);
      return;
    }
    if (!s || s.status !== 'playing') return;
    if (this.travel) {
      this.stopTravel();
      e.preventDefault();
      return;
    }
    const code = e.code;
    const key = e.key;

    if (this.mode.k === 'target' || this.mode.k === 'look') {
      e.preventDefault();
      const dir = DIR_KEYS[code];
      if (dir) {
        const m = this.mode;
        const step = e.shiftKey ? 4 : 1;
        m.x = Math.max(0, Math.min(s.floor.w - 1, m.x + dir[0] * step));
        m.y = Math.max(0, Math.min(s.floor.h - 1, m.y + dir[1] * step));
        this.renderHover();
        return;
      }
      if (key === 'Escape') {
        this.mode = { k: 'play' };
        this.renderHover();
        return;
      }
      if (this.mode.k === 'target') {
        if (key === 'Tab') return this.cycleTarget(e.shiftKey ? -1 : 1);
        if (key === 'Enter' || key === ' ' || key === 'f' || code === ABILITY_KEYS[this.mode.slot] || (this.mode.source === 'item' && code === `Digit${this.mode.slot + 1}`)) return this.confirmTarget();
      } else if (key === 'Enter' || key === 'x' || key === 'Escape') {
        this.mode = { k: 'play' };
        this.renderHover();
      }
      return;
    }

    if (this.pendingDrop) {
      this.pendingDrop = false;
      const n = Number(key);
      if (n >= 1 && n <= 5) this.do({ t: 'drop', slot: n - 1 });
      else this.flash('Drop cancelled.');
      e.preventDefault();
      return;
    }

    const dir = DIR_KEYS[code];
    if (dir) {
      e.preventDefault();
      this.move(dir[0], dir[1]);
      return;
    }
    if (key === '.' || code === 'Numpad5' || key === ' ' || code === 'NumpadDecimal') {
      e.preventDefault();
      this.do({ t: 'wait' });
      return;
    }
    const ai = ABILITY_KEYS.indexOf(code);
    if (ai >= 0) {
      e.preventDefault();
      this.useAbility(ai);
      return;
    }
    if (/^Digit[1-5]$/.test(code)) {
      e.preventDefault();
      this.useItem(Number(code.slice(5)) - 1);
      return;
    }
    switch (key) {
      case '<':
      case 'Enter':
        e.preventDefault();
        if (exitHere(s)) this.do({ t: 'ascend' });
        else if (key === '<') this.flash('There is no way up here. Look for < on the map (or press > to travel there).');
        return;
      case '>':
        e.preventDefault();
        this.startTravel('exit');
        return;
      case 'g':
      case ',':
        e.preventDefault();
        this.interact();
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        this.startAttackTarget();
        return;
      case 'x':
        e.preventDefault();
        this.startLook(player(s).x, player(s).y);
        return;
      case 'o':
      case 'z':
        e.preventDefault();
        this.startTravel('explore');
        return;
      case 'd':
        e.preventDefault();
        this.pendingDrop = true;
        this.flash('Drop which belt slot? (1-4)');
        return;
      case '?':
        e.preventDefault();
        this.showHelp();
        return;
      case 'm':
        e.preventDefault();
        this.showMessages();
        return;
      case 'Escape':
        e.preventDefault();
        this.showPause();
        return;
      default:
        return;
    }
  }

  private move(dx: number, dy: number): void {
    const s = this.state as GameState;
    const p = player(s);
    const f = s.floor;
    const tx = p.x + dx;
    const ty = p.y + dy;
    if (tx >= 0 && ty >= 0 && tx < f.w && ty < f.h) {
      const i = idx(f, tx, ty);
      const here = idx(f, p.x, p.y);
      const occupied = floorActorAt(f, tx, ty);
      if (!occupied && isDeep(f, i) && !isDeep(f, here) && this.deepWarned !== f.index && !this.modalOpen) {
        this.deepWarned = f.index;
        this.confirm(`Swim into deep water? You can hold your breath for ${p.breath} turns; after that you drown, faster each turn. Attacks from deep water deal half damage.`, 'Swim', () => this.do({ t: 'move', dx, dy }));
        return;
      }
    }
    this.do({ t: 'move', dx, dy });
  }

  private interact(): void {
    const s = this.state as GameState;
    const p = player(s);
    const f = s.floor;
    const shrine = f.features.find((ft) => ft.kind === 'shrine' && !ft.used && chebyshev(ft.x, ft.y, p.x, p.y) <= 1);
    const beacon = f.features.find((ft) => ft.kind === 'beacon' && chebyshev(ft.x, ft.y, p.x, p.y) <= 1);
    if (beacon) return void this.do({ t: 'interact' });
    const item = f.items.find((it) => it.x === p.x && it.y === p.y);
    if (item?.vault !== undefined) {
      // Taking one relic sinks the others: make sure it's the one you meant.
      const r = RELICS[item.item.def];
      const others = f.items.filter((it) => it.vault === item.vault && it !== item).map((it) => RELICS[it.item.def]?.name ?? it.item.def);
      return this.confirm(`Take the ${r?.name}? ${r?.desc ?? ''} The other relic${others.length === 1 ? '' : 's'} on the altar (${others.join(', ')}) will sink.`, 'Take it', () => this.do({ t: 'pickup' }));
    }
    if (item) return void this.do({ t: 'pickup' });
    if (shrine) return this.showShrine();
    const spring = f.features.find((ft) => ft.kind === 'spring' && !ft.used && ft.x === p.x && ft.y === p.y);
    if (spring) return void this.do({ t: 'pickup' });
    if (exitHere(s)) return void this.do({ t: 'ascend' });
    this.flash('Nothing to pick up or use here.');
  }

  private onMouseMove(e: MouseEvent): void {
    const t = this.renderer.tileAt(e.clientX, e.clientY);
    if (!t) return;
    if (this.mode.k === 'target' || this.mode.k === 'look') {
      if (this.mode.x !== t.x || this.mode.y !== t.y) {
        this.mode.x = t.x;
        this.mode.y = t.y;
        this.renderHover();
      }
      return;
    }
    if (!this.hover || this.hover.x !== t.x || this.hover.y !== t.y) {
      this.hover = t;
      this.renderHover();
    }
  }

  private onClick(e: MouseEvent): void {
    const s = this.state;
    if (!s || s.status !== 'playing' || this.modalOpen) return;
    const t = this.renderer.tileAt(e.clientX, e.clientY);
    if (!t) return;
    if (this.travel) {
      this.stopTravel();
      return;
    }
    if (this.mode.k === 'target') {
      this.mode.x = t.x;
      this.mode.y = t.y;
      this.confirmTarget();
      return;
    }
    if (this.mode.k === 'look') {
      this.mode = { k: 'play' };
      this.renderHover();
      return;
    }
    const f = s.floor;
    const p = player(s);
    if (t.x < 0 || t.y < 0 || t.x >= f.w || t.y >= f.h) return;
    if (t.x === p.x && t.y === p.y) {
      this.interact();
      return;
    }
    const target = floorActorAt(f, t.x, t.y);
    const d = chebyshev(t.x, t.y, p.x, p.y);
    if (target && !target.submerged && f.vis[idx(f, t.x, t.y)] && enemies(s, p, target)) {
      if (d === 1) return this.move(t.x - p.x, t.y - p.y);
      if (this.attackValid(t.x, t.y)) {
        this.do({ t: 'attack', x: t.x, y: t.y });
        return;
      }
    }
    if (d === 1) return this.move(t.x - p.x, t.y - p.y);
    if (!f.seen[idx(f, t.x, t.y)]) return;
    this.startTravel('travel', idx(f, t.x, t.y));
  }

  // -------------------------------------------------------------------------
  // Abilities, items, targeting

  useAbility(slot: number): void {
    const s = this.state as GameState;
    const ab = s.build.abilities[slot];
    if (!ab) return this.flash('No ability in that slot. Learn abilities from boons as you climb.');
    const d = ABILITIES[ab.def];
    if (!d) return;
    if (ab.charges <= 0) return this.flash(`${d.name} is spent until you climb to a new floor.`);
    if (d.shape.k === 'self' || d.shape.k === 'burst') {
      this.do({ t: 'ability', slot });
      return;
    }
    this.startTarget('ability', slot, d.shape, d.name);
  }

  useItem(slot: number): void {
    const s = this.state as GameState;
    const b = s.build.belt[slot];
    if (!b) return this.flash('That belt slot is empty.');
    const d = CONSUMABLES[b.def];
    if (!d) return;
    if (d.use === 'drink') {
      this.do({ t: 'use', slot });
      return;
    }
    this.startTarget('item', slot, d.shape, d.name);
  }

  private startTarget(source: 'ability' | 'item' | 'attack', slot: number, shape: Shape, name: string): void {
    const s = this.state as GameState;
    const p = player(s);
    const near = this.visibleEnemies().sort((a, b) => chebyshev(a.x, a.y, p.x, p.y) - chebyshev(b.x, b.y, p.x, p.y))[0];
    const x = near ? near.x : p.x + 1;
    const y = near ? near.y : p.y;
    this.mode = { k: 'target', source, slot, shape, x, y, name };
    this.flash(`${name}: choose a target — move the cursor or click; Enter to confirm, Tab to cycle, Esc to cancel.`);
    this.renderHover();
  }

  private startAttackTarget(): void {
    const s = this.state as GameState;
    this.startTarget('attack', 0, { k: 'bolt', range: weaponRange(s) }, `${weaponDef(s).name} attack`);
  }

  private visibleEnemies(): Actor[] {
    return enemiesInView(this.state as GameState);
  }

  private cycleTarget(dir: number): void {
    if (this.mode.k !== 'target') return;
    const list = this.visibleEnemies();
    if (list.length === 0) return;
    const m = this.mode;
    const cur = list.findIndex((a) => a.x === m.x && a.y === m.y);
    const next = list[(cur + dir + list.length) % list.length] as Actor;
    m.x = next.x;
    m.y = next.y;
    this.renderHover();
  }

  private attackValid(x: number, y: number): boolean {
    return !attackProblem(this.state as GameState, x, y);
  }

  private targetValid(): boolean {
    if (this.mode.k !== 'target') return false;
    const s = this.state as GameState;
    const m = this.mode;
    if (m.source === 'attack') return this.attackValid(m.x, m.y);
    return !targetProblem(s, m.shape, m.x, m.y);
  }


  private commandForTarget(): Command | undefined {
    if (this.mode.k !== 'target') return undefined;
    const m = this.mode;
    if (m.source === 'ability') return { t: 'ability', slot: m.slot, x: m.x, y: m.y };
    if (m.source === 'item') return { t: 'use', slot: m.slot, x: m.x, y: m.y };
    return { t: 'attack', x: m.x, y: m.y };
  }

  private predict(): Map<number, number> | undefined {
    const s = this.state as GameState;
    if (!this.targetValid()) return undefined;
    const cmd = this.commandForTarget();
    if (!cmd) return undefined;
    const pr = previewCommand(s, cmd);
    if (!pr.ok) return undefined;
    const out = new Map<number, number>();
    for (const ch of pr.changes) {
      // Only creatures you can see: a preview must not give away what lurks under the water.
      const a = s.floor.actors.find((x) => x.id === ch.id);
      if (!a || (a.submerged && a.id !== s.playerId) || !s.floor.vis[idx(s.floor, a.x, a.y)]) continue;
      if (ch.after !== ch.before || ch.died) out.set(ch.id, ch.died ? 0 : Math.ceil(ch.after));
    }
    return out;
  }

  private confirmTarget(): void {
    if (this.mode.k !== 'target') return;
    if (!this.targetValid()) {
      const m = this.mode;
      const s = this.state as GameState;
      const why = m.source === 'attack' ? attackProblem(s, m.x, m.y) : targetProblem(s, m.shape, m.x, m.y);
      this.flash(`Not a valid target${why ? `: ${why}` : ''}.`);
      return;
    }
    const cmd = this.commandForTarget();
    this.mode = { k: 'play' };
    if (cmd) this.do(cmd);
    this.renderHover();
  }

  startLook(x: number, y: number): void {
    this.stopTravel();
    this.mode = { k: 'look', x, y };
    this.renderHover();
  }

  // -------------------------------------------------------------------------
  // Travel and auto-explore

  private pathTo(goal: number): number[] {
    return pathTo(this.state as GameState, goal);
  }

  private startTravel(kind: Travel['kind'], goal?: number, swim = false): void {
    this.travel = { ...startTravel(this.state as GameState, kind, goal), last: 0 };
    if (swim) this.travel.swim = true;
    this.anims.speed = 0.5;
  }

  private stopTravel(): void {
    this.travel = null;
    this.anims.speed = 1;
  }

  private travelStep(): void {
    const s = this.state;
    const t = this.travel;
    if (!s || !t) return this.stopTravel();
    const next = travelNext(s, t);
    if ('stop' in next) {
      this.stopTravel();
      if (next.swimTiles !== undefined) {
        const { kind, goal } = t;
        this.confirm(`${next.stop} You can hold your breath for ${player(s).breath} turns; after that you drown, faster each turn. Swimming, your blows land at half strength.`, 'Swim', () => this.startTravel(kind, goal, true));
        return;
      }
      if (next.stop) this.flash(next.stop);
      return;
    }
    if (next.note) this.flash(next.note);
    const res = this.do(next.cmd);
    if (!res?.ok) this.stopTravel();
  }

  // -------------------------------------------------------------------------
  // Sidebar, log, hover

  private renderSide(): void {
    const s = this.state;
    if (!s) return;
    const f = s.floor;
    const p = player(s);
    const b = s.build;
    const zone = ZONES[f.zone];
    const html: string[] = [];
    html.push(`<div class="hdr"><div class="depth">${depthName(f.index, true)}</div><div class="fname">${esc(f.name)}${f.mods.includes('rift') ? ' <span class="rift">Rift</span>' : ''}${f.mods.filter((m) => VARIANTS[m]).map((m) => ` <span class="variant" title="${esc(VARIANTS[m]?.desc ?? '')}">${esc(VARIANTS[m]?.name ?? m)}</span>`).join('')}</div><div class="zone">${esc(zone?.name ?? '')} · turn ${s.turn}</div></div>`);
    // Boss.
    const boss = f.actors.find((a) => !a.dead && MONSTERS[a.def]?.boss && (f.vis[idx(f, a.x, a.y)] === 1 || a.ai?.mode === 'hunt'));
    if (boss) {
      const bd = MONSTERS[boss.def];
      const bp = Math.max(0, boss.hp / boss.maxHp);
      html.push(`<div class="boss"><div class="bn" style="color:${bd?.color}">${esc(bd?.name ?? '')}</div><div class="bb"><span style="width:${(bp * 100).toFixed(1)}%"></span></div></div>`);
    }
    const beacon = f.features.find((x) => x.kind === 'beacon');
    if (beacon?.progress && s.build.beaconTurn !== undefined && s.build.beaconTurn >= s.turn - 1) {
      html.push(`<div class="beacon">Lighting the beacon… ${beacon.progress}/3</div>`);
    }
    // Vital bars.
    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const hpCls = hpPct > 0.5 ? 'ok' : hpPct > 0.25 ? 'mid' : 'low';
    html.push(`<div class="bar hp ${hpCls}" title="Health. It does not regenerate: heal with tonics, springs, shrines and by climbing (20%)."><span style="width:${(hpPct * 100).toFixed(1)}%"></span><b>HP ${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}</b></div>`);
    const maxB = playerMaxBreath(s);
    const swimming = isDeep(f, idx(f, p.x, p.y));
    if (swimming || p.breath < maxB) {
      const bp = Math.max(0, p.breath) / maxB;
      html.push(`<div class="bar breath ${p.breath <= 1 ? 'low' : ''}" title="Breath. Drops 1 per turn in deep water; refills on any other tile."><span style="width:${(bp * 100).toFixed(1)}%"></span><b>${p.breath >= 0 ? `Breath ${p.breath} / ${maxB}` : `DROWNING (${-p.breath})`}</b></div>`);
      const air = nearestAir(s);
      if (air) html.push(`<div class="nearair ${air.dist > Math.max(0, p.breath) ? 'far' : ''}" title="The nearest place you can breathe: any tile that isn't deep water.">Nearest air: <b>${air.arrow}</b> ${air.word}, ${air.dist} tile${air.dist === 1 ? '' : 's'}</div>`);
    }
    // Tide.
    const e = f.elev[idx(f, p.x, p.y)] as number;
    const interval = effectiveTideInterval(s);
    const underIn = floodTimes(s, idx(f, p.x, p.y)).deep;
    const tideCls = f.tideTimer <= 3 && !f.tidePaused ? 'urgent' : '';
    const exits = f.features.filter((x) => x.kind === 'exit');
    const exitE = exits.length ? Math.min(...exits.map((x) => f.elev[idx(f, x.x, x.y)] as number)) : 0;
    const air = freshAir(s);
    const deadline = air && f.index < 9 ? wayUpDeadline(s) : undefined;
    const deadlineLine = deadline === undefined ? '' : deadline === 0
      ? '<div class="deadline now" title="From where you stand, the route to the way up already needs more than one breath of swimming.">From here, the way up is cut off by deep water.</div>'
      : `<div class="deadline ${deadline <= 30 ? 'soon' : ''}" title="From where you stand: turns until the route to the way up needs more than one breath of swimming. Higher ground buys time.">From here, the way up stays open for ~${deadline} turns.</div>`;
    const airLine = air ? `<div class="air" title="Fresh air flows down from the way up through open passages, over dry ground where it can. Follow it and it leads you there. If it crosses deep water, the way needs a swim.">${f.index === 9 ? 'The beacon' : 'Fresh air'}: <b>${air.arrow}</b> ${air.word}${air.deep ? ` <span class="airdeep">· swims ahead: the longest ~${air.longestSwim} tile${air.longestSwim === 1 ? '' : 's'}${air.longestSwim > playerMaxBreath(s) ? ', more than one breath' : ''}</span>` : ''}</div>${deadlineLine}` : '';
    html.push(`<div class="tide ${tideCls}" title="The tide rises one step every ${interval} turns. Low ground floods first; the way up is on the high ground."><div class="tl">${f.tidePaused ? `<b>Tide held</b> for ${f.tidePaused} turns` : `<b>Tide rises in ${f.tideTimer}</b> <span>(every ${interval})</span>`}</div><div class="tr">Water ${f.waterLevel} · your ground ${TERRAIN[f.terrain[idx(f, p.x, p.y)] as number]?.bridge ? `a bridge (dry to water ${BRIDGE_DECK})` : e}${exits.length ? ` · way up ${exitE}` : ''}</div><div class="tr">${isWater(f, idx(f, p.x, p.y)) ? (swimming ? 'You are swimming.' : 'You are wading.') : `Your ground goes under in ~${underIn} turns.`}</div>${airLine}</div>`);
    // Stats.
    const armor = b.armor + (b.relics.includes('anchor_charm') ? 1 : 0) + (b.relics.includes('barnacle_plate') ? 2 : 0);
    html.push(`<div class="stats"><span title="Pearls: spend at tide shrines and the hermit.">● ${b.pearls} pearls</span>${armor ? `<span title="Armor reduces each physical hit.">⛨ armor ${armor}</span>` : ''}</div>`);
    // Speed from relics shows as a status too: acting twice a turn should never be a mystery.
    const swift = speedOf(s, p) > 100 && !p.statuses.some((st) => st.id === 'hasted');
    if (p.statuses.length || swift) {
      const chips = p.statuses.map((st) => `<span class="st" style="border-color:${STATUSES[st.id].color};color:${STATUSES[st.id].color}" title="${esc(STATUSES[st.id].desc)}">${STATUSES[st.id].name} ${st.turns}</span>`);
      if (swift) chips.push(`<span class="st" style="border-color:${STATUSES.hasted.color};color:${STATUSES.hasted.color}" title="Your Riptide Boots: in water you act twice for every turn of the world.">Swift (in water)</span>`);
      html.push(`<div class="statuses">${chips.join('')}</div>`);
    }
    // Order by urgency: threats, then what you can do, then reference text.
    // Threats.
    const threats = this.visibleEnemies().sort((a1, a2) => chebyshev(a1.x, a1.y, p.x, p.y) - chebyshev(a2.x, a2.y, p.x, p.y));
    html.push('<div class="sec"><h3>In sight</h3>');
    const unseen = unseenWindups(s);
    for (const a of unseen) {
      const it = a.ai!.intent!;
      const inIt = it.tiles.includes(idx(f, p.x, p.y));
      html.push(`<div class="threat danger"><span class="g" style="color:#ff5050">?</span><div class="tb"><div class="tn">Something you can't see</div><div class="tm">⚠ ${esc(it.label)} — ${it.turns <= 1 ? 'next turn' : `in ${it.turns} turns`}${inIt ? ' — you are in it!' : ''}</div></div></div>`);
    }
    if (threats.length === 0 && unseen.length === 0) html.push('<div class="dim small">Nothing hostile in view.</div>');
    // Standing in a wind-up: the single steps that leave every marked tile.
    const marked = telegraphTiles(s);
    if (marked.has(idx(f, p.x, p.y))) {
      const steps: [number, number, string][] = [[0, -1, '↑'], [1, -1, '↗'], [1, 0, '→'], [1, 1, '↘'], [0, 1, '↓'], [-1, 1, '↙'], [-1, 0, '←'], [-1, -1, '↖']];
      const outs = steps.filter(([dx, dy]) => {
        const x = p.x + dx;
        const y = p.y + dy;
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) return false;
        const i = idx(f, x, y);
        return !!TERRAIN[f.terrain[i] as number]?.walk && !f.actors.some((a) => !a.dead && a.x === x && a.y === y) && !marked.has(i);
      }).map(([, , g]) => g);
      html.push(`<div class="small inmark">You stand in a marked tile. ${outs.length ? `Steps out: <b>${outs.join(' ')}</b>` : 'No single step gets out: break its line, or interrupt it.'}</div>`);
    }
    for (const a of threats.slice(0, 8)) {
      const d = MONSTERS[a.def];
      if (!d) continue;
      const pct = Math.max(0, a.hp / a.maxHp);
      const inIt = a.ai?.intent?.tiles.includes(idx(f, p.x, p.y));
      const mt = `${modeText(a, s)}${inIt ? ' — you are in it!' : ''}`;
      html.push(`<div class="threat ${a.ai?.intent ? 'danger' : ''}" data-x="${a.x}" data-y="${a.y}"><span class="g" style="color:${d.color}">${esc(d.glyph)}</span><div class="tb"><div class="tn">${esc(d.name)} <span class="dim">${Math.max(0, Math.ceil(a.hp))}/${a.maxHp}</span></div><div class="mini"><span style="width:${(pct * 100).toFixed(0)}%"></span></div><div class="tm">${esc(mt)}</div></div></div>`);
    }
    html.push('</div>');
    // Abilities.
    html.push('<div class="sec"><h3>Abilities <span class="dim">refill each floor</span></h3>');
    if (b.abilities.length === 0) html.push('<div class="dim small">None yet — boons may teach you some.</div>');
    b.abilities.forEach((ab, i) => {
      const d = ABILITIES[ab.def];
      if (!d) return;
      const pips = Array.from({ length: ab.max }, (_, k) => `<i class="${k < ab.charges ? 'on' : ''}"></i>`).join('');
      html.push(`<button class="slot ab ${ab.charges ? '' : 'spent'}" data-ab="${i}" title="${esc(d.desc)}"><kbd>${ABILITY_LABEL[i]}</kbd><span style="color:${d.color}">${esc(d.name)}</span><span class="pips">${pips}</span></button>`);
    });
    html.push('</div>');
    // Belt.
    html.push(`<div class="sec"><h3>Belt <span class="dim">${b.belt.filter(Boolean).length}/${b.belt.length}</span></h3>`);
    b.belt.forEach((sl, i) => {
      if (!sl) {
        html.push(`<div class="slot empty"><kbd>${i + 1}</kbd><span class="dim">empty</span></div>`);
        return;
      }
      const d = CONSUMABLES[sl.def];
      html.push(`<button class="slot it" data-it="${i}" title="${esc(d?.desc ?? '')}"><kbd>${i + 1}</kbd><span style="color:${d?.color}">${esc(d?.name ?? sl.def)}</span>${sl.count > 1 ? `<span class="cnt">×${sl.count}</span>` : ''}</button>`);
    });
    html.push('</div>');
    // Weapon.
    const w = weaponDef(s);
    html.push(`<div class="sec"><h3>Weapon</h3><div class="wpn" title="${esc(w.rule)}"><span class="g" style="color:${w.color}">)</span> <b>${esc(w.name)}</b> <span class="dim">· ${playerBaseDamage(s)} dmg</span>${b.relics.includes('tide_pearl') ? ` <span class="${isWater(f, idx(f, p.x, p.y)) ? 'airdeep' : 'dim'}">+2 in water</span>` : ''}${swimming && !b.relics.includes('gillcharm') ? ' <span class="airdeep">(half while swimming)</span>' : ''}</div><div class="rule">${esc(w.rule)}${b.weapon.upgrades.map((u) => WEAPON_UPGRADES[u]).filter(Boolean).map((u) => `<div class="upg"><b>${esc(u?.name ?? '')}:</b> ${esc(u?.desc ?? '')}</div>`).join('')}</div></div>`);
    // Relics.
    html.push(`<div class="sec"><h3>Relics <span class="dim">${b.relics.length}/${b.relicSlots}</span></h3>`);
    const vaultHere = s.floor.items.some((it) => it.vault !== undefined);
    const unfound = floorSights(s);
    if (unfound.length) html.push(`<div class="small vaulthint">Somewhere on this floor: ${esc(unfound.join(', '))}.</div>`);
    else if (!vaultHere && b.relics.length === 0) html.push('<div class="dim small">Relic vaults (♦) offer three — take one.</div>');
    for (const r of b.relics) {
      const d = RELICS[r];
      html.push(`<div class="relic" title="${esc(d?.desc ?? '')}"><span style="color:${d?.color}">♦ ${esc(d?.name ?? r)}</span><div class="small dim">${esc(d?.desc ?? '')}</div></div>`);
    }
    html.push('</div>');
    const out = html.join('');
    if (out !== this.lastSide) {
      this.lastSide = out;
      const side = $('side');
      side.innerHTML = out;
      side.querySelectorAll<HTMLButtonElement>('button[data-ab]').forEach((btn) => btn.addEventListener('click', () => this.useAbility(Number(btn.dataset.ab))));
      side.querySelectorAll<HTMLButtonElement>('button[data-it]').forEach((btn) => btn.addEventListener('click', () => this.useItem(Number(btn.dataset.it))));
      side.querySelectorAll<HTMLElement>('.threat').forEach((d) => d.addEventListener('mouseenter', () => {
        this.hover = { x: Number(d.dataset.x), y: Number(d.dataset.y) };
        this.renderHover();
      }));
    }
  }

  private renderLog(): void {
    const s = this.state;
    if (!s) return;
    const log = $('log');
    const lines = s.log.slice(-7);
    log.innerHTML = lines.map((l) => `<div class="ln ${l.tone} ${l.turn >= s.turn - 1 ? 'new' : ''}">${esc(l.text)}${l.n && l.n > 1 ? ` <span class="dim">×${l.n}</span>` : ''}</div>`).join('');
  }

  private flash(text: string): void {
    const s = this.state;
    if (!s) return;
    s.log.push({ turn: s.turn, text, tone: 'system' });
    this.renderLog();
  }

  private renderHover(): void {
    const s = this.state;
    const box = $('hover');
    if (!s) {
      box.style.display = 'none';
      return;
    }
    let tile: { x: number; y: number } | null = null;
    if (this.mode.k === 'look' || this.mode.k === 'target') tile = { x: this.mode.x, y: this.mode.y };
    else if (this.hover) tile = this.hover;
    if (!tile) {
      box.style.display = 'none';
      return;
    }
    const blocks: InfoBlock[] = describeTile(s, tile.x, tile.y);
    if (this.mode.k === 'target') {
      const m = this.mode;
      const valid = this.targetValid();
      const head: InfoBlock = { title: m.name, color: '#ffd860', lines: [valid ? 'Enter / click to confirm · Tab: next target · Esc: cancel' : 'Out of range or not visible.'] };
      if (m.source === 'ability') {
        const ab = s.build.abilities[m.slot];
        const d = ab ? ABILITIES[ab.def] : undefined;
        if (d) head.lines.unshift(`${shapeText(d.shape)} — ${effectText(d.effect) || d.desc}`);
      } else if (m.source === 'item') {
        const sl = s.build.belt[m.slot];
        const d = sl ? CONSUMABLES[sl.def] : undefined;
        if (d) head.lines.unshift(d.desc);
      }
      const cmd = valid ? this.commandForTarget() : undefined;
      const warning = cmd ? previewCommand(s, cmd).warning : undefined;
      if (warning) head.lines.push(`⚠ ${warning}`);
      blocks.unshift(head);
    }
    if (blocks.length === 0) {
      box.style.display = 'none';
      return;
    }
    box.innerHTML = blocks
      .map((bl) => `<div class="blk"><div class="bt" style="${bl.color ? `color:${bl.color}` : ''}">${esc(bl.title)}</div>${bl.lines.filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('')}${bl.tip ? `<div class="tip">${esc(bl.tip)}</div>` : ''}</div>`)
      .join('');
    box.style.display = 'block';
  }

  // -------------------------------------------------------------------------
  // Modals

  private modalEscape: (() => void) | null = null;
  private modalKey: ((e: KeyboardEvent) => void) | null = null;

  private openModal(content: HTMLElement, closable = true, onKey?: (e: KeyboardEvent) => void): void {
    const m = $('modal');
    m.innerHTML = '';
    m.classList.remove('titlebg');
    const card = el('div', { class: 'card' }, content);
    m.append(card);
    m.style.display = 'flex';
    $('toast').style.display = 'none';
    this.modalOpen = true;
    this.modalEscape = closable ? () => this.closeModal() : null;
    this.modalKey = onKey ?? null;
    this.stopTravel();
    const firstBtn = card.querySelector<HTMLElement>('button.primary, button');
    firstBtn?.focus({ preventScroll: true });
  }

  closeModal(): void {
    const m = $('modal');
    m.style.display = 'none';
    m.innerHTML = '';
    m.classList.remove('titlebg');
    this.modalOpen = false;
    this.modalEscape = null;
    this.modalKey = null;
  }

  private button(label: string, fn: () => void, cls = ''): HTMLButtonElement {
    const b = el('button', { class: `btn ${cls}` }, label);
    b.addEventListener('click', fn);
    return b;
  }

  private choiceCards(title: string, sub: string, cards: { name: string; desc: string; tag?: string; color?: string; extra?: string }[], pick: (i: number) => void, closable = false): void {
    const wrap = el('div', { class: 'choice' }, el('h2', {}, title), el('p', { class: 'sub' }, sub));
    const row = el('div', { class: 'cards' });
    cards.forEach((c, i) => {
      const card = el('button', { class: 'ccard' },
        el('div', { class: 'ck' }, `${i + 1}`),
        c.tag ? el('div', { class: 'ctag' }, c.tag) : null,
        el('div', { class: 'cn', style: c.color ? `color:${c.color}` : '' }, c.name),
        el('div', { class: 'cd' }, c.desc),
        c.extra ? el('div', { class: 'cx' }, c.extra) : null,
      );
      card.addEventListener('click', () => pick(i));
      row.append(card);
    });
    wrap.append(row);
    this.openModal(wrap, closable, (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= cards.length) {
        e.preventDefault();
        pick(n - 1);
      }
    });
  }

  private showWeaponChoice(): void {
    const s = this.state as GameState;
    if (s.pending?.kind !== 'weapon') return;
    const opts = s.pending.options;
    this.choiceCards('Choose how you fight', 'Three kits lie among the broken seals of the Reliquary. Your weapon\'s move works just by attacking; your art refills every floor.', opts.map((o) => {
      const [k, art] = o.split('|') as [string, string | undefined];
      const w = WEAPONS[k];
      const a = art ? ABILITIES[art] : undefined;
      return {
        name: `${w?.name ?? k}${a ? ` + ${a.name}` : ''}`,
        desc: w?.rule ?? '',
        tag: `${w?.dmg} damage`,
        color: w?.color,
        extra: a ? `${a.name} (${a.charges}/floor): ${a.desc}` : w?.flavor,
      };
    }), (i) => {
      this.closeModal();
      this.do({ t: 'choose', index: i });
    });
  }

  private showBoonChoice(): void {
    const s = this.state as GameState;
    if (s.pending?.kind !== 'boon') return;
    const opts = s.pending.options;
    const f = s.floor;
    const zone = ZONES[f.zone];
    const omen = zone && zone.floors[0] === f.index ? ` ${zone.intro} Omens: ${zone.omens.join(' ')}` : '';
    this.choiceCards(`${depthName(f.index, true)}: ${f.name}`, `You climb out of the water, gasping. Choose a boon.${omen}`, opts.map((id) => {
      const v = describeBoon(s, id);
      return { name: v.name, desc: v.desc, tag: v.group === 'vital' ? 'Body' : v.group === 'weapon' ? 'Weapon' : 'Art' };
    }), (i) => {
      this.closeModal();
      this.do({ t: 'choose', index: i });
    });
  }

  private showShrine(): void {
    const s = this.state as GameState;
    this.choiceCards('Tide Shrine', `Cold water pools in a stone bowl. You carry ${s.build.pearls} pearls. The shrine answers a single offering, then falls silent: choose one.`, SHRINE_OPTIONS.map((o) => ({ name: `${o.name} — ${o.cost} pearls`, desc: o.desc, tag: s.build.pearls >= o.cost ? 'Affordable' : 'Too costly' })), (i) => {
      this.closeModal();
      this.do({ t: 'shrine', option: i });
    }, true);
  }

  private promptBeltSwap(): void {
    const s = this.state as GameState;
    const p = player(s);
    const it = s.floor.items.find((x) => x.x === p.x && x.y === p.y);
    const newName = it ? describeItem(it).title : 'the item';
    this.choiceCards('Belt full', `Take ${newName} — which slot do you leave behind? (Esc to keep your belt)`, s.build.belt.map((sl) => {
      const d = sl ? CONSUMABLES[sl.def] : undefined;
      return { name: d ? `${d.name}${sl && sl.count > 1 ? ` ×${sl.count}` : ''}` : 'empty', desc: d?.desc ?? '' };
    }), (i) => {
      this.closeModal();
      this.do({ t: 'pickup', replace: i });
    }, true);
  }

  private promptRelicSwap(): void {
    const s = this.state as GameState;
    const p = player(s);
    const it = s.floor.items.find((x) => x.x === p.x && x.y === p.y);
    const newD = it ? describeItem(it) : undefined;
    this.choiceCards('Relic slots full', `Take ${newD?.title ?? 'the relic'} (${newD?.lines[0] ?? ''}) — which relic do you set down?`, s.build.relics.map((r) => ({ name: RELICS[r]?.name ?? r, desc: RELICS[r]?.desc ?? '', color: RELICS[r]?.color })), (i) => {
      this.closeModal();
      this.do({ t: 'pickup', replace: i });
    }, true);
  }

  private confirm(text: string, yes: string, fn: () => void): void {
    const body = el('div', { class: 'confirm' }, el('p', {}, text));
    const row = el('div', { class: 'menu row' });
    row.append(this.button(yes, () => {
      this.closeModal();
      fn();
    }, 'primary'), this.button('Cancel', () => this.closeModal()));
    body.append(row);
    this.openModal(body, true, (e) => {
      if (e.key === 'Enter' || e.key === 'y') {
        e.preventDefault();
        this.closeModal();
        fn();
      }
    });
  }

  private showPause(): void {
    const body = el('div', { class: 'pause' }, el('h2', {}, 'Paused'));
    const menu = el('div', { class: 'menu' });
    menu.append(this.button('Resume', () => this.closeModal(), 'primary'));
    menu.append(this.button('How to play', () => this.showHelp(() => this.showPause())));
    menu.append(this.button('Message history', () => this.showMessages()));
    menu.append(this.button('Codex', () => this.showCodex(() => this.showPause())));
    menu.append(this.button(`Sound: ${this.audio.enabled ? 'on' : 'off'}`, () => {
      this.audio.enabled = !this.audio.enabled;
      const prefs = loadPrefs();
      prefs.sound = this.audio.enabled;
      savePrefs(prefs);
      this.showPause();
    }));
    menu.append(this.button('Save & return to title', () => {
      this.closeModal();
      this.showTitle();
    }));
    menu.append(this.button('Abandon run', () => this.confirm('Abandon this run? It will count as a death.', 'Abandon', () => {
      const s = this.state;
      if (!s) return;
      s.status = 'dead';
      s.death = { cause: 'Abandoned the climb', killer: 'you', floor: s.floor.index, turn: s.turn, recap: s.dmgLog.slice(-8), unusedOuts: [] };
      this.showDeath();
    })));
    body.append(menu);
    this.openModal(body, true);
  }

  /** Everything the Deep has shown you across runs. */
  showCodex(after?: () => void): void {
    const c = this.codex;
    const body = el('div', { class: 'codex' }, el('h2', {}, 'The Codex'), el('p', { class: 'sub' }, 'What the Deep has taught you. Knowledge is the only thing that carries over between runs.'));
    const keys = Object.keys(MONSTERS);
    const home = (k: string): string => {
      if (k === 'abbot' || k === 'faithful') return 'cloister';
      if (k === 'leviathan') return 'surface';
      return (Object.values(ZONES).find((z) => z.encounters.some((e) => e.group.some(([m]) => m === k)))?.id) ?? 'deep';
    };
    const known = keys.filter((k) => c.monsters[k]).length;
    body.append(el('h3', {}, `Creatures — ${known} of ${keys.length} met`));
    for (const z of Object.values(ZONES)) {
      const inZone = keys.filter((k) => home(k) === z.id);
      if (!inZone.length) continue;
      const grid = el('div', { class: 'cx-grid' });
      for (const k of inZone) {
        const d = MONSTERS[k];
        const rec = c.monsters[k];
        if (!d) continue;
        if (!rec) {
          grid.append(el('div', { class: 'cx-card unknown' }, el('div', { class: 'cx-h' }, el('span', { class: 'g' }, '?'), el('b', {}, 'Not yet met'))));
          continue;
        }
        const info = describeMonsterDef(d);
        const card = el('div', { class: 'cx-card' }, el('div', { class: 'cx-h' }, el('span', { class: 'g', style: `color:${d.color}` }, d.glyph), el('b', { style: `color:${d.color}` }, info.title), rec.killedYou ? el('span', { class: 'cx-kills' }, `killed you ×${rec.killedYou}`) : null));
        for (const line of info.lines) card.append(el('div', { class: 'cx-l' }, line));
        if (info.tip) card.append(el('div', { class: 'cx-tip' }, info.tip));
        grid.append(card);
      }
      body.append(el('div', { class: 'cx-zone' }, z.name), grid);
    }
    const listSection = (title: string, all: Record<string, { name: string; desc: string; color: string }>, seen: string[]): void => {
      const keysAll = Object.keys(all);
      body.append(el('h3', {}, `${title} — ${seen.filter((k) => all[k]).length} of ${keysAll.length} found`));
      const grid = el('div', { class: 'cx-grid' });
      for (const k of keysAll) {
        const d = all[k];
        if (!d || !seen.includes(k)) continue;
        grid.append(el('div', { class: 'cx-card' }, el('div', { class: 'cx-h' }, el('b', { style: `color:${d.color}` }, d.name)), el('div', { class: 'cx-l' }, d.desc)));
      }
      body.append(grid);
    };
    listSection('Relics', RELICS, c.relics);
    listSection('Belt items', CONSUMABLES, c.items);
    body.append(this.button(after ? 'Back' : 'Close', () => {
      this.closeModal();
      after?.();
    }, 'primary'));
    this.openModal(body, true);
    if (after) this.modalEscape = () => {
      this.closeModal();
      after();
    };
  }

  showMessages(): void {
    const s = this.state;
    if (!s) return;
    const body = el('div', { class: 'msgs' }, el('h2', {}, 'Messages'));
    const list = el('div', { class: 'msglist' });
    for (const l of s.log.slice(-120)) list.append(el('div', { class: `ln ${l.tone}` }, `${l.turn}: ${l.text}${l.n && l.n > 1 ? ` ×${l.n}` : ''}`));
    body.append(list, this.button('Close', () => this.closeModal(), 'primary'));
    this.openModal(body, true);
    list.scrollTop = list.scrollHeight;
  }

  showHelp(after?: () => void): void {
    const body = el('div', { class: 'help' });
    body.innerHTML = HELP_HTML;
    const btn = this.button(after ? 'Continue' : 'Close', () => {
      this.closeModal();
      after?.();
    }, 'primary');
    body.append(btn);
    this.openModal(body, true);
    if (after) this.modalEscape = () => {
      this.closeModal();
      after();
    };
  }

  private recordRun(won: boolean): void {
    const s = this.state as GameState;
    const killer = s.death?.killerDef;
    if (!won && killer && MONSTERS[killer]) {
      const entry = (this.codex.monsters[killer] ??= { killedYou: 0 });
      entry.killedYou += 1;
      saveCodex(this.codex);
    }
    pushHistory({
      date: new Date().toISOString(),
      seed: s.seed,
      won,
      depth: s.floor.index,
      cause: won ? 'Escaped the Drowned Deep' : (s.death?.cause ?? 'Died'),
      weapon: s.build.weapon.def,
      turns: s.turn,
      kills: s.stats.kills,
    });
    clearSave();
  }

  /** What the death can teach: the killer's counterplay, or how to survive the hazard. */
  private lesson(): string | undefined {
    const s = this.state as GameState;
    const d = s.death;
    if (!d) return undefined;
    const m = d.killerDef ? MONSTERS[d.killerDef] : undefined;
    if (m) {
      const n = this.codex.monsters[m.key]?.killedYou ?? 0;
      return `${n > 1 ? `The ${m.name.toLowerCase()} has killed you ${n} times. ` : ''}Next time: ${m.tip}`;
    }
    const byCause: Record<string, string> = {
      Drowned: 'Next time: deep water costs a breath every turn. Watch the Breath bar, and follow the fresh air uphill before the tide closes over the low ground.',
      'Burned to death': 'Next time: step into water (even shallow) to put the flames out, and keep off grass and brush while you burn.',
      'Burned alive': 'Next time: fire spreads through grass, brush, wood and oil. The red telegraph shows where it will reach; stand outside it.',
      'Succumbed to poison': 'Next time: miasma hangs where bloats burst. Step out of the cloud, or burn it away from a distance.',
      'Scalded by steam': 'Next time: fire on water makes steam. It scalds and blocks sight, and fades in a few turns.',
      'Choked on miasma': 'Next time: miasma hangs where bloats burst. Step out of the cloud, or burn it away from a distance.',
    };
    return byCause[d.cause];
  }

  /** "New in your Codex": creatures first met on this run. */
  private appendLearned(body: HTMLElement): void {
    const names = this.codexNew.map((k) => MONSTERS[k]?.name).filter(Boolean);
    if (names.length) body.append(el('p', { class: 'learned' }, `New in your Codex: ${names.join(', ')}.`));
  }

  private morgue(won: boolean): string {
    const s = this.state as GameState;
    const lines: string[] = [];
    lines.push(`UNDERTOW — ${won ? 'ESCAPED' : 'DIED'} — seed ${s.seed}`);
    lines.push(won ? 'Reached the surface.' : `${s.death?.cause} on ${depthName(s.floor.index)} (${s.floor.name}), turn ${s.turn}.`);
    lines.push(`Weapon: ${weaponDef(s).name}${s.build.weapon.upgrades.length ? ` (${s.build.weapon.upgrades.map((u) => WEAPON_UPGRADES[u]?.name).join(', ')})` : ''}`);
    lines.push(`Relics: ${s.build.relics.map((r) => RELICS[r]?.name).join(', ') || 'none'}`);
    lines.push(`Abilities: ${s.build.abilities.map((a) => ABILITIES[a.def]?.name).join(', ') || 'none'}`);
    lines.push(`Kills ${s.stats.kills} · damage dealt ${s.stats.damageDealt} · taken ${s.stats.damageTaken} · pearls ${s.stats.pearlsFound}`);
    lines.push('');
    lines.push('The story:');
    for (const c of s.chronicle) lines.push(`  [${c.floor === 9 ? 'Surface' : `D${10 - c.floor}`} t${c.turn}] ${c.text}`);
    if (!won && s.death) {
      lines.push('');
      lines.push('Last blows:');
      for (const line of recapLines(s.death.recap)) lines.push(`  ${line}`);
      if (s.death.unusedOuts.length) lines.push(`Unused: ${s.death.unusedOuts.join(', ')}`);
    }
    return lines.join('\n');
  }

  showDeath(): void {
    const s = this.state as GameState;
    this.recordRun(false);
    const d = s.death;
    const body = el('div', { class: 'death' }, el('h2', {}, 'The sea takes you'), el('p', { class: 'cause' }, `${d?.cause ?? 'You died'} — ${depthName(s.floor.index)}, turn ${s.turn}.`));
    if (d?.recap.length) {
      const rec = el('div', { class: 'recap' }, el('h3', {}, 'What happened'));
      for (const line of recapLines(d.recap)) rec.append(el('div', {}, line));
      body.append(rec);
    }
    if (d?.unusedOuts.length) body.append(el('p', { class: 'outs' }, `You died still holding: ${d.unusedOuts.join(', ')}.`));
    const lesson = this.lesson();
    if (lesson) body.append(el('p', { class: 'lesson' }, lesson));
    this.appendLearned(body);
    body.append(this.storyBlock());
    const menu = el('div', { class: 'menu row' });
    menu.append(this.button('New run', () => this.newRun(Math.floor(Math.random() * 1e9)), 'primary'));
    menu.append(this.button(`Retry seed ${s.seed}`, () => this.newRun(s.seed)));
    menu.append(this.button('Copy morgue', () => {
      void navigator.clipboard?.writeText(this.morgue(false)).catch(() => undefined);
    }));
    menu.append(this.button('Title', () => this.showTitle()));
    body.append(menu);
    this.openModal(body, false, (e) => {
      if (e.key === 'Enter') this.newRun(Math.floor(Math.random() * 1e9));
    });
  }

  showVictory(): void {
    const s = this.state as GameState;
    this.recordRun(true);
    const body = el('div', { class: 'victory' }, el('h2', {}, 'You reach the surface'), el('p', { class: 'cause' }, `Seed ${s.seed} · ${s.turn} turns · ${s.stats.kills} kills · ${weaponDef(s).name}`));
    this.appendLearned(body);
    body.append(this.storyBlock());
    const menu = el('div', { class: 'menu row' });
    menu.append(this.button('New run', () => this.newRun(Math.floor(Math.random() * 1e9)), 'primary'));
    menu.append(this.button('Copy run summary', () => {
      void navigator.clipboard?.writeText(this.morgue(true)).catch(() => undefined);
    }));
    menu.append(this.button('Title', () => this.showTitle()));
    body.append(menu);
    this.openModal(body, false);
  }

  private storyBlock(): HTMLElement {
    const s = this.state as GameState;
    const block = el('div', { class: 'story' }, el('h3', {}, 'Your climb'));
    for (const c of s.chronicle.slice(-14)) block.append(el('div', {}, `${c.floor === 9 ? 'Surface' : `D${10 - c.floor}`} · ${c.text}`));
    const st = s.stats;
    block.append(el('div', { class: 'dim' }, `Kills ${st.kills} · dealt ${st.damageDealt} · taken ${st.damageTaken} · items used ${st.itemsUsed} · abilities cast ${st.abilitiesUsed} · pearls ${st.pearlsFound}`));
    return block;
  }
}

const HELP_HTML = `
<h2>How to play UNDERTOW</h2>
<div class="cols">
<div>
<h3>The Tide</h3>
<p>Every floor floods from its lowest ground, one step every few turns. You arrive low; the way up (<b class="gold">&lt;</b>) is on the high ground. The sidebar counts down the next rise, and when it's close, the tiles about to flood are outlined in blue. Follow the <b>fresh air</b> in the sidebar: it flows from the way up along the safest route, and warns if that route needs a long swim.</p>
<p><b>Deep water</b> means swimming: you lose a breath each turn and drown when it runs out (the sidebar points to the nearest air), and your blows land at half strength. Some monsters live in water (ripples <b>≋</b> give them away) — and the water keeps spreading.</p>
<h3>Combat is exact</h3>
<p>No dice: attacks always hit for the listed damage. Blasts and thrown flasks hit everything in their area — you included — and the aiming preview shows who gets hurt. Strong enemy attacks <b>wind up</b> first — their target tiles glow <span class="red">red</span>. Step out, break line of sight, or interrupt them (knockback, stun, freeze; bosses can't be interrupted).</p>
<p>Attacking a <b>sleeping or unaware</b> creature is a sneak attack: double damage (triple with a knife). There are no free swings: stepping away from a melee attacker costs it its turn to follow you.</p>
<p>Health does <b>not</b> regenerate. Climbing heals 20% and refills your abilities.</p>
</div>
<div>
<h3>Elements</h3>
<ul>
<li><b>Fire</b> spreads through grass, brush and wood; burns oil even on water; boils water into scalding steam.</li>
<li><b>Water</b> soaks you: fire hurts half, <b>lightning twice</b>, and lightning travels through connected water.</li>
<li><b>Cold</b> freezes water into walkable ice and freezes wet creatures solid (next hit ×2).</li>
<li><b>Oil</b> doubles fire damage and sets you ablaze. Wading washes it off.</li>
</ul>
<h3>Choices</h3>
<p>Choose a kit (a weapon and an art) at the start; choose 1 of 3 boons each climb; take 1 of 3 relics from vaults; spend pearls at shrines and the hermit. Some floors have a second exit, the <b class="purple">Rift («)</b>: harder, but a relic vault waits above. The hermit (<b>&amp;</b>) sells for pearls.</p>
</div>
<div>
<h3>Controls</h3>
<p><kbd>arrows</kbd> / <kbd>numpad</kbd> / <kbd>hjklyubn</kbd> move &amp; attack · <kbd>.</kbd> or <kbd>space</kbd> wait<br>
<kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd> abilities · <kbd>1</kbd>–<kbd>4</kbd> belt items<br>
<kbd>f</kbd> weapon attack at range (spear, harpoon, cutlass)<br>
<kbd>g</kbd> pick up / use shrine, spring, beacon · <kbd>d</kbd> drop<br>
<kbd>&lt;</kbd> climb · <kbd>&gt;</kbd> travel to the way up (or follow the fresh air toward it) · <kbd>z</kbd> auto-explore<br>
<kbd>x</kbd> look · <kbd>m</kbd> messages · <kbd>?</kbd> help · <kbd>Esc</kbd> menu</p>
<p><b>Mouse:</b> hover to inspect anything; click to travel or attack; right-click to look. When aiming, hover shows the predicted result.</p>
</div>
</div>`;
