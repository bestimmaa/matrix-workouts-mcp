import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { SERVER_VERSION, createServer } from "./server.js";
import { storeWith } from "./testSupport.js";
import { TOOLS } from "./tools/index.js";

describe("server identity", () => {
  it("announces the version package.json carries", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

/*
 * Through a real client and transport, because the bug lived entirely in the SDK's
 * parse before the handler: a handler called directly never sees the stripped key, so
 * no direct-call test could have caught `groupBy` coming back as a whole-history
 * answer shaped like a correct one.
 */
describe("tool arguments", () => {
  async function connected() {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(storeWith()).connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    return client;
  }

  const text = (result: Awaited<ReturnType<Client["callTool"]>>): string =>
    (result.content as { type: string; text: string }[]).map((part) => part.text).join("");

  it("answers a call that names only real arguments", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "summarize_history", arguments: { bucket: "week" } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Volume by week");
  });

  it("refuses an argument the tool does not take, and names it", async () => {
    const client = await connected();
    const call = client.callTool({ name: "summarize_history", arguments: { groupBy: "week" } });
    const message = await call.then(
      (result) => (result.isError ? text(result) : "answered"),
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(message).toContain("summarize_history");
    expect(message).toContain("'groupBy'");
    expect(message).toContain("takes: from, to, machineType, mode, bucket, windowsSeconds");
  });

  it("still lists every tool, with its arguments", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const samples = tools.find((t) => t.name === "get_samples");
    expect(samples?.inputSchema.required).toEqual(["id"]);
  });
});
