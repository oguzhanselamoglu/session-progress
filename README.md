# session-progress

**English** · [Türkçe](README.tr.md)

A Claude Code plugin that shows how your work is going, **per session**:

<p align="center">
  <img src="docs/images/overview.svg" alt="A Claude Code window: the band above the prompt shows this session's package waiting on you; the Sessions panel on the right lists four open sessions as cards, the two waiting on you first." width="100%">
</p>

- **Band above the prompt:** the work package this session is on. It shows a bar, the current phase, and who the work is waiting on.
  When a decision is waiting on you it turns amber.
- **`/sessions` panel:** every open Claude Code session as a card, sessions waiting on you first. Each card shows the package, progress,
  a phase strip (✓ ● ⏸ ○), what it waits on or the current and next phase, and the session's name and checkout. Packages no open session
  is working on are listed under it.
- **`/progress` panel:** the session's package in full. It lists phases with owner, duration, notes, metrics and references, then review
  rounds, other active packages and completed ones.
- **Notifications:** a toast when a phase of your package finishes or a decision moves to you.

It is built for running several sessions at once (worktrees, parallel features, agents) and seeing at a glance which one needs you.

<p align="center">
  <img src="docs/images/progress-panel.svg" alt="The /progress panel: a package with its bar, the decision waiting on you, every phase with owner and duration, review rounds, other active packages and completed ones." width="620">
</p>

### A typical flow

1. You ask for a multi-step change. Claude writes `.progress/<package>/progress.json` with its plan as phases; the band appears
   above the prompt for that session.
2. Claude moves through the phases and updates the file; the bar and the current phase follow.
3. When Claude needs your decision it marks the phase `waiting-user`: the band turns amber, a toast says what is waiting, and the
   session moves to the top of `/sessions` in every other session too.
4. With several sessions open (one per worktree, say), `/sessions` shows which one is working, which one waits on you, and which is
   done.

All names in these pictures are invented examples.

## Install

```
/plugin install session-progress --marketplace oguzhanselamoglu/session-progress
```

Type it in a terminal session; answer `y` to add the marketplace and pick the user scope. With the user scope it also loads in the
desktop app's Code tab. Claude Code 2.1.287 or later.

**Where it runs:** Claude Code (terminal and the desktop app's Code tab); the band and panels are Claude Code interface. Tested on macOS;
Linux should work the same, Windows paths are handled but not yet tried on Windows — reports are welcome.

## Quick start

1. In your repository: `/progress init` — creates `.progress/` (commit it with the project).
2. Ask Claude for something with a few steps and say *"plan this and track it with session-progress"*. Claude writes the package file;
   the band appears above the prompt.
3. Open `/sessions` in any session to see every open session, the ones waiting on you first.

## How it works

Each package is one JSON file: `<packagesDir>/<package>/progress.json`. The agent writes it as the work moves through its phases. The
plugin ships a skill that tells Claude when and how to write it, so in most projects nothing else is needed.

A session **binds** to a package when its own tool call writes that package's `progress.json`. It binds through Write/Edit, or through
a Bash command that names the path and changes the file. Reading a file never binds. A completed package is not bound automatically.
You can also bind by hand with `/progress bind <package>`.

Every session keeps a small record under `<main repo>/.git/session-progress/sessions/`. The `.git` folder is shared by all worktrees and
never tracked. The sessions panel is built from these records. A record is refreshed at session start, at each turn start and end, and
every 30 s. A session silent for 3 minutes, or one that ended, counts as closed. Records are only written in repositories that have a
packages folder, so other projects stay untouched.

### `progress.json`

```json
{
  "schema": "session-progress-v1",
  "package": "login-flow",
  "title": "Login flow with SMS code",
  "updatedAt": "2026-10-10T09:41:00Z",
  "phases": [
    { "id": "plan", "title": "Plan", "status": "done", "startedAt": "2026-10-10T08:00:00Z", "finishedAt": "2026-10-10T08:20:00Z" },
    { "id": "approve", "title": "Plan approval", "status": "waiting-user", "owner": "user" },
    { "id": "build", "title": "Build", "status": "pending", "owner": "claude" }
  ],
  "waitingOn": { "who": "user", "what": "Approve the plan" }
}
```

- **Statuses:** `pending`, `active`, `waiting-user`, `waiting-external`, `blocked`, `done`, `skipped`.
- **Owners:** `owner` and `waitingOn.who` are free labels. `user` means you and is highlighted.
- **Optional per phase:** `startedAt`, `finishedAt`, `note`, `refs`, `metrics`.
- **Optional per package:** `branch`, `worktree`, and `audits` (review rounds: `round`, `by`, `verdict`, `findings`, `closedBy`, `at`).

The full rules are in [`skills/session-progress/SKILL.md`](skills/session-progress/SKILL.md).

## Configure

**Per project:** add `.claude/session-progress.json` at the repository root and commit it. Every field is optional.

```json
{
  "packagesDir": "docs/work-packages",
  "ownerLabels": { "qa": "QA team", "claude": "Claude" }
}
```

| Field | Default | Meaning |
|---|---|---|
| `packagesDir` | `.progress` | Folder holding one sub-folder per package, relative to the root. |
| `ownerLabels` | none | Display names for owner labels. `user` is always shown as YOU. |
| `schemaAliases` | none | Other `schema` names to read as `session-progress-v1` (files from before a rename). |

## Language

English is the default. Each person can switch, and the choice is kept for all their later sessions:

```
/progress language tr     # to Türkçe
/ilerleme dil en          # back to English
```

The band, both panels and the command names switch at once in the current session.

| Language | Commands | Sub-commands |
|---|---|---|
| English | `/progress`, `/sessions` | `init` · `refresh` · `bind <package>` · `unbind` · `name <name>` · `language en\|tr` |
| Türkçe | `/ilerleme`, `/oturumlar` | `kur` · `yenile` · `bağla <paket>` · `çöz` · `ad <ad>` · `dil en\|tr` |

Sub-commands are understood in both languages, so typing the other language's word still works. What Claude writes into
`progress.json` (titles, notes) follows the language you talk to it in.

**Adding a language:** every text is in [`hooks/i18n.ts`](hooks/i18n.ts), one typed dictionary per language. Copy `en`, translate it,
choose the command names, and add the code to `LANGS`. The type checker reports any text you missed. Pull requests are welcome.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .            # run a session with the working copy
```

The pure core has no access to the engine and is unit-tested directly:

- `hooks/model.ts`: schema, progress, durations, notifications.
- `hooks/sessions.ts`: session records, binding, ordering.
- `hooks/i18n.ts`: every text, in both languages.

The hooks live in `hooks/register.tsx`. The README pictures are drawn from invented data by
`python3 scripts/make-readme-images.py`; run it again after a visible change.

## License

MIT
