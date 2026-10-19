# UNDERTOW

*You broke the seal at the bottom of the Drowned Deep. Now the sea is coming in.*

UNDERTOW is a traditional turn-based roguelike for the browser. You climb ten floors out of a flooding abyss. Every floor floods from its lowest ground upward, so the tide is the clock. The rules are deterministic: attacks always hit, strong attacks wind up where you can see them, and fire, water, ice, lightning, oil and steam interact the same way for you and for every monster.

## Play

- **Easiest:** open `dist/index.html` in any modern browser. It is a single self-contained file.
- **From source:** `npm install`, then `npm run build`, then open `dist/index.html`.
- **Seeded runs:** enter a seed on the title screen, or open `dist/index.html?seed=12345`. The **Daily tide** button gives everyone the same dungeon each day.

Runs autosave to your browser (localStorage). Death is permanent.

## How it plays

- **The Tide.**
  - Water rises one step every ~20–34 turns, depending on depth.
  - You arrive low, and the way up (`<`) is on the high ground.
  - The sidebar shows:
    - a countdown to the next rise;
    - how long until your ground floods;
    - the direction fresh air is coming from (it follows the safest route to the way up and names the longest swim on it);
    - how long the way up stays open before it needs more than one breath of swimming.
  - Blue outlines mark the tiles about to flood.
  - Faint contour lines show ground height.
  - While you swim, the sidebar points to the nearest air and says how far it is.
  - Auto-travel stops at deep water, tells you how long the swim is, and asks before crossing. It never swims you past your breath: every stroke keeps known air within reach, and it turns back when the water runs on too far. Any damage stops it.
- **Legible dungeon.** Creatures that slip out of view leave a dim "last seen" marker. Ripples (`≋`) give away things under the water. The Rift (`«`) and the hermit (`&`) have their own glyphs. Floors announce their relic altar, tide shrine and hermit. Inspecting a creature shows what its blow would do to you and forecasts a straight trade of blows, counting the others already on you.
- **Exact combat.** There are no dice. Weak attacks land at once. Strong attacks wind up first: their tiles glow red, and the telegraph also shows fire spreading through oil and lightning through water. Even when the attacker is hidden in the dark, you see its marks. Knockback, stun and freezing interrupt a wind-up (bosses can't be interrupted, only dodged).
- **Elements.**
  - Fire spreads through grass, brush and wood, and burns oil even on water.
  - Water makes you Wet: fire hurts half, lightning twice, and lightning spreads through the pool.
  - Cold turns water to walkable ice and freezes wet creatures solid.
  - Oil doubles fire damage. Steam scalds.
- **Commitments.**
  - At the start you choose a kit: a weapon plus a starting art. Weapon moves are reach, lunge, cleave, knockback, pull, pierce, sneak attacks or focus.
  - Each climb offers 1 of 3 boons.
  - Vaults offer 1 of 3 relics; the others sink when you take one.
  - The belt holds 4 items.
  - Abilities refill once per floor, never by waiting. Health does not regenerate.
- **Routes.** Many floors have two exits. The **Stair** is the normal way up. The **Rift** leads to a harder floor with a guaranteed relic vault. Each exit's omen tells you what the next floor holds.
- **The Codex.** Every creature, relic and item you meet is written into a codex that survives death, along with how often each creature has killed you. Knowledge is the only thing that carries over.
- **Winning.** On the Surface, light the lighthouse beacon (its first flame calls the storm down on you) or drive off the Leviathan.
- **Four zones:**
  - **The Deep:** dark water and bioluminescence.
  - **The Sunken Cloister:** oil lamps, the drowned, and the Drowned Abbot.
  - **The Wreckers' Caves:** gunners, bombs, the siren.
  - **The Surface:** a storm, a lighthouse, and the Leviathan.

Press `?` in game for the full rules and controls.

## Controls

| Key | Action |
|---|---|
| Arrows, numpad, `hjklyubn` | Move or attack (bump) |
| `.` / Space / numpad 5 | Wait |
| `Q` `W` `E` `R` | Abilities |
| `1`–`4` | Belt items |
| `f` | Weapon attack at range (spear, harpoon, cutlass) |
| `g` | Pick up; use a shrine, spring or beacon |
| `d` | Drop |
| `<` | Climb |
| `>` | Travel to the way up (the beacon, on the Surface); if you haven't found it yet, follow the fresh air |
| `z` | Auto-explore |
| `x` | Look |
| `m` | Messages |
| `?` | Help |
| `Esc` | Menu |

**Mouse:** hover to inspect, click to travel or attack, right-click to look. When aiming, hovering shows the predicted result.

## Development

```bash
npm test                          # Vitest suite (mechanics, monsters, procgen invariants, determinism, bots)
npx tsc --noEmit -p .             # type-check
npm run build                     # dist/index.html (+ dist/artifact.html)
npm run dev                       # rebuild on change (unminified)
node scripts/dump-floors.ts 42    # ASCII dumps of every floor for seed 42
node scripts/sim.ts 200 heuristic 1 nav   # bot balance statistics (nav = knows the map; explore = only what it has seen)
node scripts/screenshot.mjs shots/x.png 42 '[{"key":"1"}]'   # headless screenshot via system Chrome/Edge
node scripts/tplay.ts run1 new 42  # text-mode play, one command batch per call ("help" lists commands)
```

The simulation core (`src/core`, `src/ai`, `src/procgen`, `src/content`) is pure and deterministic: seed plus command log equals the same game. That gives replays, save/load round-trips, reproducible bugs and headless bot runs. The UI (`src/ui`) only submits commands and renders.

See `docs/DESIGN.md` for the full design and `docs/PRINCIPLES.md` for the design principles behind it.
