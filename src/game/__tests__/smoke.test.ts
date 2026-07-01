import { describe, expect, it } from "vitest";

import { add } from "~/game/smoke";

describe("smoke", () => {
  it("resolves the ~/ alias and runs in a node environment", () => {
    expect(add(2, 3)).toBe(5);
  });
});
