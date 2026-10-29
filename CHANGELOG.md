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

### Changed

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
