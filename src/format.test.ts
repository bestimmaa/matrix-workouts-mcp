import { describe, expect, it } from "vitest";

import { hms } from "./format.js";

describe("hms", () => {
  it("never prints sixty seconds", () => {
    expect(hms(119.6)).toBe("2:00");
    expect(hms(3613)).toBe("60:13");
  });
});
