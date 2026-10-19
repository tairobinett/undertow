// Prints ASCII dumps of every floor for a seed: node scripts/dump-floors.ts [seed] [floor]
import { newGame, submit } from '../src/core/game.ts';
import { asciiFloor } from '../src/core/debug.ts';
import { generateFloor, lastReport } from '../src/procgen/index.ts';

const seed = Number(process.argv[2] ?? 12345);
const only = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const state = newGame(seed);
submit(state, { t: 'choose', index: 0 });
for (let i = 0; i < 10; i++) {
  if (only !== undefined && i !== only) continue;
  const t0 = performance.now();
  const f = i === 0 ? state.floor : generateFloor(state, i, []);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`\n=== Floor ${i} (${f.zone}) "${f.name}" ${f.w}x${f.h} attempts=${lastReport.attempts} path=${lastReport.mainPathLength} ${ms}ms actors=${f.actors.length} items=${f.items.length} features=${f.features.map((x) => x.kind).join(',')}`);
  console.log(asciiFloor(f));
}
