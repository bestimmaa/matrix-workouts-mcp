# matrix-workouts-mcp

[![npm](https://img.shields.io/npm/v/matrix-workouts-mcp.svg)](https://www.npmjs.com/package/matrix-workouts-mcp)
[![CI](https://github.com/bestimmaa/matrix-workouts-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/bestimmaa/matrix-workouts-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An MCP server for your Matrix / Johnson Fitness ride history, so an AI agent can
answer questions about it.

The dashboard at `matrixworkouts.jfit.co` shows six numbers per ride. The record
behind it carries a sample every 10 seconds with **power (watts), console resistance
level and cadence (rpm)** — none of which appears anywhere in the site's UI, and none
of which its own list page can reach for anything older than about a week. This server
hands all of it to an agent, with the cross-ride views the platform has never had:
power curve, training volume by week or month, one ride against another.

```
> what was my best 5-minute power this month, and which ride was it?
> compare my last two Sprint 8 sessions
> has my average power at resistance 8 moved since August?
```

## Install

```bash
claude mcp add matrix-workouts -- npx -y matrix-workouts-mcp
```

Or, in a client that takes JSON:

```json
{
  "mcpServers": {
    "matrix-workouts": {
      "command": "npx",
      "args": ["-y", "matrix-workouts-mcp"],
      "env": {
        "MATRIX_XID": "your-member-number",
        "MATRIX_PIN": "your-passcode"
      }
    }
  }
}
```

Node 20 or newer.

**You can also run it without credentials.** Download your history once with
[`npx matrix-workouts-history`](https://github.com/bestimmaa/matrix-workouts-core),
point `MATRIX_CACHE_DIR` at the result, and every tool except `refresh_history` works
against it. No passcode in a config file, no sign-in from the server at all.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `MATRIX_XID` | — | Member number from the gym tag. Without it the server is read-only over the cache. |
| `MATRIX_PIN` | — | Numeric passcode. Used for one sign-in request, never stored or logged. |
| `MATRIX_CACHE_DIR` | `~/.cache/matrix-workouts-mcp` | Where the downloaded history is kept, written `0600`. |
| `MATRIX_CACHE_TTL_MINUTES` | `60` | How long a cached history is served before a refetch. |
| `MCP_TRANSPORT` | `stdio` | Set to `http` to serve over HTTP instead. |
| `MATRIX_HTTP_PORT` | `3000` | HTTP transport only. |
| `MATRIX_HTTP_HOST` | `127.0.0.1` | HTTP transport only. Loopback on purpose — see Privacy. |
| `MATRIX_MCP_TOKEN` | — | Bearer token. **Required** for the HTTP transport; the server refuses to start without it. |

## Tools

| Tool | Returns |
|---|---|
| `list_workouts` | Rides newest first, one compact row each. Filter by date, machine or program mode. No sample series. |
| `get_workout` | One ride in full: work, power, cadence, resistance, both heart-rate averages, and what the console was holding constant. |
| `get_samples` | The 10-second interval series as CSV, over a window and a stride you choose. |
| `summarize_history` | Volume by week or month, plus the power curve over the matched rides. Same date, machine and mode filters as `list_workouts`. |
| `compare_workouts` | Two to eight rides side by side on every derived number. |
| `export_workout` | Writes a lossless JSON export document and returns the path. |
| `refresh_history` | Re-downloads from the API. Needs credentials. |

Tools answer from one cached history rather than fetching per call — the API returns
every ride on the account in a single response, so anything else would re-download
your entire history a dozen times a conversation.

**Two heart-rate averages, always.** The platform's own figure is not derived from the
sample series and does not always agree with it: the console averages in real time,
ahead of the dropouts the series preserves. On a glitching strap the reported figure
is the *better* one — on one ride with independent Apple Watch ground truth, the
console's 153 bpm was exactly right and the filtered series gave 151. Reporting only
ours would be quietly misleading, so both go out, labelled.

## Privacy

This is your heart rate at ten-second resolution, and handing it to a language model
is a real decision rather than a formality. What the server does about that:

- **The HTTP transport refuses to start without `MATRIX_MCP_TOKEN`**, and binds
  `127.0.0.1` unless you deliberately change it. Over stdio nothing is listening at
  all, which is the mode to prefer.
- **Credentials are used for one sign-in request.** The passcode is never stored,
  logged or returned; the bearer token is never persisted. Errors from the API client
  are redacted before they can carry a token into a message.
- **Cached and exported files are written `0600`**, outside any repository.
- **`export_workout` returns a path, never the contents** — partly for your context
  budget, mostly because a document is a thing you keep rather than a thing you paste.
- Nothing is sent anywhere but `apollo.jfit.co`, the API the data came from.

Running with no credentials at all, over a cache you downloaded yourself, is the
tightest configuration and everything except `refresh_history` still works.

## Development

```bash
npm test         # vitest, against real ride fixtures — no network
npm run typecheck
npm run build
npm run dev      # tsx src/cli.ts
```

Tests use three real captured rides and a stubbed downloader, so the suite needs
neither credentials nor a network. `src/docs.test.ts` fails the build if a tool or an
environment variable is missing from the tables above — see [AGENTS.md](AGENTS.md).

Cutting a release:

```bash
npm run release -- patch     # bumps, tags, packs; refuses without a CHANGELOG entry
git push origin main:main --follow-tags
npm publish --access public
```

## Part of matrix-workouts

| | |
|---|---|
| [matrix-workouts-core](https://github.com/bestimmaa/matrix-workouts-core) | the parser, API client and export format this is built on |
| [matrix-workouts-chrome](https://github.com/bestimmaa/matrix-workouts-chrome) | a Chrome extension that puts the same data on screen |
| [matrix-workouts-mcp](https://github.com/bestimmaa/matrix-workouts-mcp) | this server |

MIT licensed. Unaffiliated with Matrix Fitness or Johnson Health Tech.
