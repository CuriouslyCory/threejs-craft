import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64 } from "~/game/persistence/base64";

describe("base64ToBytes / bytesToBase64", () => {
  it("round-trips arbitrary byte values, including 0x00 and 0xff", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("decodes a known base64 string to its expected bytes", () => {
    // "hi" -> [104, 105] -> base64 "aGk="
    expect(base64ToBytes("aGk=")).toEqual(new Uint8Array([104, 105]));
  });

  it("round-trips an empty byte array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(
      new Uint8Array(0),
    );
  });

  it("round-trips every byte value 0..255 in one payload (delta-shaped, non-Buffer)", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = i;
    }
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
