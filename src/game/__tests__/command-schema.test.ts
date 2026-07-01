import { describe, expect, it } from "vitest";

import { BlockType } from "~/game/blocks";
import type { Command, CommandResult } from "~/game/command";
import {
  CommandResultSchema,
  CommandSchema,
} from "~/game/command-schema";

describe("CommandSchema", () => {
  it("round-trips a BreakBlock command", () => {
    const command: Command = { type: "BreakBlock", at: { x: 1, y: 2, z: 3 } };

    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it("round-trips a PlaceBlock command", () => {
    const command: Command = {
      type: "PlaceBlock",
      at: { x: -4, y: 0, z: 12 },
      block: BlockType.Stone,
    };

    expect(CommandSchema.parse(command)).toEqual(command);
  });

  it("rejects an unknown command type", () => {
    expect(() =>
      CommandSchema.parse({ type: "FlyBlock", at: { x: 0, y: 0, z: 0 } }),
    ).toThrow();
  });

  it("rejects a PlaceBlock with a missing block", () => {
    expect(() =>
      CommandSchema.parse({ type: "PlaceBlock", at: { x: 0, y: 0, z: 0 } }),
    ).toThrow();
  });

  it("rejects a PlaceBlock with an out-of-range block id", () => {
    expect(() =>
      CommandSchema.parse({
        type: "PlaceBlock",
        at: { x: 0, y: 0, z: 0 },
        block: 99,
      }),
    ).toThrow();
  });

  it("rejects a command with a malformed `at`", () => {
    expect(() =>
      CommandSchema.parse({ type: "BreakBlock", at: { x: 0, y: 0 } }),
    ).toThrow();
  });
});

describe("CommandResultSchema", () => {
  it("round-trips an ok result", () => {
    const result: CommandResult = {
      ok: true,
      changed: ["0,0,0", "1,0,0"],
      drop: BlockType.Dirt,
    };

    expect(CommandResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips an ok result with no drop", () => {
    const result: CommandResult = { ok: true, changed: ["0,0,0"] };

    expect(CommandResultSchema.parse(result)).toEqual(result);
  });

  it.each([
    "OutOfRange",
    "TargetIsAir",
    "Occupied",
    "NotInInventory",
  ] as const)("round-trips a reject result with reason %s", (reason) => {
    const result: CommandResult = { ok: false, reason };

    expect(CommandResultSchema.parse(result)).toEqual(result);
  });

  it("rejects an unknown reject reason", () => {
    expect(() =>
      CommandResultSchema.parse({ ok: false, reason: "TooFarAway" }),
    ).toThrow();
  });
});
