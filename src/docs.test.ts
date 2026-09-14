import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ENV_VARS } from "./config.js";
import { TOOLS } from "./tools/index.js";

/**
 * The README, enforced rather than merely intended — the same argument as the
 * layering test in `matrix-workouts-core`, applied to documentation.
 *
 * An MCP server's README is not decoration. It is how a person decides whether to
 * install the thing and how they configure it once they have, and its tool table is
 * the only place the surface is written down in one piece. A tool added without a row
 * is a tool nobody knows exists; a row left behind after a tool is removed sends
 * someone looking for something that will never answer. Neither fails any other test,
 * and both rot quietly. So they fail this one.
 *
 * Tables are read by their header — `| Tool |` and `| Variable |` — rather than by
 * position, so the README can be reorganized freely without breaking the check.
 */
const README = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

/** First-column backticked names of the table whose header row starts with `header`. */
function tableKeys(markdown: string, header: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header} `) || line.startsWith(`|${header}`));
  if (start === -1) return [];

  const keys: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const first = line.split("|")[1]?.trim() ?? "";
    const name = /^`([^`]+)`/.exec(first)?.[1];
    if (name) keys.push(name);
  }
  return keys;
}

describe("README documents the server's surface", () => {
  const documentedTools = tableKeys(README, "Tool");
  const documentedVars = tableKeys(README, "Variable");

  it("has a row for every registered tool", () => {
    const missing = TOOLS.map((tool) => tool.name).filter((name) => !documentedTools.includes(name));
    expect(missing).toEqual([]);
  });

  it("has no row for a tool that does not exist", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(documentedTools.filter((name) => !names.includes(name))).toEqual([]);
  });

  it("has a row for every environment variable the server reads", () => {
    const missing = ENV_VARS.filter((name) => !documentedVars.includes(name));
    expect(missing).toEqual([]);
  });

  /*
   * Not a style check: the quickstart is the only part of this file most readers run,
   * and a README that names a binary nobody can invoke wastes their afternoon. Assert
   * the pieces, not the exact line, so `npx -y` and `claude mcp add` can be written
   * however reads best.
   */
  it("shows how to launch the published binary", () => {
    const quickstart = README.slice(0, README.indexOf("## Configuration"));
    expect(quickstart).toMatch(/npx[^\n]*matrix-workouts-mcp/);
  });
});
