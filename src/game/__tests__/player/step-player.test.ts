import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import {
  EYE_HEIGHT,
  FLY_SPEED,
  GRAVITY,
  JUMP_SPEED,
  SPRINT_MULTIPLIER,
  WALK_SPEED,
  createPlayerState,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from "~/game/player/step-player";
import { World } from "~/game/world";

/** All-false input with yaw/pitch 0 — spread and override per test. */
function baseInput(overrides: Partial<PlayerInput> = {}): PlayerInput {
  return {
    moveForward: false,
    moveBackward: false,
    moveLeft: false,
    moveRight: false,
    sprint: false,
    jump: false,
    up: false,
    down: false,
    toggleMode: false,
    yaw: 0,
    pitch: 0,
    ...overrides,
  };
}

const FRAME_DT = 1 / 60;

describe("stepPlayer — collision (blocked by stone)", () => {
  it("does not pass through a solid stone wall", () => {
    const world = new World();
    // Solid floor so gravity doesn't pull the player below the wall's
    // vertical extent before it reaches it horizontally, plus a tall wall
    // spanning x in [5, 6).
    for (let x = 0; x < 20; x++) {
      world.setBlock(x, 4, 0, BlockType.Grass);
    }
    for (let y = 5; y <= 8; y++) {
      world.setBlock(5, y, 0, BlockType.Stone);
    }

    let state = createPlayerState({ x: 3, y: 5, z: 0 });
    const input = baseInput({ moveRight: true, yaw: 0 }); // +x direction

    for (let i = 0; i < 120; i++) {
      state = stepPlayer(state, input, world, FRAME_DT);
    }

    // Player box is 0.6 wide, so its leading face can approach x=5 but must
    // not cross it: position.x (box center) caps at 5 - 0.3.
    expect(state.position.x).toBeLessThanOrEqual(4.7 + 1e-6);
    expect(state.position.x).toBeGreaterThan(3); // it did move, just got stopped
  });
});

describe("stepPlayer — landing (lands on grass)", () => {
  it("comes to rest on top of solid ground with onGround true", () => {
    const world = new World();
    world.setBlock(0, 4, 0, BlockType.Grass); // spans y in [4, 5)

    // Spawn well inside the single grass block's x/z footprint ([0,1)) so the
    // 0.6-wide box doesn't clip a neighboring (air) column.
    let state = createPlayerState({ x: 0.5, y: 9, z: 0.5 });
    const input = baseInput();

    for (let i = 0; i < 300; i++) {
      state = stepPlayer(state, input, world, FRAME_DT);
    }

    expect(state.onGround).toBe(true);
    expect(state.position.y).toBeCloseTo(5, 3); // resting on the grass top face
    expect(state.velocity.y).toBe(0);
  });
});

describe("stepPlayer — fly mode ignores gravity", () => {
  const flyState = (position: PlayerState["position"]): PlayerState => ({
    position,
    velocity: { x: 0, y: 0, z: 0 },
    mode: "fly",
    onGround: false,
  });

  it("does not accumulate downward velocity from gravity while hovering", () => {
    const world = new World();
    let state = flyState({ x: 0, y: 20, z: 0 });
    const input = baseInput();

    for (let i = 0; i < 60; i++) {
      state = stepPlayer(state, input, world, FRAME_DT);
    }

    expect(state.velocity.y).toBe(0);
    expect(state.position.y).toBeCloseTo(20, 6);
  });

  it("moves straight up on Space (up) and down on Ctrl (down)", () => {
    const world = new World();
    let state = flyState({ x: 0, y: 20, z: 0 });

    state = stepPlayer(state, baseInput({ up: true }), world, FRAME_DT);
    expect(state.velocity.y).toBe(FLY_SPEED);
    expect(state.position.y).toBeGreaterThan(20);

    state = stepPlayer(state, baseInput({ down: true }), world, FRAME_DT);
    expect(state.velocity.y).toBe(-FLY_SPEED);
  });
});

describe("stepPlayer — wall slide", () => {
  it("slides along a wall: blocks the perpendicular axis, keeps the parallel one free", () => {
    const world = new World();
    // A wall at x in [5, 6) running along z, well beyond the travel range.
    for (let z = -20; z <= 20; z++) {
      world.setBlock(5, 10, z, BlockType.Stone);
      world.setBlock(5, 11, z, BlockType.Stone);
    }

    let state: PlayerState = {
      position: { x: 3, y: 10, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "fly", // isolate horizontal sliding from gravity
      onGround: false,
    };
    // moveForward (-z) + moveRight (+x) at yaw=0: diagonal into the wall.
    const input = baseInput({ moveForward: true, moveRight: true, yaw: 0 });

    for (let i = 0; i < 200; i++) {
      state = stepPlayer(state, input, world, FRAME_DT);
    }

    // Blocked on x (wall face at x=5, box half-width 0.3).
    expect(state.position.x).toBeLessThanOrEqual(4.7 + 1e-6);
    // Not blocked on z — kept sliding a meaningful distance.
    expect(state.position.z).toBeLessThan(-5);
  });
});

describe("stepPlayer — jump only when grounded", () => {
  it("ignores jump input while airborne", () => {
    const world = new World(); // no ground nearby
    const state: PlayerState = {
      position: { x: 0, y: 20, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mode: "walk",
      onGround: false,
    };

    const next = stepPlayer(state, baseInput({ jump: true }), world, FRAME_DT);

    expect(next.velocity.y).not.toBe(JUMP_SPEED);
    expect(next.velocity.y).toBeCloseTo(GRAVITY * FRAME_DT, 6);
  });

  it("launches upward on jump when grounded", () => {
    const world = new World();
    world.setBlock(0, 4, 0, BlockType.Grass); // top face at y=5

    const state: PlayerState = {
      position: { x: 0.5, y: 5, z: 0.5 }, // resting exactly on the top face
      velocity: { x: 0, y: 0, z: 0 },
      mode: "walk",
      onGround: true,
    };

    const next = stepPlayer(state, baseInput({ jump: true }), world, FRAME_DT);

    expect(next.velocity.y).toBe(JUMP_SPEED);
    expect(next.onGround).toBe(false);
  });
});

describe("stepPlayer — sprint scales speed", () => {
  it("sprint multiplies horizontal speed by SPRINT_MULTIPLIER", () => {
    const world = new World(); // open air, no obstruction

    const walking = createPlayerState({ x: 0, y: 20, z: 0 });
    const walkResult = stepPlayer(
      walking,
      baseInput({ moveForward: true, yaw: 0 }),
      world,
      FRAME_DT,
    );

    const sprinting = createPlayerState({ x: 0, y: 20, z: 0 });
    const sprintResult = stepPlayer(
      sprinting,
      baseInput({ moveForward: true, sprint: true, yaw: 0 }),
      world,
      FRAME_DT,
    );

    expect(walkResult.velocity.z).toBeCloseTo(-WALK_SPEED, 6);
    expect(sprintResult.velocity.z).toBeCloseTo(
      -WALK_SPEED * SPRINT_MULTIPLIER,
      6,
    );
  });
});

describe("stepPlayer — double-tap mode toggle", () => {
  it("flips walk <-> fly on toggleMode without touching position", () => {
    const world = new World();
    const state = createPlayerState({ x: 0, y: 20, z: 0 });

    const toFly = stepPlayer(state, baseInput({ toggleMode: true }), world, FRAME_DT);
    expect(toFly.mode).toBe("fly");

    const toWalk = stepPlayer(toFly, baseInput({ toggleMode: true }), world, FRAME_DT);
    expect(toWalk.mode).toBe("walk");
  });
});

describe("EYE_HEIGHT", () => {
  it("is the documented 1.6 blocks above the feet position", () => {
    expect(EYE_HEIGHT).toBe(1.6);
  });
});
