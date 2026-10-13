# Changelog

## 0.5.0 — 2026-10-13

**Sessions in other projects**, off by default. `/sessions all` (`/oturumlar tümü`) turns them on for all your sessions, `/sessions this`
(`/oturumlar bu`) turns them off; the choice is kept in the plugin's store and open sessions pick it up within 30 seconds.

- `/sessions` lists, below this project's sessions, each other project with open sessions and each session as the same card as here:
  status, the dialog waiting on you, the bound package with its bar, phases, now and next, subagents, branch. Projects with something
  waiting on you come first, and a line at the top says so. The panel's last line tells whether other projects are on and how to switch.
- A toast names the project and the session when one there starts waiting on you (`⏸ shop › API work: waiting on you — a question`); the
  band's counter counts them, and the sessions panel opens by itself as for this project. What already waited when a project is first
  seen is not announced.
- While it is on, each project with an open session writes one small file to `~/.claude/session-progress/projects/` (or under
  `$CLAUDE_CONFIG_DIR`): its path, packages folder, accepted schema names and last-seen time. Other sessions read it, then that project's
  records and the package files its open sessions are bound to, every 5 s (a file whose time did not move is not read again). Stale
  project files are skipped unread. Off, nothing is written or read outside the project.
- README (en/tr) and PRIVACY: how to turn it on and off, and what it reads and writes.

## 0.4.1 — 2026-10-12

- **A permission prompt is seen through Claude Code's own notice of it** (`classic.Notification`, `permission_prompt`), no longer through
  a hook on the permission check: the plugin hooks no permission check at all, so nothing of it can stand in a permission decision. The
  tool's name is taken from the notice; a notice naming none shows "a permission" and is closed by the next call to end.
- README: which written file is followed as instructions (only `CLAUDE.md`, only on your yes) and who reads the session records.

## 0.4.0 — 2026-10-12

Sessions that wait on you are seen sooner and more often, other sessions are richer to look at, and package files stay valid.

### What waits on you

- **Open dialogs count as waiting.** A session showing a permission prompt, a question (AskUserQuestion) or a plan to approve
  (ExitPlanMode) is marked waiting in its record at once: `/sessions` lists it first with what it asks (`permission: Bash`) and
  the band's counter counts it, even when the session is bound to no package. There is no event for the answer itself, so an
  allowed call reads as waiting until it ends.
- **Notifications from other sessions.** A toast when another open session starts waiting on you (a dialog opens there, or its
  package's decision moves to you); silent for what was already waiting when this session started looking.
- **Within 5 s.** Session records are read every 5 s (a record whose file did not change is not read again; an idle pass is one
  folder listing), so a dialog or a status change in one session reaches the others within seconds instead of 30 s.
- **The sessions panel opens by itself** when another session starts waiting on you; once you close it, it stays closed in that
  session. `/progress` and `/sessions` with no argument now toggle their panel (`/progress refresh` always opens).

### What other sessions show

- **Subagents.** Tracked from the Agent call to its end (the call's result, or SubagentStop for one sent to the background): the
  band and the session's card show how many run, finished or failed and the running ones' task labels. A session whose subagent runs
  in the background counts as working.
- **Branch and worktree.** Each card shows the session's branch, read from git's own `HEAD` (no git process), marked when the
  checkout is a worktree; a `git checkout` is seen at the next turn end. The progress panel shows it when the package names none.

### Writing packages

- **Schema feedback at write time.** When Claude writes a `progress.json` (Write, Edit, or a Bash command that changes it) that does
  not match the schema, the plugin adds one line to Claude's context naming the file and the first problem, so the writer fixes it
  in the same turn instead of the package showing as an error. A file only read gets no note.
- **Skill: keep the band honest.** Unplanned work (a fix round, a long verification) gets its own phase instead of a note;
  `waiting-user` only while the person must act, then `waiting-external` naming who it waits on (a step mixing both is split in
  two); `done` only once the work has really happened.
- **`/progress init` offers the `CLAUDE.md` line** that makes tracking automatic ("Track multi-step work (3+ steps) with
  session-progress.", in the language in use) for an existing `CLAUDE.md` or `.claude/CLAUDE.md`: it shows the line word for word
  in a question and appends it only when you say yes — once, never offered when the file already mentions session-progress. It
  never creates a `CLAUDE.md`; declined, dismissed or without one, it prints the line as a tip.
- **README: "Using it"** — a list with tracking asked for, approval as a step, the `CLAUDE.md` line, several sessions, tips.

### What the plugin now does that 0.3.x did not

- Hooks every tool call (`tool.call`) to see dialogs and subagents, plus `classic.PermissionRequest`, `classic.SubagentStop` and
  `classic.PostToolUse`. None of them answers a prompt or changes, delays or blocks a call; SubagentStop's and PostToolUse's
  results pass on untouched, except the one schema line PostToolUse adds for a package file Claude just wrote.
- Reads the checkout's git `HEAD`.
- Writes more into its own session record: the open dialog's kind and the tool's name (never its input), the branch, whether the
  checkout is a worktree, and the subagents' short task labels and states (never their prompts). New fields are optional: records
  from 0.3.x read as before, and 0.3.x reads the new ones.
- Asks one question in the engine's own dialog (`/progress init`, before touching `CLAUDE.md`), and may open the sessions panel
  unasked (see above).

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
