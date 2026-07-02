import { describe, expect, it } from "vitest";

import { EYE_HEIGHT } from "~/game/player/player-box";

describe("EYE_HEIGHT", () => {
  it("is the documented 1.6 blocks above the feet position", () => {
    expect(EYE_HEIGHT).toBe(1.6);
  });
});
