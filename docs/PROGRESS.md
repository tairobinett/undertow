# UNDERTOW — Build progress

A living checklist so work can resume after a context reset. Newest notes at the bottom.

## Milestones

- [x] **M0 Scaffold.** TypeScript 7, esbuild, Vitest, and Node running TS directly for scripts. Git repo on `main`.
- [x] **M1 Core engine** (`src/core`):
  - rng, geometry, symmetric FOV, Dijkstra, noise;
  - the terrain table;
  - types and state;
  - effects (damage pipeline with attribution), elements (reaction rules), resolve (shapes → effects);
  - systems (statuses, fire, gas, ice, tide, drowning), vision (light + FOV);
  - player (commands and weapon verbs), progression (boons), game (loop, ascend, preview), save (JSON + replay).
- [x] **M2 AI** (`src/ai/brain.ts`): perception with an alert turn, intents and telegraphs, brains (melee, ranged, turret, aquatic, drifter, bomber, skirmisher, thief, siren, abbot, leviathan).
- [x] **M3 Procgen** (`src/procgen`): carve toolkit (walks, shapes, door-aligned accretion, loops), layouts per zone, elevation, bridges, decoration, regions, population (exits and rift, vaults, shrines, springs, merchant, loot, encounters, bosses).
- [x] **M4 Tests** (49 passing): mechanics, verbs, procgen invariants across seeds, determinism (replay, save/load), bots.
- [x] **M5 UI.**
  - Canvas renderer: coloured light, animated water, fog, contours, telegraphs, rain.
  - DOM sidebar, with a boss bar and a fresh-air compass.
  - Input: keys, mouse and touch pad.
  - Targeting with predicted-outcome previews.
  - Look/inspect.
  - Choice modals for kits, boons, shrines and swaps.
  - Help, death recap with the story of the run, victory screen, title screen with run history.
  - Autosave, first-time tips, synthesized sound.
- [x] **M6 Build.** Single-file `dist/index.html`, and headless screenshot tooling (`window.undertow` exposes `debugWarp`, `debugReveal` and `debugAutoplay`).
- [x] **M7 Balance, first pass**, using a navigator bot (knows the map) and an explorer bot (sees only what it has seen).
  - The navigator bot wins about 29% of 200 runs.
  - Deaths spread: the Deep ~6%, the Cloister ~37%, the Caves ~25%, and the Surface kills about half of arrivals.
- [x] **M8 Review and release.**
  - Published as a claude.ai Artifact (`dist/artifact.html`), with hot-reload that keeps a run going.
  - A code review found 21 rule bugs plus text that the code didn't back up. All are fixed, each with a regression test in `tests/rules.test.ts`:
    - relic swaps healed you;
    - Ghost Blade never worked;
    - firepots and the Censer dealt double;
    - wind-ups counted monster actions, not turns;
    - Tide Chart did nothing;
    - fire kills weren't yours;
    - DoTs ticked once too often.
  - Text-mode play harness (`scripts/tplay.ts`) and LLM playtests.
  - The Codex.
- [x] **M9 Playtest pass**: six rounds, 16 LLM testers, every report acted on. Final state: 138 tests, automation fuzzes clean, the navigator bot wins ~22%, ~83% of Surface arrivals win. Published as Artifact version 6.
  - **Round 1:** three Sonnet playtesters played through the text harness (seeds 101/202/303).
    - Praised:
      - kit and boon choices felt like real three-way trade-offs;
      - telegraphs read well when not panicking;
      - freezing a pool strands and kills water creatures (a favourite emergent moment);
      - the death recap.
    - Fixed:
      - log lines merged across turns read as double hits;
      - "You are air bladder.";
      - Hermit and player shared `@`, and the Rift was colour-only (now `&` and `«`);
      - travel refused any swim (now asks, says how far, and honours the Air Bladder);
      - pool-bound hunters stalled auto-travel;
      - the swimming half-damage rule was never explained (help, tip, log line, sidebar);
      - the unclear "noticed" tip;
      - no sense of how far the water goes (route-following fresh air with a deep-water count, plus "Nearest air" while swimming).
  - **Round 2:** testers started mid-run (`auto=N`) to reach the Abbot and the late game.
    - Found:
      - `explore swim` could drown you inside one call, and the "You are hurt!" check had been dead code in the UI too;
      - auto-travel walked past visible ripples;
      - Powder Monkeys and Gunners kited forever (the Gunner's "close in while it reloads" tip was false);
      - inspect showed base damage, not what a hit would do to you;
      - two floors could share a name.
    - Fixed:
      - automation now never swims past your breath, never walks you into lethal burning or poison, stops on any damage and on a tide rise around you, and routes around ripples. A fuzz test holds it to "never kills you";
      - skirmishers fumble and ranged monsters hold ground while reloading;
      - the compass takes the route with the shortest longest-swim;
      - inspect shows "(N to you)".
    - Results: pt6 won by lighting the beacon, and praised the beacon-or-Leviathan fork. pt5 died to the Abbot after finding a kiting exploit.
    - Also fixed:
      - Set Against Charge now needs you to hold your ground;
      - the Abbot's arena is swept clear of overgrowth;
      - bosses say they can't be interrupted;
      - dodges are logged, and the threat list says when a wind-up is aimed at your tile;
      - "the way up stays open for ~N turns";
      - explore offers short swims instead of "No known path".
  - **Round 3** (current build, two full runs plus one Abbot start):
    - No deaths: pt7 killed the Abbot without taking a hit from any of his abilities, using what inspect told them; pt9 evaded him with smoke and a swim; pt8 survived to the call budget.
    - Praised: the swim guards; "you are in it!"; honest telegraphs; freezing strands water creatures.
    - Fixed:
      - swims now look ahead to an imminent tide rise, and even shallows that will deepen count as a swim;
      - no autopilot swimming when badly hurt, mid-swim included;
      - an agreed swim keeps to its crossing;
      - travel keeps off visible water-bound creatures and walks around gas;
      - targeting says why a tile won't do;
      - inspect forecasts a straight trade of blows;
      - the altar glyph (`π`);
      - Swift status for relic haste;
      - wounded fleeing creatures stay cowed;
      - Choir Wraith 10 HP and a 3-damage wail;
      - floors announce their shrine and hermit, and the Abbot's floor always has a shrine;
      - "From here, the way up stays open";
      - the help explains there are no free swings.
  - Explorer-bot drownings were mostly the tide rising under it with no dry route left. Changes: fresh air now follows the walkable route and flags swims; base breath went from 5 to 6. Explorer drownings dropped from 50 to 36 of 150, and its wins rose from 7% to 11%. The navigator bot is unchanged at about 24%.
  - **Round 4** (two full runs plus a Depth 7 start). All three testers hit the account's session limit mid-run; their running notes survived.
    - Praised:
      - reach and sneak attacks turning scuttler packs from deadly to trivial after one boon;
      - Frostbite Ring, Set Against Charge and the spear interlocking to freeze wind-ups;
      - the floor-entry omens;
      - relic choices as clean three-way trade-offs;
      - the "too hurt to swim on autopilot" guard.
    - Found: every tester nearly drowned after agreeing to a short quoted swim. Replays showed the cause: explore aims at the edge of the known map, and when that edge is out in deep water, the quote counted only the swim to it. After consent, explore kept chasing newly seen water until breath ran out.
    - Fixed:
      - every stroke keeps known air within your breath, and travel turns back (or makes for air, planning for an imminent rise) when the way on runs past it;
      - open water is quoted as open, and explore only offers a look where one breath can go out and back;
      - consent covers only the crossing where it was given;
      - travel stops before a visible lurker's reach, and for wind-ups whose marks you can see, even from creatures you can't (which the log and sidebar now report);
      - knockback jolts rooted creatures out of a wind-up;
      - the Abbot omen names Depth 5;
      - the fight forecast counts the other attackers on you;
      - harness batches stop when you're hurt.
    - A tester-emulating fuzz (always agreeing to swims) over 200 runs, 152k automated steps and 4,041 agreed swims: 0 drownings, 0 swims longer than quoted, 0 deaths, 0 strandings. The old code had 165 overruns and 230 strandings in 60 runs. `tests/automation.test.ts` now fails on any drowning or stranding caused by automation.
  - **The Surface finale.** Bots won about 90% of Surface arrivals by walking to the beacon, which sits ~42 tiles from the sea while the Leviathan reaches 9. The first beacon flame now calls two hunting storm wisps (first placed 4–7 tiles from the lamp; round 5 moved them into your line of sight). The last three turns become a telegraphed decision: tank the lightning, clear the wisps, or break their sight. The inspect text, the arrival line and the omen all say so.
  - **Round 5** (one Depth 8 start, one Depth 2 start; testers copy their sessions out for replay):
    - pt14 won by lighting the beacon, after using inspect's numbers to weigh the Leviathan fight ("it falls in 15 of yours; meanwhile it deals you about 84 — you would fall first!").
    - pt13 killed the Abbot at 4 of 36 HP, dodging every wind-up they reacted to in time, and was alive on Depth 4 when the budget ran out.
    - Praised:
      - agreed swims that do what the quote says, including the automatic turn-back;
      - dodging three storm-wisp strikes with one sidestep;
      - Set Against Charge and Long Haft turning rat packs and a Lamplighter into free kills;
      - Thunderclap with Stormglass on Wet targets.
    - Fixed:
      - the storm the beacon calls now appears in your line of sight (the lamp room is walled, so it had been appearing behind the walls and never striking);
      - `>` travels to the beacon on the Surface;
      - blasts and shots reach a wraith inside a wall;
      - the sidebar lists the steps out of a wind-up;
      - taking an altar relic asks first;
      - travel isn't held up by slow hunters far off, or by melee hunters with no way to you;
      - fire wind-ups say when they land on something that burns, and the Abbot's tip says to meet him on stone;
      - the Abbot's and Faithful's tips state the cap on raised faithful (now tested);
      - harness repeats and batches stop when the tide rises around you.

  - **Round 6** (a Depth 2 start for the finale, a full run from Depth 10):
    - pt15 won by lighting the beacon. The storm now arrives in view and strikes (38 to 18 HP in one turn), and they called it "tense-and-fair" because it was announced beforehand. No bugs found.
    - pt16 was alive on Depth 7 when the budget ran out.
      - Praised: three kits that play differently, non-obvious boons, telegraphs with the steps out, the swim quotes and the automatic turn-back, and reading a Choir Wraith's weakness from `look` for a clean kill.
      - Fire they started kept spreading back to them through grass, and a rope bridge showed "goes under in ~0 turns".
    - Fixed:
      - wind-ups say what they do when they land ("drags you 2 closer, no damage");
      - the shrine says it takes a single offering;
      - `>` follows the fresh air when no way up is known;
      - badly hurt, automation won't go into ground you haven't seen (the fuzz found a death that way);
      - previews warn when fire you start can reach your tile;
      - bridges read as dry until the deck floods.

## Balance history

1. Fire killed too often. Fixed by softening tile fire, having the bot step out of flames, and fixing oil slicks that re-lit forever.
2. The Abbot was a wall. Softened: 60 HP, faithful at 6 HP / 2 damage, at most 2–3 faithful.
3. The Caves were too easy. Budgets raised to 23/27/30, cutthroats and gunners buffed, and a wrecker-crew encounter added.
4. Honest telegraphs (fire reach through oil, lightning through water) sharply cut fire deaths.
5. The explorer bot drowned a lot, which showed that pathfinding was unfair. Added the fresh-air compass, exit glow and contour lines, and slowed tides to 34→18.
6. Kits (weapon + art) made the early game stronger and more varied. The staff no longer starts empty-handed.
7. After the review fixes, the navigator bot wins about 21% of 400 runs (it was 25% on the same seeds before). The drop comes from monsters no longer freezing in `alert` and firepots losing their accidental double damage. The Abbot's Nave is the wall: about 27% of the runs that reach it die there, mostly to his burning censer and his raised faithful.
8. The first beacon flame calls two storm wisps. The navigator bot still wins 24% of 200 runs, and 48 of 54 Surface arrivals win. Storm wisps killed 5 of the 6 who died there, where before the Surface barely killed anyone who reached the beacon.
   - A playthrough showed the called wisps could spawn behind the lighthouse walls and never strike. They now gather in view: 33 of 40 arrivals win, 6 fall to the wisps and 1 drowns.
   - pt14 (round 5) lit the beacon untouched: the lamp sits in a small walled room, and the wisps appeared outside its walls with no line of sight. They now appear in your line of sight. Across 60 Surface floors the pair arrives in view every time, and its lightning lands during the lighting every time (20 damage in the rain). Bot arrivals: 31 of 39 win, 7 fall to the wisps, 1 drowns.
   - Explorer bot, same 150 seeds before and after the day's changes: 10 wins became 7, all of the difference at the Surface. Drownings stay at 46: the bots don't use travel, and the earlier figure of 36 predates other changes.

## Commands

- `npm test`: run the Vitest suite.
- `npx tsc --noEmit -p .`: type-check.
- `node scripts/dump-floors.ts <seed> [floor]`: ASCII dumps of generated floors.
- `node scripts/sim.ts <runs> heuristic|chaos [startSeed]`: bot statistics.

## Notes

- **Balance (first heuristic-bot sim, 40 runs).** The bot usually reaches floor 5 (the Abbot) and dies there, mostly to burning. The bot beelines to the exit in 40–56 turns per floor; humans will take longer.
- **The FOV test once failed** because the test marked out-of-bounds tiles via `y*w+x`, which aliased onto other tiles. The game code always bounds-checks.
