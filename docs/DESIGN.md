# UNDERTOW — Design

> *You broke the seal at the bottom of the Drowned Deep. Now the sea is coming in.
> Climb ten levels to the surface before the tide takes you.*

A traditional, turn-based, grid roguelike for the browser. The run lasts ten floors and about 60–80 minutes for a win. Death is permanent. The only thing that carries over between runs is the player's knowledge.

This document is the spec. The numbers live in `src/content/*` and are tuned there. This file records intent and rules.

---

## 1. Pillars

Each pillar answers one of the design principles the game was built around. Those principles are written down in `docs/PRINCIPLES.md`.

1. **The Tide is the clock.**
   - Every floor floods from the lowest ground upward, one elevation step every *N* turns.
   - The flood is a timer you can see coming. The HUD shows a countdown, and the tiles that flood at the next rise are highlighted.
   - The flood also changes the terrain: fires go out, lightning spreads through water, swimmers take over, and whatever can't swim drowns.
   - You arrive at the low point of each floor and leave from the high point, so the water literally chases you.
   - Low grottos flood first, so loot left in them is always a gamble.
2. **Terrain is a weapon, and the rules are the same for everyone.**
   - Fire, water, ice, lightning, oil, steam and gas interact through a single reaction table.
   - Anything that can hurt a monster can hurt you, and anything that hurts you can be turned against a monster.
3. **Deterministic, readable combat.**
   - There are no hit rolls and no damage ranges. A hit always lands and always does the listed damage.
   - Weak attacks happen immediately. Strong attacks have a visible **wind-up** turn with the affected tiles highlighted.
   - Every death can be explained by a short chain of events, and the death screen shows that chain.
4. **Builds come from commitments.**
   - Your weapon family defines your moves: reach, cleave, lunge, knockback, pull, pierce, sneak.
   - Relics are limited to three slots. Abilities have charges that refill once per floor.
   - Every floor you climb offers **1 of 3** boons.
   - None of these is free to swap, and none is simply "a bigger number."
5. **Outs, not grinding.**
   - HP does **not** regenerate. Time can't be turned into health, so there's nothing to gain by resting.
   - Abilities refill when you reach a new floor, not while you wait. The belt holds 4 slots.
   - Every consumable is an out you'll wish you had saved, or be glad you used.

## 2. Structure of a run

| Floors | Zone | Themes | Signature questions |
|---|---|---|---|
| 1–3 | **The Deep** | darkness, bioluminescence, pools, coral | Things live in the water. What do you do about the water's edge? About groups? About armor? |
| 4–6 | **The Sunken Cloister** | halls, libraries, oil lamps, crypts | Fire, oil, gas, the restless dead, an armored warden. **Boss: the Drowned Abbot** (floor 6) |
| 7–9 | **The Wreckers' Caves** | kelp, sand, tide pools, smugglers | Coordinated humans: guns that aim, bombs, thieves. The siren's pull. |
| 10 | **The Surface** | a storm-lashed cliff and a lighthouse | Rain soaks everything, and lightning strikes come with a warning. **The Leviathan** rises. |

- **The start.** You choose one of three randomly offered **kits**. Each kit is a weapon plus a different starting art. That is the first commitment, and it makes every opening different.
- **Floor variants.** Flooded, Overgrown, Luminous, Restless, Hushed and Gloom. Each exit's omen names the variant of the floor above it, so picking a route also means picking a variant.
- **Finding the way up.**
  - The sidebar shows which direction *fresh air* comes from. The air flows from the way up along the best walkable route: the one whose longest unbroken swim is shortest (breath refills between swims), and among those the shortest.
  - The compass shows that route's heading a few steps ahead. It also names the longest swim on the route, and warns when that swim is more than one breath.
  - Following it always leads somewhere, without revealing the map.
  - Below the compass, a countdown says how long the way up stays open: the turns until that route needs more than one breath of swimming (or "cut off" once it does). Measured on generated floors, lingering near the entry for four rises cuts the way off on ~94% of floors, but halfway along the route almost never does. The countdown makes that pressure explicit.
  - Exits give off light.
  - Faint contour lines show the ground's height.
  - Telegraphs show where fire will spread through oil and lightning through water.
- **Climbing a floor.**
  - You heal 20% of max HP.
  - Ability charges refill.
  - You choose one of three **boons**.
- **Route choice.** Most floors have **two exits**:
  - The **Stair** leads to a normal floor.
  - The **Rift** leads to a floor that is harder and carries a guaranteed relic vault.

  Inspecting an exit shows an omen describing the next floor.
- **Winning.** On the Surface, either light the lighthouse beacon (stand at the lamp for 3 turns) or drive off the Leviathan. The first flame calls the storm: two storm wisps appear in your line of sight, 3–7 tiles off where there's room (the lamp room is small), and hunt you. They glow, so you see them arrive. Their lightning is marked a turn ahead and lands before the third feed: about 20 damage in the rain if you stand and take it. Lighting it means tanking that, dodging and starting the feed again, or clearing the wisps first. On the Surface, "travel to the way up" (`>`) takes you to the beacon.

## 3. Rules

### 3.1 Time
- One turn is 100 energy. Most creatures act once per turn. *Fast* creatures act twice, and *slow* creatures act every other turn.
- Turn order:
  1. The player acts.
  2. Monsters act in ascending id order.
  3. The environment updates: statuses tick, then fire, gas, surfaces and the tide.
  4. The turn counter increases by one.
- **Status durations are exact.** A status lasting *N* turns ticks *N* times. Applied during your action, it counts down that same turn (Brace 4 covers four enemy turns). Applied during the world tick, it starts counting next turn (a monster's stun still costs you your next turn). Damage over time follows the same rule.
- The engine owns the loop. The UI only submits commands.

### 3.2 Damage
- `damage = base × multipliers − armor`.
  - Armor applies to physical damage only.
  - The result is floored. A hit that would round to 0 still deals at least 1 when the base was 1 or more, unless the target is immune.
- Multipliers:

  | Condition | Effect |
  |---|---|
  | Sneak attack (target asleep or unaware of you) | ×2 (×3 with a knife) |
  | Weakness / resistance / immunity to the element | ×2 / ×½ / ×0 |
  | Wet | lightning ×2, fire ×½ |
  | Oiled | fire ×2, and the target starts Burning |
  | Frozen | physical ×2, and the hit thaws the target |
- Every point of damage is recorded as an event with its source and cause. The log and the death recap are both built from those events.

### 3.3 Water and the Tide
- Every tile has an **elevation**. The floor has a **water level** *L*. A tile's water depth is `L − elev`:
  - 1 or less: shallow water.
  - 2 or more: deep water.
- **Shallow water** makes you Wet, puts out Burning, carries lightning, and keeps tile fires from burning there.
- **Deep water** means swimming:
  - You hold 6 breaths (relics change this). Breath drops by 1 each turn in deep water and refills completely on any tile that isn't deep.
  - While you swim, the sidebar shows the nearest air: the heading and swim length to the closest tile you can breathe on. It turns red when that's farther than your breath lasts.
  - At 0 breath you drown: 2, 3, 4… damage per turn.
  - Weapon blows made while swimming deal half damage. Walking monsters floundering in deep water hit at half strength too; natural swimmers don't.
  - Non-swimming monsters drown by the same rules. Undead don't breathe.
- **The Tide.** *L* rises by 1 every `interval` turns. The interval depends on the zone and on floor modifiers.
  - The HUD shows the countdown.
  - Tiles that will change at the next rise are highlighted for the last 3 turns before it.

### 3.4 Elements and surfaces

| Element | What it reacts with | Result |
|---|---|---|
| Fire | grass, brush, wood, oil | ignites; oil burns even on top of water |
| Fire | water | makes **steam** (a scalding gas that blocks sight) |
| Fire | ice | melts it |
| Fire | an Oiled creature | the creature starts Burning |
| Cold | water | turns to ice (walkable and slippery; melts after about 15 turns or when burned) |
| Cold | a Wet creature | **Frozen** |
| Cold | fire | puts it out |
| Lightning | water | travels through the connected water within the radius |
| Lightning | a Wet creature | ×2 damage |
| Water | a creature | makes it Wet and washes off Oil |
| Water | fire | puts it out |

- Fire spreads the same way every time. Grass and brush catch the turn after fire is next to them. Wood takes 2 turns. Oil catches instantly across the whole connected slick.
- **Fire belongs to whoever lit it.** Burning tiles remember their igniter, and spreading fire and burning creatures pass it on, so fire kills count as yours (Leech Hook, Ghost Blade, Ember Heart all apply). Damage over time and from the ground wakes a creature but doesn't tell it where you are.
- Gases (steam, smoke, miasma) spread out and fade away each turn.

### 3.5 Stealth
- Monsters are in one of three states: **Asleep**, **Wandering** (unaware of you) or **Hunting**.
- Noise wakes sleepers, and each action has a noise radius. Attacks and fire are loud.
- A wandering monster notices you only if you're inside its sight radius *and* it has line of sight to you. Brush blocks line of sight.
- When a monster notices you, it spends the rest of that turn raising the alarm (shown as `!`), even if it is fast. Your next turn is your window.
- If it loses sight of you while still reacting (smoke, hiding), it goes looking for you instead.
- A creature wounded past its flee threshold stays cowed: when it spots you again, it runs rather than re-engaging.

### 3.6 Intents and telegraphs
- Any attack stronger than a basic melee hit has a wind-up. The monster's `intent` stores the affected tiles and the tick it lands on (`resolveTurn`): the monster's first action at or after its wind-up, and never before your next turn. Fast monsters hold while winding up; slow ones take longer, and the countdown says so.
- Intents are drawn on the map in red, and each monster's intent is also listed in the sidebar with its exact countdown.
- A wind-up by a creature you can't see (in the dark, or under the water) still shows the marks you can see. The log says "Something you can't see readies Spine Volley!", and the sidebar lists it as "Something you can't see". You learn that the attack is coming, not where it comes from.
- Knockback (even into a wall, or against a creature rooted in place that can't be moved), stun and freeze break a wind-up. Attacks that need sight (the Siren's song) fail if you break line of sight before they land.
- Bosses are unstoppable: they can't be stunned, frozen, rooted or knocked back. Their wind-ups can only be dodged, and their inspect text says so.
- Stepping out of a wind-up aimed at you is logged ("You dodge the …"), and the threat list says "you are in it!" while you stand in one. Below it, the sidebar lists the single steps that leave every marked tile, or says that none does.
- Blasts, cones, splashes, waves and shots reach a creature inside a wall (a Choir Wraith passing through one), just as your blade and its claws do.
- Friendly fire is real: an aimed shot hits the first creature in its line.
- There are no free swings. Stepping away from a melee attacker costs it its turn to follow.
- **Rhythm, not kiting.** Throwers (Powder Monkey, Storm Wisp) and shooters (Gunner, Lamplighter) keep their distance only while they have something ready; while reloading they hold their ground, which is the window to close in. The tips say so.
- **Inspect forecasts a fight:** what a creature's blow would do to you (armor, wet and frozen included), how many of your blows it takes against what it deals you meanwhile, and what the others already on you add in that time.

## 4. Player build

- **Weapons.** One is equipped at a time, and each has a move you use just by attacking:

  | Weapon | Damage | What it does |
  |---|---|---|
  | Knife | 3 | Sneak attacks deal ×3. |
  | Cutlass | 4 | **Lunge**: step straight toward an enemy two tiles away and strike it for +2. |
  | Spear | 4 | **Reach 2**: hit an enemy two tiles away, over water or fire. |
  | Boarding Axe | 4 | **Cleave**: also hits the two tiles beside the target that are next to you. |
  | Maul | 5 | **Knockback 1**. Slamming the target into a wall or another creature deals +3 to both. |
  | Harpoon | 3 | **Pull**: hit an enemy up to 4 tiles away in a line and drag it next to you. |
  | Trident | 4 | **Pierce**: also hits the tile behind the target. +2 against targets standing in water. |
  | Driftwood Staff | 2 | Every ability gets +1 charge per floor. |

  Weapon upgrades are tied to the weapon item itself. If you switch weapons, you give them up.
- **Abilities.** Up to 4, with charges that refill each floor. Examples: Flare, Frost Breath, Spark, Surge, Blink, Smoke Veil, Stillwater, Second Wind.
- **Relics.** 3 slots. Each one either changes one of your moves or gives a real tradeoff; none of them is a plain stat stick.
- **Belt.** 4 slots, each holding a stack of up to 3 of the same item. Contents are tonics, throwables (oil, fire, frost, shock, smoke), blink shells, air bladders and tide glasses.
- **Pearls.** The currency. They're found in risky spots and spent at Tide Shrines and the hermit merchant.

## 5. Floors (procgen)

The generator carries forward the organic toolkit from Platycrawl, rewritten to be seeded and to check its own output. The pipeline:

1. **Carve.** Target-biased drunkard walks form the meadow or cavern body. Shapes from a library (circles, rings, pillared halls, hexes, spirals, cellular-automata blobs) are attached so that their doors line up with the existing layout. Doors are added to create loops.
2. **Elevation.** Distance from the entry is blended with noise. Basins are carved for pools. The exit sits on high ground.
3. **Features by zone.** Grass and brush from noise, coral, bookshelves, oil lamps, kelp, bridges.
4. **Validate.**
   - The exit must be reachable on foot.
   - Every item must be reachable, swimming allowed.
   - Entry-to-exit distance must fall within a set band.
   - A floor that fails is rerolled with a sub-seed.
5. **Tag regions.** Main path, side branches, dead ends, grottos (low ground), high ground, islands.
6. **Place features.** Vault or cache, shrine, spring, merchant.
7. **Place encounters.** Zone templates such as packs, turrets at chokepoints, aquatic monsters in pools, and ambushers in brush.
8. **Place loot where the risk is.** In grottos, on islands, in dead ends, and behind burnable doors.

## 6. Legibility and interface

- **Canvas map.** Coloured glyphs, lighting, and a remembered map drawn in muted colours.
- **DOM sidebar.**
  - Health and breath.
  - Tide gauge.
  - Weapon, abilities, belt and relics.
  - Visible monsters with their intents.
- **Look mode and mouse hover.** Show the tile, its elevation, and how many turns until it floods. Also show monster stats and abilities, with descriptions generated from the data so they can't drift from the rules.
- **Targeting previews.** These run the same code as the real action on a cloned state. They show damage, kills, pushes and reactions, but never anything hidden from the player.
- **Death recap.** The killer and cause, the last events, the unused outs, and the seed.
- **The Codex.** Every creature, relic and belt item you have met, remembered across runs, with how many times each creature has killed you. Knowledge is the only meta-progression.
- **Pacing tools.** Auto-explore and click-to-travel.
  - "Travel to the way up" (`>`) walks a known path to the Stair (or the Rift if it's the only way up known, or the beacon on the Surface). With no known way yet, it follows the fresh air: the route the compass shows, step by step, through unexplored ground. It reveals nothing the compass doesn't.
  - Both stop as soon as a new threat comes into view, and won't start while something in view is hunting you. Some hunters don't count: creatures bound to the water while you're on land, and creatures rooted in place. Unless you're below a third of your health, neither do creatures slower than you while they're more than three tiles off (you can outwalk them; travel stops if one closes in), or creatures that only fight up close and have no way to you over ground you know (by their own pathing, e.g. a rat that won't swim a moat).
  - Travel stops at the edge of deep water and says how long the swim is. You can agree to swim that one crossing, and breathing from an Air Bladder counts as agreeing.
    - The consent covers the crossing where you gave it. It ends when you're back on your feet, or if travel reaches dry land again before swimming.
    - When the water runs on past what you've seen, the quote says so ("about 2 tiles out to the edge of what you've seen, and on past it"). Agreeing sends you out to look, and travel turns back if no shore shows up in time.
    - Auto-explore only offers such a look where one breath can swim out and back. Water farther out is left to you, and it says so.
  - Travel never sets out on a crossing longer than your breath. Every stroke keeps the nearest air you know within your remaining breath, so it can always turn back. When the way on runs out, it swims for the nearest air and then hands over.
  - With the tide about to rise, it plans for the risen water. It won't walk out where the flood would close over your head far from air, and a turn-back makes for air that will still be air.
  - It stops before stepping within reach of a creature you can see lurking in the water, and for any wind-up whose marks you can see, even from a creature you can't.
  - Below a third of your health, automation won't go into ground you haven't seen, whether exploring or following the air: one blow from something in the dark could finish you. Travel over known ground still works.
  - Any damage taken on the way (drowning included) stops it at once. Automation must never kill you, and must never leave you drowning. `tests/automation.test.ts` fuzzes both.
- **Last seen.** A creature that slips out of view leaves a dim marker (its glyph and a `?`) where you last saw it. The marker lasts until you see that spot again, it dies, or 25 turns pass.
- **Vaults are announced.** Arriving on a floor with a relic altar logs it, and the sidebar keeps a reminder until the relics are taken or sunk, so exploring for one is an informed choice. An ordinary vault hides in the farthest dead end, a median 31-step detour. The Rift's promised vault sits in the dead end nearest the way through, a median 5-step detour.
- **Distinct glyphs for things that matter.** `<` stair, `«` Rift, `&` the hermit, `≋` ripples over something submerged. Colour is never the only cue.

## 7. Tech

- The simulation core in `src/core` is deterministic and has no DOM. All randomness comes from a seeded, serialisable RNG. Floors are generated from `hash(runSeed, floorIndex)`. A run replays from its seed plus the command log.
- `src/ui` holds canvas and DOM rendering, input, and cosmetic animation. Cosmetic animation has its own separate RNG.
- `src/bot` is a headless auto-player used for crash fuzzing and balance statistics.
- Tooling:
  - Vitest for tests.
  - esbuild to build a single-file `dist/index.html`.
  - playwright-core, driving the installed Chrome, for screenshots.
