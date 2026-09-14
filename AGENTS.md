# AGENTS.md — matrix-workouts-mcp

An MCP server over one account's Matrix / Johnson Fitness ride history. README.md
makes the case to a person; this file is for whoever has to work on it.

The parser, API client and export format are **not here**. They are
[`matrix-workouts-core`](https://github.com/bestimmaa/matrix-workouts-core), shared
with the Chrome extension. Anything about the record shape, the upstream API, program
modes, heart-rate filtering or the export document belongs in that repo — this one is
tools, caching, transports and text.

---

## What belongs in this file

Four documents, one job each. Putting something in the wrong one is how it rots.

| File | Holds |
|---|---|
| `README.md` | what this is, how to install and configure it, what the tools do. |
| `AGENTS.md` | how to work on it — decisions, rules, and gotchas that already cost a bug. |
| `CHANGELOG.md` | what changed, per released version. The release script refuses without it. |
| the core repo | everything about the records themselves. |

**Say it once.** A fact in two files is one fact and one future lie — and with three
repositories the temptation to restate is constant. Cross-link instead.

---

## Required commands

```
npm test            # vitest run — no network, no credentials
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
```

All three must pass before committing. Releases go through
`npm run release -- <patch|minor|major>`, which refuses a dirty worktree, a branch
that is not `main`, the wrong remote, or a version with no `CHANGELOG.md` entry, then
stops short of pushing and publishing.

**`matrix-workouts-core` is a dependency, so a core change is two releases.** Publish
core, bump the range here, release this. The script does not know that and cannot;
this line is the whole reminder.

---

## The shape is fixed by the API

`GET /exerciser/{id}/workouts` returns **every ride on the account in a single
response**, and the per-workout endpoint in the site's bundle answers 404. There is no
way to fetch one ride. Everything else follows from that:

- **One download per process, cached to disk, shared by every tool.** A tool that
  fetched per call would re-download an entire history a dozen times a conversation.
  `src/history/store.ts` is the only thing that talks to the network.
- **The cache is a cache, not an archive.** One slot, overwritten in place. The
  archive is what `matrix-workouts-history` writes, and that is a different job.
- **A stale answer that says it is stale beats no answer.** When a refresh fails and a
  cache exists, the cache is served and every tool's footer says where the data came
  from and when. Look at the order in `snapshotNow()`: memory, fresh cache, network,
  stale cache.
- **Running with no credentials is a supported mode, not a degraded one.** Point
  `MATRIX_CACHE_DIR` at a history downloaded by the CLI and everything except
  `refresh_history` works, with no passcode in any config file. Prefer it.

---

## Tools are text, and the budget is tokens

Every tool returns text. One ride is ~360 samples of ten fields; a JSON object per
sample spends roughly three times what a CSV row does on punctuation and repeated
keys, and buys a model nothing a header line does not.

- **Aggregates by default, raw samples only when asked.** `get_workout` does not
  return a series. `get_samples` takes a window, a stride and a row cap, and says so
  when it truncates rather than silently cutting.
- **A dropout is an empty cell, never the console's `0`.** A zero in a heart-rate
  column is a number a model will cheerfully average. Note the mask from
  `flagHeartRateDropouts` is *validity* — `true` means the reading is real. Reading it
  the other way blanks every good sample and keeps every bad one, which looks fine
  until someone averages the column. It cost a bug here already; there is a test.
- **Both heart-rate averages, always.** The platform's figure is not derived from the
  series and does not always agree with it. On the 03 Sep 2026 ride the console's
  153 bpm matched an Apple Watch exactly while the filtered series gave 151, because
  the console averaged in real time ahead of the dropouts. On a bad strap *theirs* is
  the better number, so reporting only ours would be quietly misleading.
- **`export_workout` returns a path.** The document is far larger than any answer
  should be, and a file is a thing you keep rather than a thing you paste.
- **`truncated` and `skipped` are surfaced, never swallowed.** They exist in the core
  precisely so a partial history cannot pass for a complete one.

**Cross-ride analysis lives here, in `src/analysis/`, not in the core package.** The
power curve and the bucketing are the first cross-ride views this project has ever
had. If the extension ever wants to draw a power curve, promote that code to core
*then* — putting it there now would be a published library carrying code with no
second consumer.

---

## Privacy — non-negotiable

The difference between this server and the extension is that this one hands a health
record to a language model. That is the user's decision to make, and the server's job
is to make it a small and reversible one.

- **The HTTP transport refuses to start without `MATRIX_MCP_TOKEN`** and binds
  `127.0.0.1` by default. Do not relax either to make a container easier to wire up.
- **The passcode is used for one request.** Never stored, never logged, never
  returned. `loginWithXid` returns `Credentials` and drops the profile; do not widen
  it.
- **Never let an error object escape into a tool response** — only its message. A
  thrown value from the API client can carry the request that produced it, and that
  request has a bearer token in its headers. `src/server.ts` is where that is
  enforced.
- **Cached and exported files are `0600`**, and the cache directory is created `0700`.
- No telemetry, no analytics, no request to anything but `apollo.jfit.co`.

---

## Testing

**Vitest**, against three real captured rides in `fixtures/`, with a stubbed
downloader. The suite needs no network and no credentials, and it must stay that way:
a test that needs a passcode is a test nobody runs.

The three are chosen, not arbitrary — a Sprint 8 (the only structural variant, with
400 W spikes), a target-heart-rate ride with 80 dropouts, and the snake_case one
captured from the API itself. Between them they cover both wire shapes and both ends
of strap quality. The full set lives in the core repo; take another from there if a
test needs one.

`src/docs.test.ts` asserts the README's tool and environment tables match what the
server actually registers and reads, in both directions. It is the same argument as
the core repo's layering test: a convention nothing checks is a convention that
drifts, and documentation drifts faster than code because nothing else fails when it
does.

---

## Conventions

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`).
- Don't commit `dist/`.
- Explicit units in identifiers: `powerWatts`, `durationSeconds`, `windowSeconds`.
- Tool descriptions are written for a model choosing between them, not for a human
  reading a list. Say what it returns and when to reach for it over its neighbour.
