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

### Changed

- `get_workout` renders the control signature's metrics alongside its verdict, and
  names the controlled channel when the program mode already states it. The
  classifier returns "unclassified" for closed-loop heart-rate rides by design,
  exposing its raw numbers so a caller can decide; printing the verdict alone threw
  that evidence away and left the row carrying nothing.

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
