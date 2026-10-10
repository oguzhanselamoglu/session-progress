# Changelog

## 0.2.1 — 2026-10-10

- The skill defers to a project's own documented conventions for `progress.json` (writer, schema value, owner names).

## 0.2.0 — 2026-10-10

First public release.

- Packages folder and owner labels come from the project's `.claude/session-progress.json`; without it, `.claude/progress`.
- English by default; `/progress language tr` (`/ilerleme dil en`) switches the band, panels and command names at once and keeps
  the choice for later sessions. Commands: `/progress`, `/sessions` (Turkish: `/ilerleme`, `/oturumlar`); sub-commands are understood
  in both languages. The skill tells Claude to write titles and notes in the user's language.
- `owner` and `waitingOn.who` are free labels; only `user` is special.
- Schema `session-progress-v1`; a project can accept older schema names with `schemaAliases`.
- A skill teaches the model how and when to write `progress.json`.
- Sessions panel as cards: status, package, bar, phase strip, what it waits on or the current and next phase, session name.
- Tagged messages (`<agent-message …>`) no longer become session names.
- A broken project config file stays reported until it is fixed.
