---
name: session-progress
description: Keep a work package's progress.json current so the session-progress band and panels show it. Use when starting, advancing, pausing for the user, or finishing multi-step work (a feature, a migration, a review cycle) in a repository that has a session-progress packages folder (default .progress) or a .claude/session-progress.json file, after the user ran /progress init, or whenever the user asks to track or show the progress of work with session-progress.
---

# Tracking work with session-progress

The session-progress plugin shows the progress of **work packages** above the prompt (only the package this session works on), in a
progress panel, and in a sessions panel listing every open session. It reads one file per package; this skill is how you write it.

## The project's own rules come first

If the project documents its own conventions for these files (its `CLAUDE.md`, a README in the packages folder, an
agent guide): who writes them, the `schema` value, owner names, when to update — follow those. This skill fills in only what the
project leaves unsaid.

## Where the file lives

1. Read `.claude/session-progress.json` at the repository root if it exists. Its `packagesDir` names the packages folder
   (relative to the root). Without the file or the field, the folder is `.progress`.
2. One folder per package: `<packagesDir>/<package>/progress.json`. `<package>` is a short kebab-case name
   (`login-flow`, `billing-v2-migration`) using only letters, digits, `.`, `_` and `-`.
3. Never put the packages folder under `.claude/`: Claude Code protects that path and every write would ask for permission.
4. If the packages folder does not exist yet and the user asked you to track the work, just write the file: the folders are created
   with it (the user can also run `/progress init`, which creates the folder with a short README).

Writing the file with your own Write/Edit tool (or a Bash command that names the path) **binds this session to that package**: the
band then shows it. Do not write another session's package file; one package has one writer.

## When to write it

- **Start:** when multi-step work begins, create the file with every phase you plan, all `pending`, the first one `active`.
- **Every transition:** a phase starts (`active`, set `startedAt`), finishes (`done`, set `finishedAt`), is skipped, blocks, or
  waits. Update `updatedAt` on every write.
- **Waiting on the user:** when you need a decision or approval, set that phase to `waiting-user` (or set `waitingOn` with
  `"who": "user"`). The band turns amber and the sessions panel lists the session first. Set it back when the user answers.
- **Finish:** mark the last phase `done`. A completed package is never auto-bound again, so a new piece of work gets a new package.

Take times from the clock (`date -u +%Y-%m-%dT%H:%M:%SZ`), never estimate them.

Write `title`, phase titles, `note` and `waitingOn.what` in the language the user speaks with you (Turkish in a Turkish
conversation, and so on): the person reads them in the band and the panels. Keep `id`s, `package` and `status` values as they are
(ASCII, the schema's words).

## Schema (`session-progress-v1`)

```json
{
  "schema": "session-progress-v1",
  "package": "login-flow",
  "title": "Login flow with SMS code",
  "branch": "feature/login-flow",
  "updatedAt": "2026-10-10T09:41:00Z",
  "phases": [
    { "id": "plan", "title": "Plan", "status": "done", "owner": "claude",
      "startedAt": "2026-10-10T08:00:00Z", "finishedAt": "2026-10-10T08:20:00Z" },
    { "id": "approve", "title": "Plan approval", "status": "waiting-user", "owner": "user" },
    { "id": "build", "title": "Build", "status": "pending", "owner": "claude" },
    { "id": "review", "title": "Review", "status": "pending", "owner": "reviewer" }
  ],
  "waitingOn": { "who": "user", "what": "Approve the plan" },
  "audits": [
    { "round": 1, "by": "reviewer", "verdict": "PASS", "findings": "2 minor", "at": "2026-10-10T09:30:00Z" }
  ]
}
```

| Field | Rule |
|---|---|
| `schema` | `"session-progress-v1"`. |
| `package` | Same as the folder name. |
| `title`, `updatedAt` | Required; `updatedAt` is an ISO date. |
| `phases` | At least one; unique `id`; `title`; `status` one of `pending`, `active`, `waiting-user`, `waiting-external`, `blocked`, `done`, `skipped`. |
| `owner`, `waitingOn.who` | Any non-empty label. `user` means the person at the keyboard and is highlighted. The project may give labels display names in `ownerLabels`. |
| optional per phase | `startedAt`, `finishedAt` (ISO), `note` (text), `refs` (list of texts: commits, files, links), `metrics` (`{name: text or number}`). |
| `audits` | Review rounds: `round` (number), `by`, `verdict` (words like PASS / CLEAN / FAIL / WARN colour it), optional `findings`, `closedBy` (list), `at`. |
| `branch`, `worktree` | Optional, shown in the panel. |

A file that does not match is shown as an error with the path of the first problem. Fix it rather than leaving it.

## Commands the user has

- `/progress init` creates the packages folder in a repository that never used the plugin.
- `/progress` opens the progress panel. `/progress refresh` re-scans. `/progress bind <package>` binds by hand.
  `/progress unbind` removes the binding. `/progress name <name>` names the session in the sessions panel.
- `/sessions` opens the panel of all open sessions.
- `/progress language tr` switches the band, panels and commands to Turkish (`/ilerleme dil en` back to English); the choice is
  kept for all later sessions. English is the default.

In Turkish the commands are `/ilerleme` (`kur`, `yenile`, `bağla`, `çöz`, `ad`, `dil`) and `/oturumlar`.
