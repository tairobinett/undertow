// Bot simulation: node scripts/sim.ts [runs] [heuristic|chaos] [startSeed]
import { runBot } from '../src/bot/bot.ts';

const runs = Number(process.argv[2] ?? 50);
const kind = (process.argv[3] ?? 'heuristic') as 'heuristic' | 'chaos';
const start = Number(process.argv[4] ?? 1);
const knowMap = (process.argv[5] ?? 'nav') === 'nav';

const t0 = performance.now();
const deaths: Record<string, number> = {};
const floors: number[] = new Array(11).fill(0);
let wins = 0;
let errors = 0;
const turnsPerFloor: number[][] = [];
const hpArrive: number[][] = [];
for (let s = start; s < start + runs; s++) {
  const r = runBot(s, kind, 8000, undefined, { knowMap });
  if (r.error) {
    errors++;
    console.log(`seed ${s}: ERROR ${r.error.split('\n').slice(0, 6).join('\n')}`);
    continue;
  }
  if (r.status === 'won') wins++;
  floors[r.floor] = (floors[r.floor] ?? 0) + 1;
  if (r.cause) {
    const key = r.cause.replace(/\(.*\)/, '').trim();
    deaths[key] = (deaths[key] ?? 0) + 1;
  }
  r.floorTurns.forEach((t, i) => {
    (turnsPerFloor[i] ??= []).push(t);
  });
  r.hpOnArrival.forEach((h, i) => {
    (hpArrive[i] ??= []).push(h);
  });
}
const med = (l: number[] | undefined): string => {
  if (!l || !l.length) return '-';
  const s = [...l].sort((a, b) => a - b);
  return String(s[Math.floor(s.length / 2)]);
};
console.log('Median HP% on arrival at floors 1..9:', hpArrive.map(med).join(' '));
const ms = performance.now() - t0;
console.log(`\n${runs} ${kind} runs in ${(ms / 1000).toFixed(1)}s — wins ${wins}, errors ${errors}`);
console.log('Final floor reached:', floors.map((n, i) => `${i}:${n}`).join('  '));
console.log('Deaths:', Object.entries(deaths).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}=${v}`).join(', '));
console.log('Median turns per floor:', turnsPerFloor.map((l) => {
  const s = [...l].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? '-';
}).join(' '));
