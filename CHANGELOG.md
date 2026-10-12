# Changelog

## Unreleased

- **Open dialogs count as waiting on you.** A session showing a permission prompt, a question (AskUserQuestion) or a plan to approve
  (ExitPlanMode) is marked waiting in its record at once: `/sessions` lists it first with what it asks (`permission: Bash`), and the
  band's counter counts it, even when the session is bound to no package. The record keeps the dialog's kind and the tool's name,
  never its input. There is no event for the answer itself: an allowed call reads as waiting until it ends.
- **Notifications from other sessions.** A toast when another open session starts waiting on you (a dialog opens there, or its
  package's decision moves to you); silent for what was already waiting when this session started looking. Other sessions are read
  every 30 s, so a prompt answered sooner may pass without one.
- Session records gain an optional `decision` field; records from 0.3.x read as before.
- README: a "Using it" section — a list with tracking asked for, approval as a step, the `CLAUDE.md` line that makes it
  automatic, several sessions, tips.
- `/progress init` (`/ilerleme kur`) adds the line that makes tracking automatic ("Track multi-step work (3+ steps) with
  session-progress.", in the language in use) to an existing `CLAUDE.md` or `.claude/CLAUDE.md`: appended, once, never when the
  file already mentions session-progress, also when the packages folder was there already. It never creates a `CLAUDE.md`; without
  one it prints the line as a tip.

## 0.3.2 — 2026-10-10

- Listing links (homepage, repository, support, documentation) and a privacy statement (`PRIVACY.md`).

## 0.3.1 — 2026-10-10

- Directory listing: an icon, and a README section on what the plugin reads and writes and what its hooks do.
- The README that `/progress init` writes no longer carries a link.

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
