import { describe, expect, it } from 'vitest';
import { submit } from '../src/core/game.ts';
import { addStatus } from '../src/core/effects.ts';
import { idx, isDeep, rebuildOcc } from '../src/core/floor.ts';
import { refreshVision } from '../src/core/vision.ts';
import { freshAir, nearestAir, player } from '../src/core/state.ts';
import { exploreGoals, pathTo, startTravel, telegraphTiles, travelNext } from '../src/ui/travel.ts';
import { hunt, testState } from './helpers.ts';

describe('travel and auto-explore', () => {
  it('walks a known path to the goal', () => {
    const { state } = testState([
      '#########',
      '#@......#',
      '#######.#',
      '#.......#',
      '#########',
    ]);
    const f = state.floor;
    const goal = idx(f, 1, 3);
    // Travel only uses tiles you have seen.
    expect(pathTo(state, goal)).toEqual([]);
    f.seen.fill(1);
    expect(pathTo(state, goal).length).toBe(13); // diagonals through the gap
    const t = startTravel(state, 'travel', goal);
    for (let k = 0; k < 40; k++) {
      const next = travelNext(state, t);
      if ('stop' in next) break;
      expect(submit(state, next.cmd).ok).toBe(true);
    }
    expect([player(state).x, player(state).y]).toEqual([1, 3]);
  });

  it('refuses to explore while something in view is hunting you', () => {
    const { state, mons } = testState([
      '###########',
      '#@.......c#',
      '###########',
    ], { c: 'cutthroat' });
    const t = startTravel(state, 'explore');
    // Unaware creatures in view don't stop travel (you can sneak past)...
    expect(state.floor.actors.some((a) => a.ai?.mode === 'hunt')).toBe(false);
    hunt(state, mons);
    // ...but a hunter does.
    const next = travelNext(state, t);
    expect('stop' in next && next.stop).toMatch(/hunting you/);
  });

  it('targets the edge of the known map and loose pearls', () => {
    const { state } = testState([
      '#######',
      '#@....#',
      '#######',
    ]);
    const f = state.floor;
    f.seen.fill(0);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) f.seen[idx(f, x, y)] = 1;
    const goals = exploreGoals(state);
    expect(goals).toContain(idx(f, 3, 1));
    f.items.push({ id: 999, x: 2, y: 1, item: { kind: 'pearls', def: 'pearls', count: 3 } });
    expect(exploreGoals(state)).toContain(idx(f, 2, 1));
  });

  it('notes distant unaware creatures without stopping, but stops for close ones', () => {
    const { state, mons } = testState(['################', '#@.............z#', '################'], { z: 'drowned' });
    state.floor.seen.fill(1);
    const t = startTravel(state, 'travel', idx(state.floor, 12, 1));
    t.seen.clear(); // as if the sailor had only just come into view
    const first = travelNext(state, t);
    expect('cmd' in first && first.note).toMatch(/in the distance/);
    mons[0]!.x = 5; // it wanders close (still unaware)
    state.floor.occ.fill(0);
    rebuildOcc(state.floor);
    refreshVision(state);
    const second = travelNext(state, t);
    expect('stop' in second && second.stop).toMatch(/coming closer/);
  });

  it('stops at deep water, says how far the swim is, and crosses once you agree', () => {
    const { state } = testState(['##########', '#@.≈≈≈...#', '##########']);
    const f = state.floor;
    f.seen.fill(1);
    const goal = idx(f, 8, 1);
    const t = startTravel(state, 'travel', goal);
    let next = travelNext(state, t);
    expect('cmd' in next).toBe(true);
    submit(state, (next as { cmd: Parameters<typeof submit>[1] }).cmd);
    next = travelNext(state, t);
    expect('stop' in next && next.swimTiles).toBe(3);
    const t2 = startTravel(state, 'travel', goal);
    t2.swim = true;
    for (let k = 0; k < 20; k++) {
      const n = travelNext(state, t2);
      if ('stop' in n) break;
      submit(state, n.cmd);
      t2.hp = player(state).hp;
    }
    expect(player(state).x).toBe(8);
    expect(t2.swim).toBe(false);
  });

  it('stops the moment you are hurt on the way', () => {
    const { state } = testState(['###########', '#@........#', '###########']);
    state.floor.seen.fill(1);
    addStatus(state, player(state), 'burning', 3);
    const t = startTravel(state, 'travel', idx(state.floor, 9, 1));
    const first = travelNext(state, t);
    expect('cmd' in first).toBe(true);
    submit(state, (first as { cmd: Parameters<typeof submit>[1] }).cmd);
    const second = travelNext(state, t);
    expect('stop' in second && second.stop).toBe('You are hurt!');
  });

  it('stops when the tide rises around you', () => {
    const { state } = testState(['##########', '#@~~~~~..#', '##########']);
    state.floor.seen.fill(1);
    state.floor.tideTimer = 2;
    const t = startTravel(state, 'travel', idx(state.floor, 8, 1));
    let stop = '';
    for (let k = 0; k < 10 && !stop; k++) {
      const n = travelNext(state, t);
      if ('stop' in n) stop = n.stop;
      else submit(state, n.cmd);
    }
    expect(stop).toMatch(/tide rises/);
  });

  it('judges a swim by the water it will be when the tide is about to rise', () => {
    // One deep tile, then shallows that the next rise will make deep: a 1-tile swim becomes 8.
    const { state } = testState(['#############', '#@≈~~~~~~~..#', '#############']);
    state.floor.seen.fill(1);
    state.floor.tideTimer = 2;
    const t = startTravel(state, 'travel', idx(state.floor, 11, 1));
    const ask = travelNext(state, t);
    expect('stop' in ask && ask.stop).toMatch(/about 1 tile now, but the tide rises in 2 and it becomes about 8/);
    expect('stop' in ask && ask.swimTiles).toBe(8);
    t.swim = true;
    const refuse = travelNext(state, t);
    expect('stop' in refuse && refuse.stop).toMatch(/you can hold your breath for 6/);
  });

  it('does not swim on autopilot when you are badly hurt, even mid-swim', () => {
    const { state } = testState(['##########', '#.@≈≈≈..#', '##########']);
    const f = state.floor;
    f.seen.fill(1);
    f.elev[idx(f, 2, 1)] = -3; // you are already swimming
    player(state).hp = 5;
    const t = startTravel(state, 'travel', idx(f, 7, 1));
    t.swim = true;
    const next = travelNext(state, t);
    expect('stop' in next && next.stop).toMatch(/too hurt to swim on autopilot/);
  });

  it('agreeing to swim does not trade the quoted route for a longer swim', () => {
    // Straight across is a 6-tile swim; the long way round has a single deep tile.
    const { state } = testState([
      '############',
      '#@≈≈≈≈≈≈...#',
      '#.########.#',
      '#.########.#',
      '#.########.#',
      '#.########.#',
      '#.########.#',
      '#.########.#',
      '#.########.#',
      '#...≈......#',
      '############',
    ]);
    const f = state.floor;
    f.seen.fill(1);
    const walk = (t: ReturnType<typeof startTravel>): { stop: string; swimTiles?: number } => {
      for (let k = 0; k < 40; k++) {
        const n = travelNext(state, t);
        if ('stop' in n) return n;
        submit(state, n.cmd);
        if (isDeep(f, idx(f, player(state).x, player(state).y))) deepSteps++;
      }
      return { stop: 'budget' };
    };
    let deepSteps = 0;
    // Travel takes the long way round and asks at the water's edge...
    const ask = walk(startTravel(state, 'travel', idx(f, 8, 1)));
    expect(ask.swimTiles).toBe(1);
    expect([player(state).x, player(state).y]).toEqual([3, 9]);
    // ...and agreeing swims that one tile, not the six straight across.
    const t = startTravel(state, 'travel', idx(f, 8, 1));
    t.swim = true;
    walk(t);
    expect([player(state).x, player(state).y]).toEqual([8, 1]);
    expect(deepSteps).toBe(1);
  });

  it('consent covers the crossing where you gave it, not one found later on', () => {
    // Agreeing to swim far from any water: by the time travel reaches the water, it asks again.
    const { state } = testState(['###############', '#@.........≈..#', '###############']);
    state.floor.seen.fill(1);
    const t = startTravel(state, 'travel', idx(state.floor, 13, 1));
    t.swim = true;
    let stop: { stop: string; swimTiles?: number } | undefined;
    for (let k = 0; k < 20 && !stop; k++) {
      const n = travelNext(state, t);
      if ('stop' in n) stop = n;
      else submit(state, n.cmd);
    }
    expect(stop?.swimTiles).toBe(1);
    expect(player(state).x).toBe(10);
  });

  it('never swims you into more water than your breath will carry you through', () => {
    const { state } = testState(['#############', '#@≈≈≈≈≈≈≈≈..#', '#############']);
    state.floor.seen.fill(1);
    const t = startTravel(state, 'travel', idx(state.floor, 11, 1));
    t.swim = true;
    const next = travelNext(state, t);
    expect('stop' in next && next.stop).toMatch(/about 8 tiles, and you can hold your breath for 6/);
    // An air bladder lifts the limit.
    addStatus(state, player(state), 'gills', 15);
    expect('cmd' in travelNext(state, t)).toBe(true);
  });

  describe('open water', () => {
    // A long dark channel: with a short lantern you only see a few tiles of it at a time.
    const channel = (breath: number) => {
      const { state } = testState(['#'.repeat(26), '#@' + '≈'.repeat(23) + '#', '#'.repeat(26)], {}, { ambient: 0 });
      state.build.maxBreath = breath;
      player(state).breath = breath;
      state.build.lantern = 3;
      refreshVision(state);
      return state;
    };
    const run = (state: ReturnType<typeof channel>, t: ReturnType<typeof startTravel>) => {
      let minBreath = 99;
      let farthest = 0;
      const notes: string[] = [];
      for (let k = 0; k < 60; k++) {
        const n = travelNext(state, t);
        if ('stop' in n) return { stop: n, minBreath, farthest, notes };
        if (n.note) notes.push(n.note);
        submit(state, n.cmd);
        minBreath = Math.min(minBreath, player(state).breath);
        farthest = Math.max(farthest, player(state).x);
      }
      throw new Error('travel did not stop');
    };

    it('swims out to look only as far as it can come back from, then turns back', () => {
      const state = channel(10);
      const ask = run(state, startTravel(state, 'explore')).stop;
      expect(ask.stop).toMatch(/edge of what you've seen, and on past it\. If no shore shows up in time, you'll turn back/);
      const t = startTravel(state, 'explore');
      t.swim = true;
      const r = run(state, t);
      expect(r.minBreath).toBeGreaterThanOrEqual(0); // never drowned
      expect(r.farthest).toBeGreaterThan(3); // it did go and look
      expect(r.notes.join(' ')).toMatch(/make for the nearest air/);
      expect(player(state).x).toBe(1); // back on the shore
      expect(r.stop.stop).toMatch(/Back on your feet|turn back/);
      // Now it knows the water runs on too far to scout, it leaves it to you.
      const again = run(state, startTravel(state, 'explore')).stop;
      expect(again.stop).toMatch(/open water, farther than one breath can scout/);
    });

    it('does not offer to scout water too far out to come back from', () => {
      const state = channel(6);
      state.build.lantern = 5;
      refreshVision(state);
      const r = run(state, startTravel(state, 'explore')).stop;
      expect(r.swimTiles).toBeUndefined();
      expect(r.stop).toMatch(/open water/);
    });

    it('mid-swim with the way on too long, makes for the nearest air', () => {
      const { state } = testState(['################', '#..≈≈@≈≈≈≈≈≈≈..#', '################']);
      const f = state.floor;
      f.seen.fill(1);
      f.elev[idx(f, 5, 1)] = -3; // already swimming, three strokes from the west shore
      player(state).breath = 4;
      const t = startTravel(state, 'travel', idx(f, 14, 1));
      const first = travelNext(state, t);
      expect('cmd' in first && first.cmd).toMatchObject({ dx: -1 });
      expect('cmd' in first && first.note).toMatch(/make for the nearest air/);
      let stop = '';
      for (let k = 0; k < 10 && !stop; k++) {
        const n = travelNext(state, t);
        if ('stop' in n) stop = n.stop;
        else submit(state, n.cmd);
      }
      expect(player(state).x).toBe(2);
      expect(player(state).breath).toBeGreaterThanOrEqual(0);
    });
  });

  it('shows the marks of a wind-up aimed from the dark, and stops for it', () => {
    const { state, mons } = testState(['##########', '#@.......#', '##########'], {}, { ambient: 0, place: [['urchin', 6, 1]] });
    state.build.lantern = 2;
    refreshVision(state);
    hunt(state, mons);
    submit(state, { t: 'wait' });
    const f = state.floor;
    const u = mons[0]!;
    expect(u.ai?.intent).toBeDefined();
    expect(f.vis[idx(f, u.x, u.y)]).toBe(0); // you can't see the urchin...
    expect(telegraphTiles(state).has(idx(f, 1, 1))).toBe(true); // ...but you see its line on you
    expect(state.log.some((l) => /Something you can't see readies Spine Volley/.test(l.text))).toBe(true);
    f.seen.fill(1);
    const next = travelNext(state, startTravel(state, 'travel', idx(f, 3, 1)));
    expect('stop' in next && next.stop).toMatch(/can't see is winding up an attack/);
  });

  it('on the Surface, travel to the way up heads for the beacon, following the air before you have seen it', () => {
    // The beacon is round a corner, out of sight: travel follows the fresh air until it's in view.
    const { state } = testState([
      '###########',
      '#@......#.#',
      '#######.#.#',
      '#######...#',
      '###########',
    ]);
    const f = state.floor;
    f.features = f.features.filter((x) => x.kind !== 'exit');
    f.features.push({ id: 999, kind: 'beacon', x: 9, y: 1 });
    f.seen.fill(0);
    refreshVision(state);
    expect(f.seen[idx(f, 9, 1)]).toBe(0);
    const t = startTravel(state, 'exit');
    const notes: string[] = [];
    let stop = '';
    for (let k = 0; k < 30 && !stop; k++) {
      const n = travelNext(state, t);
      if ('stop' in n) stop = n.stop;
      else {
        if (n.note) notes.push(n.note);
        submit(state, n.cmd);
      }
    }
    expect(notes.join(' ')).toMatch(/You follow the fresh air toward the beacon/);
    expect(stop).toMatch(/You reach the beacon/);
    expect(Math.max(Math.abs(player(state).x - 9), Math.abs(player(state).y - 1))).toBeLessThanOrEqual(1);
  });

  it('with no way up found yet, travel follows the fresh air (and says it has none on a floor without one)', () => {
    const { state } = testState(['###########', '#@........#', '###########']);
    const f = state.floor;
    f.features = f.features.filter((x) => x.kind !== 'exit' && x.kind !== 'beacon');
    expect((travelNext(state, startTravel(state, 'exit')) as { stop: string }).stop).toMatch(/not found a way up yet/);
  });

  it('badly hurt, it will not explore or follow the air into ground you have not seen', () => {
    const { state } = testState(['###########', '#@......#.#', '#######.#.#', '#######...#', '###########']);
    const f = state.floor;
    f.features = f.features.filter((x) => x.kind !== 'exit');
    f.features.push({ id: 999, kind: 'exit', x: 9, y: 1, route: 'stair' });
    f.seen.fill(0);
    refreshVision(state);
    player(state).hp = 8;
    const ex = travelNext(state, startTravel(state, 'explore'));
    expect('stop' in ex && ex.stop).toMatch(/badly hurt: exploring on autopilot/);
    const up = travelNext(state, startTravel(state, 'exit'));
    expect('stop' in up && up.stop).toMatch(/badly hurt, and the way up lies through ground you haven't seen/);
    // Over ground you know, travel still goes.
    f.seen.fill(1);
    expect('cmd' in travelNext(state, startTravel(state, 'exit'))).toBe(true);
  });

  it('stops before walking within reach of a creature lurking in the water', () => {
    const { state } = testState(['#########', '#@......#', '####≈####', '#########'], {}, { place: [['moray', 4, 2]] });
    state.floor.seen.fill(1);
    const t = startTravel(state, 'travel', idx(state.floor, 7, 1));
    let stop = '';
    for (let k = 0; k < 10 && !stop; k++) {
      const n = travelNext(state, t);
      if ('stop' in n) stop = n.stop;
      else submit(state, n.cmd);
    }
    expect(stop).toMatch(/within reach of the moray/);
    expect(player(state).x).toBe(2);
    expect(player(state).hp).toBe(player(state).maxHp);
  });

  it('with the tide about to rise, will not walk out onto flats it would drown far from air', () => {
    // Twenty tiles of knee-deep flats that the next rise turns deep. You are five tiles in,
    // heading for a spot farther out; the tide rises in 8.
    const { state } = testState(['#' + '.' + '~'.repeat(20) + '.#'.padEnd(2, '#'), '#' + '.' + '~'.repeat(20) + '.#', '#'.repeat(24)]);
    const f = state.floor;
    f.seen.fill(1);
    for (let x = 2; x <= 21; x++) for (const y of [0, 1]) f.elev[idx(f, x, y)] = 0;
    f.waterLevel = 1;
    f.tideTimer = 8;
    const p = player(state);
    p.x = 6;
    p.y = 1;
    rebuildOcc(f);
    refreshVision(state);
    f.seen.fill(1);
    const t = startTravel(state, 'travel', idx(f, 12, 1));
    let stop = '';
    for (let k = 0; k < 20 && !stop; k++) {
      const n = travelNext(state, t);
      if ('stop' in n) stop = n.stop;
      else submit(state, n.cmd);
    }
    expect(stop).toMatch(/tide rises in \d+, and out there it will close over your head, 7 strokes from air/);
    expect(p.x).toBe(7);
  });

  it('is not held up on land by a water-bound creature that cannot reach you', () => {
    const { state, mons } = testState(['#########', '#@....≈≈#', '#########'], {}, { place: [['bloom', 7, 1]] });
    hunt(state, mons);
    mons[0]!.submerged = false;
    state.floor.seen.fill(1);
    const t = startTravel(state, 'travel', idx(state.floor, 4, 1));
    const next = travelNext(state, t);
    expect('cmd' in next).toBe(true);
  });

  it('while swimming, points to the nearest air', () => {
    const { state } = testState(['#########', '#.≈≈@≈≈≈#', '#########']);
    state.floor.elev[idx(state.floor, 4, 1)] = -3; // the player's tile is deep too
    expect(nearestAir(state)).toMatchObject({ word: 'west', dist: 3 });
    player(state).x = 1;
    expect(nearestAir(state)).toBeUndefined();
  });

  describe('fresh air', () => {
    const withExit = (map: string[], x: number, y: number) => {
      const { state } = testState(map);
      state.floor.features.push({ id: 999, kind: 'exit', x, y, route: 'stair' });
      return state;
    };
    it('follows the walkable route, not a straight line through rock', () => {
      const state = withExit([
        '#########',
        '#@#####.#',
        '#.#####.#',
        '#.#####.#',
        '#.#####.#',
        '#.......#',
        '#########',
      ], 7, 1);
      const air = freshAir(state)!;
      expect(['south', 'south-east']).toContain(air.word);
      expect(air.deep).toBe(0);
    });
    it('warns how much deep water the way crosses', () => {
      const state = withExit(['#########', '#@.≈≈≈..#', '#########'], 7, 1);
      const air = freshAir(state)!;
      expect(air.word).toBe('east');
      expect(air.deep).toBe(3);
    });
    it('prefers several short swims to one long one', () => {
      // Top row: one 8-tile swim. Bottom row: a longer way, but broken by islands.
      const state = withExit([
        '#############',
        '#@≈≈≈≈≈≈≈≈..#',
        '#≈##########.',
        '#≈≈≈.≈≈≈.≈≈.#',
        '#############',
      ], 11, 1);
      const air = freshAir(state)!;
      expect(air.longestSwim).toBeLessThanOrEqual(3);
      expect(['south', 'south-east']).toContain(air.word); // down to the islands, not east across
    });
    it('takes a short dry detour over a swim', () => {
      const state = withExit(['#########', '#@.≈≈...#', '#.......#', '#########'], 7, 1);
      expect(freshAir(state)!.deep).toBe(0);
    });
  });
});
