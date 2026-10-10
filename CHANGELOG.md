# Changelog

## 0.3.0 — 2026-10-10

- **Default packages folder is now `.progress`** (was `.claude/progress`): Claude Code treats `.claude/` as a protected path, so
  writing a package file there asked for permission every time. Projects with their own `packagesDir` are unaffected; to keep an
  existing `.claude/progress`, set `"packagesDir": ".claude/progress"` in `.claude/session-progress.json`.
- `/progress init` (`/ilerleme kur`): creates the packages folder with a short README in a repository that never used the plugin.
- In such a repository both panels say how to start instead of staying empty; the band stays silent (other projects are untouched).
- The packages folder in any checkout turns the plugin on, so `/progress init` on a branch works before the branch is merged.
- Windows-style paths (`C:\…`) in tool calls, commands and git files are normalised (unit-tested; not yet tried on Windows).
- The skill also starts when the user asks to track work in a repository without the folder (writing the file creates it).

## 0.2.1 — 2026-10-10

- The skill defers to a project's own documented conventions for `progress.json` (writer, schema value, owner names).

## 0.2.0 — 2026-10-10

First public release.

- Packages folder and owner labels come from the project's `.claude/session-progress.json`; without it, `.claude/progress` (0.3.0: `.progress`).
- English by default; `/progress language tr` (`/ilerleme dil en`) switches the band, panels and command names at once and keeps
  the choice for later sessions. Commands: `/progress`, `/sessions` (Turkish: `/ilerleme`, `/oturumlar`); sub-commands are understood
  in both languages. The skill tells Claude to write titles and notes in the user's language.
- `owner` and `waitingOn.who` are free labels; only `user` is special.
- Schema `session-progress-v1`; a project can accept older schema names with `schemaAliases`.
- A skill teaches the model how and when to write `progress.json`.
- Sessions panel as cards: status, package, bar, phase strip, what it waits on or the current and next phase, session name.
- Tagged messages (`<agent-message …>`) no longer become session names.
- A broken project config file stays reported until it is fixed.
