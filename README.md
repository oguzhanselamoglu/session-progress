# session-progress

A Claude Code plugin that shows how your work is going, **per session**:

- **Band above the prompt:** the work package this session is on. It shows a bar, the current phase, and who the work is waiting on.
  When a decision is waiting on you it turns amber.
- **`/sessions` panel:** every open Claude Code session as a card, sessions waiting on you first. Each card shows the package, progress,
  a phase strip (✓ ● ⏸ ○), what it waits on or the current and next phase, and the session's name and checkout. Packages no open session
  is working on are listed under it.
- **`/progress` panel:** the session's package in full. It lists phases with owner, duration, notes, metrics and references, then review
  rounds, other active packages and completed ones.
- **Notifications:** a toast when a phase of your package finishes or a decision moves to you.

It is built for running several sessions at once (worktrees, parallel features, agents) and seeing at a glance which one needs you.

## Install

```
/plugin install session-progress --marketplace oguzhanselamoglu/session-progress
```

Type it in a terminal session; answer `y` to add the marketplace and pick the user scope. With the user scope it also loads in the
desktop app's Code tab. Claude Code 2.1.287 or later.

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
| `packagesDir` | `.claude/progress` | Folder holding one sub-folder per package, relative to the root. |
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
| English | `/progress`, `/sessions` | `refresh` · `bind <package>` · `unbind` · `name <name>` · `language en\|tr` |
| Türkçe | `/ilerleme`, `/oturumlar` | `yenile` · `bağla <paket>` · `çöz` · `ad <ad>` · `dil en\|tr` |

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

The hooks live in `hooks/register.tsx`.

## Türkçe

İş paketlerinin ilerlemesini oturum bazında gösteren bir Claude Code eklentisi:

- **Prompt üstü şerit:** bu oturumun paketi.
- **`/oturumlar` paneli:** tüm açık oturumlar ayrı kartlarda, sende bekleyenler önce.
- **`/ilerleme` paneli:** paketin ayrıntısı.

Varsayılan dil İngilizcedir. Türkçeye geçmek için `/progress language tr` yazman yeterli; seçimin sonraki tüm oturumlarında
geçerli olur. Komutlar `/ilerleme` ve `/oturumlar` olur; İngilizceye dönmek için `/ilerleme dil en`.
Claude'un `progress.json`'a yazdığı başlıklar ve notlar da onunla konuştuğun dilde olur.

## License

MIT
