// Canvas map renderer: terrain with zone palettes, animated water, fire, gas, lighting,
// memory, entities, telegraphs, tide forecast, targeting overlays and animations.

import { CONSUMABLES } from '../content/consumables.ts';
import { MONSTERS } from '../content/monsters.ts';
import { RELICS } from '../content/relics.ts';
import { WEAPONS } from '../content/weapons.ts';
import { ZONES } from '../content/zones.ts';
import { BRIDGE_DECK, rawDepth } from '../core/floor.ts';
import { hasStatus } from '../core/state.ts';
import { GAS, SURF, T, TERRAIN } from '../core/terrain.ts';
import type { Actor, FloorItem, GameState } from '../core/types.ts';
import { Anims } from './anim.ts';
import type { RGB } from './color.ts';
import { css, hex, mix, scale, tileHash } from './color.ts';
import { computeColorLight } from './lighting.ts';
import { telegraphTiles } from './travel.ts';

export interface Overlay {
  cursor?: { x: number; y: number } | undefined;
  target?: { tiles: number[]; valid: boolean } | undefined;
  path?: number[] | undefined;
  showTide: boolean;
  tideTiles?: number[] | undefined;
  /** Predicted outcomes: actor id → new hp (or -1 for death). */
  predict?: Map<number, number> | undefined;
  /** Creatures out of sight, drawn dimly where they were last seen. */
  ghosts?: { def: string; x: number; y: number }[] | undefined;
}

const FONT = "'JetBrains Mono', 'DejaVu Sans Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace";

const SHALLOW: RGB = [22, 84, 112];
const DEEP: RGB = [8, 34, 70];
const ICE_BG: RGB = [120, 170, 196];
const OIL_BG: RGB = [70, 52, 16];
const MEMORY: RGB = [70, 82, 104];

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  cell = 20;
  camX = 0;
  camY = 0;
  viewW = 40;
  viewH = 25;
  private light: Float32Array | null = null;
  private lightKey = '';
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  layout(availW: number, availH: number, mapW: number, mapH: number): void {
    const fit = Math.floor(Math.min(availW / mapW, availH / mapH));
    this.cell = Math.max(14, Math.min(30, fit));
    this.viewW = Math.min(mapW, Math.max(10, Math.floor(availW / this.cell)));
    this.viewH = Math.min(mapH, Math.max(8, Math.floor(availH / this.cell)));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.viewW * this.cell;
    const h = this.viewH * this.cell;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Keeps the player inside the middle of the viewport when the map is larger than it. */
  follow(px: number, py: number, mapW: number, mapH: number): void {
    const mx = Math.floor(this.viewW / 4);
    const my = Math.floor(this.viewH / 4);
    if (px - this.camX < mx) this.camX = px - mx;
    if (px - this.camX >= this.viewW - mx) this.camX = px - this.viewW + mx + 1;
    if (py - this.camY < my) this.camY = py - my;
    if (py - this.camY >= this.viewH - my) this.camY = py - this.viewH + my + 1;
    this.camX = Math.max(0, Math.min(mapW - this.viewW, this.camX));
    this.camY = Math.max(0, Math.min(mapH - this.viewH, this.camY));
  }

  tileAt(clientX: number, clientY: number): { x: number; y: number } | undefined {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - r.left) / this.cell) + this.camX;
    const y = Math.floor((clientY - r.top) / this.cell) + this.camY;
    return { x, y };
  }

  invalidateLight(): void {
    this.lightKey = '';
  }

  private lightFor(state: GameState): Float32Array {
    const key = `${state.floor.seed}:${state.turn}:${state.commands.length}`;
    if (!this.light || key !== this.lightKey || this.light.length !== state.floor.w * state.floor.h * 3) {
      this.light = computeColorLight(state);
      this.lightKey = key;
    }
    return this.light;
  }

  draw(state: GameState, ov: Overlay, anims: Anims, now: number): void {
    const ctx = this.ctx;
    const f = state.floor;
    const c = this.cell;
    const light = this.lightFor(state);
    const zone = ZONES[f.zone];
    const pal = zone?.palette ?? {};
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, this.viewW * c, this.viewH * c);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontPx = Math.floor(c * 0.82);
    ctx.font = `${fontPx}px ${FONT}`;

    // Index entities.
    const actorAt = new Map<number, Actor>();
    for (const a of f.actors) if (!a.dead) actorAt.set(a.y * f.w + a.x, a);
    const itemAt = new Map<number, FloorItem>();
    for (const it of f.items) itemAt.set(it.y * f.w + it.x, it);
    const featAt = new Map<number, (typeof f.features)[number]>();
    for (const ft of f.features) featAt.set(ft.y * f.w + ft.x, ft);
    const bumps = new Map<number, { dx: number; dy: number }>();
    for (const fx of anims.list) {
      if (fx.k !== 'bump' || now < fx.t0) continue;
      const t = (now - fx.t0) / fx.dur;
      if (t >= 1) continue;
      const k = Math.sin(Math.PI * t) * 0.28;
      bumps.set(fx.id, { dx: fx.dx * k, dy: fx.dy * k });
    }
    const danger = telegraphTiles(state);

    for (let vy = 0; vy < this.viewH; vy++) {
      for (let vx = 0; vx < this.viewW; vx++) {
        const x = this.camX + vx;
        const y = this.camY + vy;
        if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
        const i = y * f.w + x;
        if (!f.seen[i]) continue;
        const visible = f.vis[i] === 1;
        const t = f.terrain[i] as number;
        const td = TERRAIN[t];
        if (!td) continue;
        const pe = pal[td.key];
        let bg: RGB = hex(pe?.bg ?? td.bg);
        let fg: RGB = hex(pe?.fg ?? td.fg);
        let glyph = td.glyph;
        const depth = td.flood && (!td.bridge || f.waterLevel >= BRIDGE_DECK) ? rawDepth(f, i) : 0;
        const surf = f.surface[i] as number;
        let isWall = td.solid && td.opaque && t !== T.BOOKSHELF && t !== T.PILLAR;

        if (t === T.FLOOR || t === T.SAND || t === T.PLANKS) glyph = '·';
        if (t === T.PILLAR) glyph = '●';
        if (depth > 0 && surf !== SURF.ICE) {
          const deep = depth >= 2;
          const water = deep ? mix(DEEP, [2, 16, 40], Math.min(1, (depth - 2) / 4)) : SHALLOW;
          const shimmer = Math.sin(now * 0.0016 + tileHash(x, y) * 6.28) * 0.5 + 0.5;
          bg = mix(deep ? water : mix(bg, water, 0.8), [40, 110, 160], shimmer * 0.12);
          if (t === T.BRUSH) {
            // Brush still blocks sight in water; under deep water it gets its own hollow glyph.
            glyph = deep ? '♧' : '♣';
            fg = mix(fg, deep ? [90, 170, 220] : [60, 160, 130], 0.45);
          } else {
            glyph = deep ? '≈' : '~';
            fg = deep ? mix([50, 110, 170], [90, 170, 230], shimmer) : mix([70, 150, 190], [120, 200, 230], shimmer);
          }
        }
        if (surf === SURF.ICE) {
          bg = ICE_BG;
          glyph = depth > 0 ? '▫' : '·';
          fg = [220, 245, 255];
        } else if (surf === SURF.OIL) {
          bg = mix(bg, OIL_BG, 0.75);
          if (glyph === '·' || glyph === '~' || glyph === '≈') glyph = '~';
          fg = [214, 164, 60];
        }
        const fire = f.fire[i] as number;
        if (fire > 0) {
          const fl = tileHash(x, y, Math.floor(now / 110)) ;
          bg = mix([90, 20, 5], [150, 50, 10], fl);
          fg = fl < 0.33 ? [255, 230, 120] : fl < 0.66 ? [255, 150, 40] : [230, 70, 20];
          glyph = fl < 0.5 ? '^' : '▲';
          isWall = false;
        }

        // Lighting.
        let lr = 1;
        let lg = 1;
        let lb = 1;
        if (visible) {
          lr = Math.min(1.35, ((light[i * 3] as number) + 18) / 200);
          lg = Math.min(1.35, ((light[i * 3 + 1] as number) + 18) / 200);
          lb = Math.min(1.35, ((light[i * 3 + 2] as number) + 18) / 200);
          if (fire > 0) {
            lr = Math.max(lr, 1);
            lg = Math.max(lg, 0.9);
            lb = Math.max(lb, 0.8);
          }
        }
        const litF = (col: RGB): RGB => (visible ? [col[0] * lr, col[1] * lg, col[2] * lb] : mix(scale(col, 0.5), scale(MEMORY, 0.55), 0.5));
        const cx = vx * c;
        const cy = vy * c;
        ctx.fillStyle = css(litF(bg));
        ctx.fillRect(cx, cy, c, c);

        if (isWall) {
          // Bevelled wall blocks: highlight edges facing open ground.
          const v = 0.9 + tileHash(x, y, 7) * 0.2;
          ctx.fillStyle = css(litF(scale(bg, v)));
          ctx.fillRect(cx, cy, c, c);
          const edge = litF(mix(fg, [255, 255, 255], 0.1));
          ctx.fillStyle = css(edge, visible ? 0.55 : 0.35);
          const open = (nx: number, ny: number): boolean => nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && !(TERRAIN[f.terrain[ny * f.w + nx] as number]?.solid ?? true);
          const e = Math.max(1, Math.round(c / 10));
          if (open(x, y - 1)) ctx.fillRect(cx, cy, c, e);
          if (open(x, y + 1)) ctx.fillRect(cx, cy + c - e, c, e);
          if (open(x - 1, y)) ctx.fillRect(cx, cy, e, c);
          if (open(x + 1, y)) ctx.fillRect(cx + c - e, cy, e, c);
          if (t === T.WALL_LAMP) {
            ctx.fillStyle = css(litF(fg));
            ctx.fillText('•', cx + c / 2, cy + c / 2 + 1);
          } else if (t === T.CORAL) {
            // Coral polyps: a few soft dots, varied per tile.
            ctx.fillStyle = css(litF(fg), visible ? 0.7 : 0.35);
            const r = Math.max(1, c / 9);
            for (let k = 0; k < 3; k++) {
              const px = cx + c * (0.2 + 0.6 * tileHash(x, y, 11 + k));
              const py = cy + c * (0.2 + 0.6 * tileHash(x, y, 21 + k));
              ctx.fillRect(px - r / 2, py - r / 2, r, r);
            }
          }
        }

        // What stands here?
        let drawGlyph = isWall ? '' : glyph;
        let drawFg = fg;
        let isEntity = false;
        const ft = featAt.get(i);
        if (ft && !isWall) {
          const g = featureGlyph(ft.kind, ft.route, !!ft.used);
          if (g) {
            drawGlyph = g.glyph;
            drawFg = g.color;
            isEntity = true;
          }
        }
        // Items stay drawn (dimmed) on remembered tiles, as last seen.
        const it = itemAt.get(i);
        if (it) {
          const g = itemGlyph(it);
          drawGlyph = g.glyph;
          drawFg = g.color;
          isEntity = true;
        }
        const a = actorAt.get(i);
        let actorOffset: { dx: number; dy: number } | undefined;
        if (a && visible) {
          if (a.def === 'player') {
            drawGlyph = '@';
            drawFg = hasStatus(a, 'hidden') ? [150, 140, 220] : [255, 255, 255];
            isEntity = true;
          } else if (a.submerged) {
            // Ripples: something is down there.
            if (drawGlyph === '≈' || drawGlyph === '~') {
              drawGlyph = '≋';
              drawFg = mix(drawFg, [190, 240, 255], 0.6);
            }
          } else {
            const d = MONSTERS[a.def];
            drawGlyph = d?.glyph ?? 'M';
            drawFg = hex(d?.color ?? '#ffffff');
            if (a.ai?.mode === 'asleep') drawFg = scale(drawFg, 0.65);
            isEntity = true;
          }
          actorOffset = bumps.get(a.id);
        }
        if (drawGlyph) {
          const col = isEntity && visible ? mix(drawFg, litF(drawFg), 0.35) : litF(drawFg);
          ctx.fillStyle = css(col);
          const ox = actorOffset ? actorOffset.dx * c : 0;
          const oy = actorOffset ? actorOffset.dy * c : 0;
          ctx.fillText(drawGlyph, cx + c / 2 + ox, cy + c / 2 + 1 + oy);
        }
        if (a && visible && a.def !== 'player' && !a.submerged) {
          // Health pip and state marks.
          if (a.hp < a.maxHp) {
            const w = Math.max(0, a.hp / a.maxHp);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(cx + 2, cy + c - 3, c - 4, 2);
            ctx.fillStyle = w > 0.5 ? '#7fe07f' : w > 0.25 ? '#e0c060' : '#e06060';
            ctx.fillRect(cx + 2, cy + c - 3, (c - 4) * w, 2);
          }
          if (a.ai?.mode === 'asleep') this.smallMark(cx, cy, 'z', '#8fa0c0');
          else if (a.ai?.mode === 'alert') this.smallMark(cx, cy, '!', '#ffd060');
          else if (a.ai?.intent) this.smallMark(cx, cy, '!', '#ff5050');
        }

        // Gas.
        const g = f.gas[i] as number;
        const amt = f.gasAmt[i] as number;
        if (g !== GAS.NONE && amt > 3) {
          const gc: RGB = g === GAS.STEAM ? [235, 238, 242] : g === GAS.SMOKE ? [110, 110, 118] : [140, 190, 70];
          const alpha = Math.min(g === GAS.SMOKE ? 0.8 : 0.55, amt / (g === GAS.SMOKE ? 80 : 110));
          ctx.fillStyle = css(visible ? gc : scale(gc, 0.4), alpha);
          ctx.fillRect(cx, cy, c, c);
        }

        // Overlays.
        if (danger.has(i) && visible) {
          const pulse = 0.22 + 0.13 * Math.sin(now * 0.008);
          ctx.fillStyle = `rgba(255,40,40,${pulse.toFixed(3)})`;
          ctx.fillRect(cx, cy, c, c);
        }
      }
    }

    // Topographic contours: faint lines where the ground steps up, so height is readable.
    ctx.lineWidth = 1;
    for (let vy = 0; vy < this.viewH; vy++) {
      for (let vx = 0; vx < this.viewW; vx++) {
        const x = this.camX + vx;
        const y = this.camY + vy;
        if (x < 0 || y < 0 || x >= f.w - 1 || y >= f.h - 1) continue;
        const i = y * f.w + x;
        if (!f.seen[i]) continue;
        const td = TERRAIN[f.terrain[i] as number];
        if (!td?.flood) continue;
        const e = f.elev[i] as number;
        if (e - f.waterLevel < 1) continue; // underwater: no contours
        const vis = f.vis[i] === 1;
        const a = vis ? 0.32 : 0.14;
        const right = i + 1;
        const down = i + f.w;
        const tr = TERRAIN[f.terrain[right] as number];
        const tdn = TERRAIN[f.terrain[down] as number];
        ctx.strokeStyle = `rgba(150,190,230,${a})`;
        ctx.beginPath();
        if (tr?.flood && f.seen[right] && (f.elev[right] as number) !== e) {
          ctx.moveTo(vx * c + c - 0.5, vy * c);
          ctx.lineTo(vx * c + c - 0.5, vy * c + c);
        }
        if (tdn?.flood && f.seen[down] && (f.elev[down] as number) !== e) {
          ctx.moveTo(vx * c, vy * c + c - 0.5);
          ctx.lineTo(vx * c + c, vy * c + c - 0.5);
        }
        ctx.stroke();
      }
    }

    // Tide forecast: outline the tiles the next rise will flood.
    if (ov.showTide && ov.tideTiles) {
      const pulse = 0.35 + 0.25 * Math.sin(now * 0.006);
      ctx.strokeStyle = `rgba(90,170,255,${pulse.toFixed(3)})`;
      ctx.lineWidth = 1;
      for (const i of ov.tideTiles) {
        if (!f.seen[i]) continue;
        const p = this.toView(i % f.w, Math.floor(i / f.w));
        if (!p) continue;
        ctx.strokeRect(p.x + 1.5, p.y + 1.5, c - 3, c - 3);
      }
    }
    if (ov.ghosts) {
      for (const g of ov.ghosts) {
        const p = this.toView(g.x, g.y);
        const d = MONSTERS[g.def];
        if (!p || !d) continue;
        const [r, gg, b] = hex(d.color);
        ctx.fillStyle = `rgba(${r},${gg},${b},0.38)`;
        ctx.fillText(d.glyph, p.x + c / 2, p.y + c / 2 + 1);
        ctx.fillStyle = 'rgba(200,210,230,0.55)';
        ctx.font = `${Math.floor(c * 0.42)}px ${FONT}`;
        ctx.fillText('?', p.x + c * 0.82, p.y + c * 0.22);
        ctx.font = `${fontPx}px ${FONT}`;
      }
    }
    if (ov.path) {
      ctx.fillStyle = 'rgba(255,255,200,0.35)';
      for (const i of ov.path) {
        const p = this.toView(i % f.w, Math.floor(i / f.w));
        if (p) ctx.fillRect(p.x + c / 2 - 2, p.y + c / 2 - 2, 4, 4);
      }
    }
    if (ov.target) {
      ctx.fillStyle = ov.target.valid ? 'rgba(255,220,90,0.28)' : 'rgba(160,160,160,0.22)';
      for (const i of ov.target.tiles) {
        const p = this.toView(i % f.w, Math.floor(i / f.w));
        if (p) ctx.fillRect(p.x, p.y, c, c);
      }
    }
    if (ov.predict) {
      ctx.font = `bold ${Math.floor(c * 0.5)}px ${FONT}`;
      for (const [id, hp] of ov.predict) {
        const a = f.actors.find((x) => x.id === id);
        if (!a || !f.vis[a.y * f.w + a.x]) continue;
        const p = this.toView(a.x, a.y);
        if (!p) continue;
        ctx.fillStyle = hp <= 0 ? '#ff4040' : '#ffe080';
        ctx.fillText(hp <= 0 ? '✖' : `${hp}`, p.x + c / 2, p.y - c * 0.1);
      }
      ctx.font = `${fontPx}px ${FONT}`;
    }
    if (ov.cursor) {
      const p = this.toView(ov.cursor.x, ov.cursor.y);
      if (p) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, c - 2, c - 2);
      }
    }
    if (f.raining) this.drawRain(now);
    this.drawAnims(state, anims, now);
  }

  /** Cosmetic rain streaks for the storm on the surface. */
  private drawRain(now: number): void {
    const ctx = this.ctx;
    const W = this.viewW * this.cell;
    const H = this.viewH * this.cell;
    ctx.strokeStyle = 'rgba(170,200,230,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 140; k++) {
      const sp = 0.5 + tileHash(k, 3) * 0.35;
      const x = (tileHash(k, 1) * W + now * 0.12) % W;
      const y = (tileHash(k, 2) * H + now * sp) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 11);
    }
    ctx.stroke();
  }

  private smallMark(cx: number, cy: number, ch: string, color: string): void {
    const ctx = this.ctx;
    const c = this.cell;
    ctx.save();
    ctx.font = `bold ${Math.floor(c * 0.42)}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(ch, cx + c * 0.82, cy + c * 0.2);
    ctx.restore();
  }

  toView(x: number, y: number): { x: number; y: number } | undefined {
    const vx = x - this.camX;
    const vy = y - this.camY;
    if (vx < 0 || vy < 0 || vx >= this.viewW || vy >= this.viewH) return undefined;
    return { x: vx * this.cell, y: vy * this.cell };
  }

  private drawAnims(state: GameState, anims: Anims, now: number): void {
    const ctx = this.ctx;
    const c = this.cell;
    const f = state.floor;
    for (const fx of anims.list) {
      if (now < fx.t0) continue;
      const t = (now - fx.t0) / fx.dur;
      if (t >= 1) continue;
      switch (fx.k) {
        case 'burst':
          ctx.fillStyle = css(fx.color, 0.55 * (1 - t));
          for (const i of fx.tiles) {
            const p = this.toView(i % f.w, Math.floor(i / f.w));
            if (p && f.seen[i]) ctx.fillRect(p.x, p.y, c, c);
          }
          break;
        case 'shot': {
          const x = fx.fx + (fx.tx - fx.fx) * t;
          const y = fx.fy + (fx.ty - fx.fy) * t;
          const p = this.toView(Math.floor(x), Math.floor(y));
          if (!p) break;
          ctx.fillStyle = css(fx.color);
          ctx.fillText(fx.glyph, (x - this.camX) * c + c / 2, (y - this.camY) * c + c / 2);
          break;
        }
        case 'num': {
          const p = this.toView(fx.x, fx.y);
          if (!p || !f.vis[fx.y * f.w + fx.x]) break;
          ctx.save();
          ctx.font = `bold ${Math.floor(c * 0.55)}px ${FONT}`;
          ctx.fillStyle = css(fx.color, 1 - t * t);
          ctx.fillText(fx.text, p.x + c / 2, p.y + c * 0.2 - t * c * 0.9);
          ctx.restore();
          break;
        }
        case 'ghost': {
          const p = this.toView(fx.x, fx.y);
          if (!p || !f.vis[fx.y * f.w + fx.x]) break;
          ctx.fillStyle = css(fx.color, 1 - t);
          ctx.fillText(fx.glyph, p.x + c / 2, p.y + c / 2 + 1);
          break;
        }
        case 'mark': {
          const a = f.actors.find((x) => x.id === fx.id);
          if (!a) break;
          const p = this.toView(a.x, a.y);
          if (!p || !f.vis[a.y * f.w + a.x]) break;
          ctx.strokeStyle = css([255, 255, 255], 0.8 * (1 - t));
          ctx.lineWidth = 2;
          ctx.strokeRect(p.x + 1, p.y + 1, c - 2, c - 2);
          break;
        }
        case 'flash':
          ctx.fillStyle = css(fx.color, 0.25 * (1 - t));
          ctx.fillRect(0, 0, this.viewW * c, this.viewH * c);
          break;
        case 'bump':
          break;
      }
    }
  }
}

export function featureGlyph(kind: string, route: string | undefined, used: boolean): { glyph: string; color: RGB } | undefined {
  switch (kind) {
    case 'exit': return route === 'rift' ? { glyph: '«', color: [200, 140, 255] } : { glyph: '<', color: [255, 216, 107] };
    case 'entry': return { glyph: '>', color: [90, 110, 150] };
    case 'shrine': return { glyph: '∩', color: used ? [70, 90, 90] : [110, 230, 210] };
    case 'spring': return { glyph: '○', color: used ? [70, 90, 110] : [140, 210, 255] };
    case 'merchant': return { glyph: '&', color: [255, 176, 96] };
    case 'beacon': return { glyph: '¤', color: [255, 220, 120] };
    case 'altar': return { glyph: 'π', color: [150, 150, 160] };
    default: return undefined;
  }
}

export function itemGlyph(it: FloorItem): { glyph: string; color: RGB } {
  switch (it.item.kind) {
    case 'pearls': return { glyph: '•', color: [240, 232, 255] };
    case 'consumable': {
      const d = CONSUMABLES[it.item.def];
      return { glyph: d?.glyph ?? '!', color: hex(d?.color ?? '#ffffff') };
    }
    case 'weapon': return { glyph: ')', color: hex(WEAPONS[it.item.def]?.color ?? '#ffffff') };
    case 'relic': return { glyph: '♦', color: hex(RELICS[it.item.def]?.color ?? '#ffffff') };
  }
}
