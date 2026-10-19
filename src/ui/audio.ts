// Tiny synthesized sound effects (WebAudio). No assets. Starts after the first user gesture.

import type { GameEvent, GameState } from '../core/types.ts';

type Sfx = 'hit' | 'hurt' | 'kill' | 'fire' | 'zap' | 'frost' | 'splash' | 'tide' | 'ascend' | 'boom' | 'tick' | 'pickup' | 'death' | 'win';

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  private last = new Map<Sfx, number>();

  unlock(): void {
    if (this.ctx) return;
    try {
      const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        d[i] = (seed / 4294967296) * 2 - 1;
      }
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, gain: number, filter: BiquadFilterType, freq: number, freqTo?: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(s: Sfx): void {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    if (now - (this.last.get(s) ?? 0) < 45) return;
    this.last.set(s, now);
    switch (s) {
      case 'hit':
        this.hiss(0.07, 0.5, 'bandpass', 1800);
        this.tone(140, 0.08, 'triangle', 0.35, 80);
        break;
      case 'hurt':
        this.tone(110, 0.18, 'sawtooth', 0.25, 55);
        this.hiss(0.1, 0.35, 'lowpass', 900);
        break;
      case 'kill':
        this.tone(220, 0.16, 'triangle', 0.25, 90);
        break;
      case 'fire':
        this.hiss(0.45, 0.45, 'lowpass', 600, 2400);
        break;
      case 'zap':
        this.tone(1400, 0.12, 'square', 0.12, 300);
        this.hiss(0.12, 0.3, 'highpass', 3000);
        break;
      case 'frost':
        this.tone(1900, 0.25, 'sine', 0.12, 2600);
        this.tone(2500, 0.2, 'sine', 0.08, 1800, 0.04);
        break;
      case 'splash':
        this.hiss(0.3, 0.35, 'bandpass', 900, 300);
        break;
      case 'tide':
        this.tone(55, 1.2, 'sine', 0.4, 45);
        this.hiss(1.1, 0.25, 'lowpass', 300, 120);
        break;
      case 'ascend':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.18, undefined, i * 0.09));
        break;
      case 'boom':
        this.hiss(0.6, 0.7, 'lowpass', 1200, 90);
        this.tone(70, 0.5, 'sine', 0.5, 35);
        break;
      case 'tick':
        this.tone(880, 0.05, 'square', 0.06);
        break;
      case 'pickup':
        this.tone(660, 0.08, 'sine', 0.15, 990);
        break;
      case 'death':
        [330, 262, 196, 131].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.2, undefined, i * 0.18));
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.2, undefined, i * 0.12));
        break;
    }
  }

  ingest(events: GameEvent[], state: GameState): void {
    for (const ev of events) {
      switch (ev.t) {
        case 'dmg':
          this.play(ev.id === state.playerId ? 'hurt' : 'hit');
          break;
        case 'die':
          this.play('kill');
          break;
        case 'fx':
          if (ev.kind === 'fire') this.play('fire');
          else if (ev.kind === 'shock') this.play('zap');
          else if (ev.kind === 'frost') this.play('frost');
          else if (ev.kind === 'water' || ev.kind === 'steam') this.play('splash');
          else if (ev.kind === 'boom') this.play('boom');
          break;
        case 'tide':
          this.play('tide');
          break;
        case 'floor':
          this.play('ascend');
          break;
        case 'telegraph':
          this.play('tick');
          break;
        default:
          break;
      }
    }
  }
}
