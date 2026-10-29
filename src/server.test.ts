import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { SERVER_VERSION } from "./server.js";

describe("server identity", () => {
  it("announces the version package.json carries", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
