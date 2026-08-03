import { describe, expect, it, vi } from "vitest";
import { createClientId } from "./client-id";

describe("createClientId", () => {
  it("uses randomUUID when the browser provides it", () => {
    const randomUUID = vi.fn(() => "native-id");
    expect(createClientId({ randomUUID, getRandomValues: vi.fn() })).toBe("native-id");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a UUID with getRandomValues on an insecure LAN origin", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return bytes;
    });
    expect(createClientId({ getRandomValues })).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
