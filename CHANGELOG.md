# Changelog

All notable changes to this project will be documented in this file.

The version history source of truth is git tags in the format `vMAJOR.MINOR.PATCH`.

## [Unreleased]

### Fixed

- `summarize_history` accepted `mode` and `machineType` in name only: the schema
  stripped them before the handler ran, so a mode-filtered request came back as
  whole-history totals formatted exactly like filtered ones, and the power curve
  mixed every program together. Both filtering tools now spread one `rideFilter`
  shape, checked against `HistoryFilter` at compile time, and parse their arguments
  instead of casting them.
- A server running credential-free kept serving the history it read at startup after
  `matrix-workouts-history` rewrote the cache file; it now re-reads the file once its
  modification time moves past the snapshot in memory.
- One refresh that failed synchronously — the cache directory could not be created,
  say — left its rejected promise in place, so every later `refresh_history` and
  stale-cache refetch failed the same way until the process restarted.
- Every tool asked the store for the history a second time to write its footer. On a
  stale-cache fallback that retried the failing download once more per call, and the
  footer could describe a different history from the rows above it.
- The server introduced itself to MCP clients as version 0.1.0 whatever was
  installed; it now reads the version from package.json.
- Durations that were not a whole number of seconds could print as `1:60`.
- `get_samples` cut a window too long for `maxRows` short instead of covering it, so
  a default call on a 47-minute ride returned its first 33 minutes as a well-formed
  CSV with only a trailing note to say so. It now raises the stride to the smallest
  that fits and says it did; a part of a ride is what `fromSeconds`/`toSeconds` are for.
- `list_workouts` and `summarize_history` took any string for `from` and `to` and
  compared it against each ride's date as a prefix, so `to: "2026-09"` excluded the
  whole of the September it named and a `from` given as a datetime excluded its own
  day, each with a count that looked right. Both now require `YYYY-MM-DD` and refuse
  anything else by name.

### Changed

- **Unknown tool arguments are now an error.** An argument a tool does not take used
  to be stripped by the SDK before the handler ran, so `summarize_history` with
  `groupBy` for `bucket` answered with whole-history monthly totals shaped exactly
  like a correct call. Each tool is now registered with a strict schema, and the
  call fails with `Unknown argument 'groupBy'; summarize_history takes: from, to,
  machineType, mode, bucket, windowsSeconds.` A caller that relied on extra keys
  being ignored will now get that error instead.
- `@modelcontextprotocol/sdk` floor raised from `^1.13.0` to `^1.22.0`, the first
  release whose `registerTool` keeps an assembled schema as given; earlier ones wrap
  it in `z.object()` again, which breaks every call.
- Every tool description names its own arguments, so a model reading the tool
  listing knows `get_workout` takes `id` before its first call rather than after a
  rejected guess. Clients do not all surface the schema before a call; the
  description is the part every client shows.
- `get_workout` reports heart rate's minimum and maximum next to its mean, each both
  as the console reported it and as the filtered series gives it, plus the count of
  valid samples beside the dropouts; and peak cadence and resistance next to their
  averages. `compare_workouts` gains the same peaks. Both sets of figures were already
  computed — the record carries its own min and max, `heartRateStats` returns the
  series' — and were dropped on the way to the caller.
- `get_samples` accepts `resolutionSeconds` as an alternative to `everyNth`: 60 is
  one row per minute, without the caller having to know the sample interval. It must
  be a multiple of 10, the sample interval, rather than being rounded to one.
- `get_workout` renders the control signature's metrics alongside its verdict, and
  names the controlled channel when the program mode already states it. The
  classifier returns "unclassified" for closed-loop heart-rate rides by design,
  exposing its raw numbers so a caller can decide; printing the verdict alone threw
  that evidence away and left the row carrying nothing.
- `matrix-workouts-core` moves from `^0.1.0` to `^0.4.0`. Below 1.0 a caret range
  stops at the minor version, so `^0.1.0` never let npm install 0.2 or later. 0.2–0.4
  only added exports; nothing this server uses was removed or renamed.

## [0.1.0] - 2026-09-14

### Added

- First release. Seven tools over one account's Matrix / Johnson Fitness ride history:
  `list_workouts`, `get_workout`, `get_samples`, `summarize_history`,
  `compare_workouts`, `export_workout` and `refresh_history`.
- Cross-ride analysis the platform has never offered: a power curve over best
  sustained efforts, and training volume bucketed by week or month.
- A history store that downloads once per TTL, caches to disk, and falls back to a
  labelled stale cache rather than to nothing when the network fails.
- Credential-free operation: point `MATRIX_CACHE_DIR` at a history downloaded by
  `npx matrix-workouts-history` and every tool except `refresh_history` works with no
  passcode anywhere in the configuration.
- stdio and HTTP transports. HTTP refuses to start without `MATRIX_MCP_TOKEN` and
  binds `127.0.0.1` by default.
