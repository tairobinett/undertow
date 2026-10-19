# UNDERTOW — guide for Claude

A deterministic, browser-based traditional roguelike in TypeScript. Start with `docs/PROGRESS.md` (status and history), `docs/DESIGN.md` (rules) and `docs/PRINCIPLES.md` (the owner's design principles; every change should respect them).

## Commands

- `npm test`: Vitest. All tests must pass.
- `npx tsc --noEmit -p .`: type-check. Keep it clean.
- `npm run build`: bundles `src/main.ts` into `src/ui/page.html` and writes two single-file pages: `dist/index.html` (standalone) and `dist/artifact.html` (the same page as a fragment, for publishing as a claude.ai Artifact).
- `node scripts/sim.ts <runs> heuristic <startSeed> nav|explore`: bot balance statistics.
- `node scripts/dump-floors.ts <seed> [floor]`: ASCII floor dumps.
- `node scripts/tplay.ts <session> new <seed>` then `node scripts/tplay.ts <session> "<cmd>; <cmd>"`: text-mode play harness (`help` lists commands). It prints what the browser UI shows (sidebar, log, inspect, previews), so agents can playtest turn by turn. Sessions live in `.tmp/tplay/`. Add `auto=N` to have the bot play the first N floors; `bot N` is a debugging aid. See `docs/PLAYTEST_BRIEF.md` for running LLM playtests.
- `node scripts/screenshot.mjs <out.png> <seed|title> '<steps-json>' [w] [h]`: headless Chrome screenshots. Read the PNG to inspect visuals.
  - Steps can use `eval` with `window.undertow`, which is the `App`.
  - Useful calls: `debugWarp(n)`, `debugReveal()`, `debugAutoplay(n, seed)`.
  - `{"resume":".tmp/tplay/<session>.json"}` loads a text-harness session into the page, so a playtester's situation can be seen as a player would see it.
- Node 24 runs `.ts` directly. Imports must use `.ts` extensions, and code must use erasable syntax only: no enums, no namespaces, no parameter properties.

## Architecture

- `src/core`: the pure simulation. No DOM, `Math.random` or `Date`; a test enforces this.
  - `types.ts`: all state types. `GameState` is plain data plus typed arrays, so it works with `structuredClone` and JSON.
  - `game.ts`: `newGame`, `submit(cmd)` (the only entry point for input), `worldTick`, `ascend`, `previewCommand`.
  - `player.ts`: player commands and weapon verbs.
  - `effects.ts`: the damage pipeline (every HP change is attributed), statuses, push/pull/teleport, noise, death.
  - `elements.ts`: element reactions on tiles, oil slicks, conduction, and `elementReach` for honest telegraphs.
  - `resolve.ts`: `shapeTiles` and `applySpec`, shared by abilities, items and monster attacks. Also monster spawning.
  - `systems.ts`: the environment tick (status ticks, terrain effects, fire, gas, ice, tide, cooldowns).
  - `vision.ts`: light plus symmetric FOV (exact-fraction shadowcasting in `fov.ts`).
  - `save.ts`: JSON save/load with typed arrays as base64, plus replay and `stateHash`.
- `src/ai/brain.ts`: monster perception (with an alert turn), intents/telegraphs, and brains.
- `src/procgen`: carve toolkit → zone layouts → elevation → bridges → decoration → validation → regions → population.
- `src/content`: all data (monsters, weapons, abilities, relics, consumables, boons, zones, variants, statuses).
  - Descriptions are shown to players; keep them truthful. `tests/monsters.test.ts` checks monster behaviour against its tips.
- `src/ui`: canvas renderer (lighting, water, contours, telegraphs), DOM sidebar and modals, input, tips, audio.
  - `travel.ts` (travel/auto-explore), `inspect.ts` (descriptions) and `memory.ts` (last-seen markers) are DOM-free and shared with the text harness.
- `src/bot`: heuristic and chaos bots for fuzzing and balance.

## Conventions

- **Randomness:** gameplay uses `state.rng`. Floor generation uses its own RNG seeded from `(runSeed, floorIndex, attempt)`. Cosmetic UI randomness never touches game state.
- **Positions:** every change goes through `setPos()` so the occupancy grid stays correct.
- **Order:** actors act in id order. Never iterate a `Set` of objects where order matters.
- **New monster:** add a `mon({...})` entry, add it to a zone encounter table, and add a behaviour test if it has a special ability.
- **New relic hook:** add it to `RELICS` and implement it in the engine via `hasHook(state, 'hook')`.
- **Commits:** local commits on `main` with the attribution trailer. No remote is configured.
