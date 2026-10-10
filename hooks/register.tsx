import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PackageRead, ProgressDoc, ProjectConfig, SessionRecord, Snapshot } from '../types'
import { DICTS, LANGS, SUB_ALIASES, resolveLang, type Dict, type Lang } from './i18n'
import {
  STATUS_VIEW,
  auditLine,
  bar,
  currentPhase,
  focusOf,
  isComplete,
  isStale,
  mainRootFromGitFile,
  organize,
  ownerLabel,
  packageElapsed,
  parseDoc,
  phaseDuration,
  progressOf,
  signature,
  transitions,
  verdictTone,
  waitingWho,
  waitingWhat,
  worktreeRootFromGitdir,
} from './model'
import {
  DEFAULT_PACKAGES_DIR,
  OPEN_MS,
  autoBind,
  boundRead,
  candidatePackages,
  changedPackage,
  docsByPackage,
  labelOf,
  mentionsProgress,
  newSession,
  normPath,
  organizeSessions,
  othersWaitingOnUser,
  packageFromPath,
  packageKey,
  parseSession,
  segmentOf,
  sessionsDir,
  snippetOf,
} from './sessions'

const PANE = 'session-progress'
const SESSIONS_PANE = 'session-progress-sessions'
/** Per-project settings file, relative to the checkout root. */
const CONFIG_FILE = '.claude/session-progress.json'
const QUICK_MS = 30_000
const FULL_MS = 5 * 60_000
/** Write tools that carry the target path directly. */
const PATH_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'NotebookEdit'])
/** A session name (`/progress name`) is at most this long. */
const LABEL_MAX = 40
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const snapshot = atom({ plugin: 'session-progress', key: 'snapshot' } as const, null)
const seen = atom({ plugin: 'session-progress', key: 'seen' } as const, {})
const self = atom({ plugin: 'session-progress', key: 'self' } as const, null)
const language = atom({ plugin: 'session-progress', key: 'language' } as const, 'en')
/** `$.store` key of the person's language choice (kept across sessions). */
const LANGUAGE_KEY = 'language'

type Env = EngineInterface

// ── Settings: the person's language (`$.store`) + the project's `.claude/session-progress.json` ───────────────────────────
/** The language in use: English unless the person switched (`/progress language tr`); loaded at session start. */
let lang: Lang = 'en'
let packagesDir = DEFAULT_PACKAGES_DIR
let segment = segmentOf(DEFAULT_PACKAGES_DIR)
let ownerLabels: Record<string, string> = {}
let schemaAliases: string[] = []
const t = (): Dict => DICTS[lang]

const pad2 = (n: number): string => String(n).padStart(2, '0')
const shortDate = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return lang === 'tr' ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${time}` : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`
}
const ago = (iso: string, now: number): string => {
  const min = Math.floor((now - Date.parse(iso)) / 60000)
  if (!Number.isFinite(min)) return ''
  const a = t().ago
  if (min < 1) return a.now
  if (min < 60) return a.m(min)
  if (min < 1440) return a.h(Math.floor(min / 60))
  return a.d(Math.floor(min / 1440))
}
const baseName = (path: string): string => normPath(path).replace(/\/+$/, '').split('/').pop() ?? path
/** Absolute path, POSIX (`/x`) or Windows (`C:/x` once normalised). */
const isAbsolute = (path: string): boolean => /^([A-Za-z]:)?\//.test(normPath(path))
const owner = (who: string): string => ownerLabel(who, t(), ownerLabels)

/** Known `progress.json` paths (root → path); renewed by a full scan, only these are read by a quick refresh. */
let known: { root: string; path: string }[] = []
let cwdRoot: string | null = null
/** Main repository root — session records live under `<main>/.git/session-progress/sessions/`. */
let mainRoot: string | null = null
/** Scanned checkout roots (main + worktrees) — to build candidate paths when binding from Bash. */
let roots: string[] = []
/** `.git/worktrees` entries at the last discovery (sorted names joined by `|`) — roots are discovered again only when this changes. */
let worktreeSig = ''
/**
 * Whether session records are written: only in repositories whose main checkout has the packages folder and whose `.git` is a
 * folder (the plugin is loaded globally — other projects' `.git` is never written; submodule / `--separate-git-dir` repos stay quiet).
 */
let registryOn = false
/** Whether any checkout (main or a worktree) has the packages folder — `null` outside a git repository. */
let folderExists: boolean | null = null
/** Refreshes run ONE at a time: timers, turn end and commands arriving together never read the same old `seen` twice. */
let queue: Promise<void> = Promise.resolve()
/** Writes to this session's own record run ONE at a time: turn start, a tool call and the heartbeat never lose the last write. */
let selfQueue: Promise<void> = Promise.resolve()
/** Whether the first notification pass of this module load ran: a package appearing later counts as "born in this session". */
let baselineDone = false
/** Told once when the record file could not be written. */
let writeWarned = false
/** The last full scan's error (discovery or project config), carried by quick refreshes. */
let lastScanError: string | null = null

async function findCheckoutRoot($: Env): Promise<string | null> {
  let dir = normPath(await $.session.cwd()).replace(/\/+$/, '')
  for (let i = 0; i < 12 && dir; i++) {
    if (await $.fs.exists(`${dir}/.git`)) return dir
    const up = dir.slice(0, dir.lastIndexOf('/'))
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * The project's settings: the checkout's own file, else the main checkout's. A broken file keeps the defaults and is reported (the
 * band and the panel show it); a missing one is just the defaults.
 */
async function loadConfig($: Env, main: string): Promise<string | null> {
  packagesDir = DEFAULT_PACKAGES_DIR
  segment = segmentOf(DEFAULT_PACKAGES_DIR)
  ownerLabels = {}
  schemaAliases = []
  for (const root of cwdRoot && cwdRoot !== main ? [cwdRoot, main] : [main]) {
    const path = `${root}/${CONFIG_FILE}`
    if (!(await $.fs.exists(path))) continue
    let cfg: ProjectConfig
    try {
      const text = await $.fs.read(path)
      cfg = JSON.parse(typeof text === 'string' ? text : '') as ProjectConfig
    } catch (e) {
      return `${CONFIG_FILE}: ${(e as Error).message}`
    }
    if (typeof cfg !== 'object' || cfg === null) return `${CONFIG_FILE}: not an object`
    const dir = typeof cfg.packagesDir === 'string' ? cfg.packagesDir.trim().replace(/^\.\/+/, '').replace(/\/+$/, '') : ''
    if (dir && !dir.startsWith('/') && !dir.split('/').includes('..')) packagesDir = dir
    if (Array.isArray(cfg.schemaAliases)) schemaAliases = cfg.schemaAliases.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (cfg.ownerLabels && typeof cfg.ownerLabels === 'object') {
      ownerLabels = Object.fromEntries(Object.entries(cfg.ownerLabels).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    }
    break
  }
  segment = segmentOf(packagesDir)
  return null
}

/** Finds the main checkout + `.git/worktrees/*` roots and the `progress.json` paths in each. */
async function scan($: Env): Promise<string | null> {
  cwdRoot = await findCheckoutRoot($)
  if (!cwdRoot) {
    folderExists = null
    return t().noRepo
  }
  const gitStat = await $.fs.stat(`${cwdRoot}/.git`)
  const gitText = gitStat.kind === 'file' ? await $.fs.read(`${cwdRoot}/.git`) : null
  const main = mainRootFromGitFile(cwdRoot, typeof gitText === 'string' ? gitText : null)
  mainRoot = main
  const configError = await loadConfig($, main)
  const found = await discoverRoots($, main)
  roots = found
  const next: { root: string; path: string }[] = []
  let anyFolder = false
  for (const root of found) {
    const dir = `${root}/${packagesDir}`
    if (!(await $.fs.exists(dir))) continue
    anyFolder = true
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'dir') continue
      const path = `${dir}/${entry.name}/progress.json`
      if (await $.fs.exists(path)) next.push({ root, path })
    }
  }
  known = next
  folderExists = anyFolder
  // Records only in a repository that uses the plugin: its packages folder in the main checkout OR any worktree (a branch that just
  // ran `/progress init` counts before it is merged).
  try {
    registryOn = anyFolder && (await $.fs.stat(`${main}/.git`)).kind === 'dir'
  } catch {
    registryOn = false
  }
  return configError
}

/** `.git/worktrees` entries of the main repository (does not scan package folders — cheap). */
async function worktreeEntries($: Env, main: string): Promise<{ name: string; kind: string }[]> {
  const wtDir = `${main}/.git/worktrees`
  return (await $.fs.exists(wtDir)) ? await $.fs.list(wtDir) : []
}

const sigOf = (entries: readonly { name: string; kind: string }[]): string =>
  entries.filter((e) => e.kind === 'dir').map((e) => e.name).sort().join('|')

async function discoverRoots($: Env, main: string): Promise<string[]> {
  const found = [main]
  const wtDir = `${main}/.git/worktrees`
  const entries = await worktreeEntries($, main)
  worktreeSig = sigOf(entries)
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    try {
      const text = await $.fs.read(`${wtDir}/${entry.name}/gitdir`)
      const root = typeof text === 'string' ? worktreeRootFromGitdir(text) : null
      if (root && root !== main && (await $.fs.exists(root))) found.push(root)
    } catch {
      // broken worktree entry — skip
    }
  }
  return found
}

/**
 * Session records (broken or unreadable ones are skipped — another session's half-written file never breaks the panel). A record whose
 * file has not been written for longer than `OPEN_MS` (+1 min of slack) counts as closed WITHOUT being read: records are never deleted,
 * they pile up, and reading them all every 30 s would be costly.
 */
async function readSessions($: Env, now: number): Promise<{ records: SessionRecord[]; closedUnread: number }> {
  if (!mainRoot || !registryOn) return { records: [], closedUnread: 0 }
  const dir = sessionsDir(mainRoot)
  if (!(await $.fs.exists(dir))) return { records: [], closedUnread: 0 }
  const out: SessionRecord[] = []
  let closedUnread = 0
  for (const entry of await $.fs.list(dir)) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > OPEN_MS + 60_000) {
      closedUnread++
      continue
    }
    try {
      const text = await $.fs.read(`${dir}/${entry.name}`)
      const rec = typeof text === 'string' ? parseSession(text) : null
      if (rec) out.push(rec)
    } catch {
      // skip
    }
  }
  return { records: out, closedUnread }
}

async function readAll($: Env, scanError: string | null): Promise<void> {
  const reads: PackageRead[] = []
  for (const { root, path } of known) {
    try {
      const text = await $.fs.read(path)
      const parsed = parseDoc(typeof text === 'string' ? text : '', t(), schemaAliases)
      reads.push('doc' in parsed ? { ok: true, path, root, doc: parsed.doc } : { ok: false, path, root, error: parsed.error })
    } catch (e) {
      reads.push({ ok: false, path, root, error: t().v.unreadable((e as Error).message) })
    }
  }
  const now = await $.clock.now()
  const { records: sessions, closedUnread } = await readSessions($, now)
  const folder = folderExists === null ? null : { dir: packagesDir, exists: folderExists }
  const snap: Snapshot = { readAt: now, cwdRoot, reads, error: scanError, sessions, closedSessions: closedUnread, folder }
  await update($, snapshot, () => snap)
  await notify($, reads)
}

/**
 * One notification per state change (a phase finished, a decision moved to the person) — ONLY for this session's bound package (each
 * session tells about its own package; the same change never shows N times in N sessions). Silent at first sight; `seen` is updated for
 * every package so a package bound later does not replay its history.
 */
async function notify($: Env, reads: readonly PackageRead[]): Promise<void> {
  const prev = await read($, seen)
  const mine = (await read($, self))?.package ?? null
  const nextSeen: Record<string, string> = { ...prev }
  const { active, completed } = organize(reads)
  for (const r of active.concat(completed)) {
    if (mine !== null && packageKey(r, segment) === mine) {
      for (const line of transitions(r.doc, prev[r.doc.package], baselineDone, t())) $.ui.toast(line, { timeoutMs: 8000 })
    }
    nextSeen[r.doc.package] = signature(r.doc)
  }
  await update($, seen, () => nextSeen)
  baselineDone = true
}

/** Queues a refresh: a new one never starts before the previous one ends (an error does not break the chain). */
function refresh($: Env, full: boolean): Promise<void> {
  queue = queue.then(() => refreshNow($, full)).catch(() => undefined)
  return queue
}

async function refreshNow($: Env, full: boolean): Promise<void> {
  try {
    // A quick refresh keeps the last scan's error (a broken config file stays reported until it is fixed and scanned again).
    if (full || known.length === 0) lastScanError = await scan($)
    await readAll($, lastScanError)
  } catch (e) {
    await update($, snapshot, (s) => ({
      readAt: Date.now(),
      cwdRoot,
      reads: s?.reads ?? [],
      error: t().scanFailed((e as Error).message),
      sessions: s?.sessions ?? [],
      closedSessions: s?.closedSessions ?? 0,
      folder: s?.folder ?? null,
    }))
  }
}

/** Changes this session's own record (in order) and writes its file; nothing is written when `patch` returns `null`. */
function writeSelf($: Env, patch: (r: SessionRecord, nowIso: string) => SessionRecord | null): Promise<void> {
  selfQueue = selfQueue.then(() => writeSelfNow($, patch)).catch(() => undefined)
  return selfQueue
}

async function writeSelfNow($: Env, patch: (r: SessionRecord, nowIso: string) => SessionRecord | null): Promise<void> {
  let cur = await read($, self)
  if (!cur) return
  const nowIso = new Date(await $.clock.now()).toISOString()
  // `/clear` or `/resume` changes the session id without restarting the process (no `session.start`): the old record stays ended and
  // a record is set up under the new id (continuing the resumed session's own record when it has one).
  const id = await currentId($)
  if (id && id !== cur.id) cur = { ...((await loadRecord($, id)) ?? newSession(id, await $.session.cwd(), nowIso, cwdRoot)), ended: false }
  const next = patch(cur, nowIso)
  if (!next) return
  await update($, self, () => next)
  if (!mainRoot || !registryOn) return
  try {
    await $.fs.write(`${sessionsDir(mainRoot)}/${next.id}.json`, `${JSON.stringify(next, null, 2)}\n`)
  } catch (e) {
    if (!writeWarned) $.ui.toast(t().recordWriteFailed((e as Error).message))
    writeWarned = true
  }
}

async function currentId($: Env): Promise<string | null> {
  try {
    return await $.session.id()
  } catch {
    return null
  }
}

/** The record on file for a session id (`null` when missing or broken). */
async function loadRecord($: Env, id: string): Promise<SessionRecord | null> {
  if (!mainRoot || !registryOn) return null
  try {
    const path = `${sessionsDir(mainRoot)}/${id}.json`
    if (!(await $.fs.exists(path))) return null
    const text = await $.fs.read(path)
    return typeof text === 'string' ? parseSession(text) : null
  } catch {
    return null
  }
}

/**
 * `session.end`: marks the ENDING session's record (`sessionId`), skipping the id-change check. During `/clear` the id may move to the
 * new one before `session.end`; checking it would write "ended" into the new conversation's record. When the ending session is not the
 * one in state only its file is updated; the next write sets up the new id's record.
 */
function markEnded($: Env, sessionId: string): Promise<void> {
  selfQueue = selfQueue
    .then(async () => {
      const nowIso = new Date(await $.clock.now()).toISOString()
      const cur = await read($, self)
      const target = cur?.id === sessionId ? cur : await loadRecord($, sessionId)
      if (!target) return
      const done = { ...target, busy: false, ended: true, lastSeen: nowIso }
      if (cur?.id === sessionId) await update($, self, () => done)
      if (mainRoot && registryOn) await $.fs.write(`${sessionsDir(mainRoot)}/${sessionId}.json`, `${JSON.stringify(done, null, 2)}\n`)
    })
    .catch(() => undefined)
  return selfQueue
}

/** This session's record at start: from state after a hot reload, from its file when the process restarted, else a new one. */
async function initSelf($: Env): Promise<void> {
  const id = await $.session.id()
  const cwd = await $.session.cwd()
  const nowIso = new Date(await $.clock.now()).toISOString()
  let rec = await read($, self)
  if (!rec || rec.id !== id) rec = (await loadRecord($, id)) ?? newSession(id, cwd, nowIso, cwdRoot)
  const base = rec
  await update($, self, () => base)
  await writeSelf($, (r, now) => ({ ...r, cwd, checkout: cwdRoot, lastSeen: now, ended: false, busy: false }))
}

/** Modification times of the given paths (missing = -1). */
async function mtimesOf($: Env, paths: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const path of paths) {
    try {
      out[path] = (await $.fs.exists(path)) ? (await $.fs.stat(path)).mtimeMs : -1
    } catch {
      out[path] = -1
    }
  }
  return out
}

/** Auto-binding: never to a completed package (writing the final state at merge time is no new work). */
async function bindIfLive($: Env, pkg: string, path: string | null): Promise<void> {
  const target = path ?? known.find((k) => packageFromPath(k.path, segment) === pkg)?.path ?? null
  if (target) {
    try {
      const text = await $.fs.read(target)
      const parsed = parseDoc(typeof text === 'string' ? text : '', t(), schemaAliases)
      if ('doc' in parsed && isComplete(parsed.doc) && (await read($, self))?.package !== pkg) {
        await refresh($, !known.some((k) => k.path === target)) // no binding, but the panel stays current
        return
      }
    } catch {
      // unreadable — no reason not to bind (the band shows the error)
    }
  }
  await writeSelf($, (r) => autoBind(r, pkg))
  await refresh($, !known.some((k) => k.path === target))
}

/** The progress command: no argument opens the panel; `refresh`, `bind <package>`, `unbind`, `name <name>`, `language en|tr` (either language). */
async function runProgress($: Env, args: string): Promise<{ text: string }> {
  const [sub = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ').trim()
  const action = SUB_ALIASES[sub.toLocaleLowerCase('tr')] ?? SUB_ALIASES[sub.toLowerCase()]
  const c = t().c
  if ((action === 'bind' || action === 'unbind' || action === 'name') && !(await read($, self))) return { text: c.noRecord }
  if (action === 'bind') {
    if (!arg) return { text: c.bindUsage }
    await refresh($, true)
    const exists = docsByPackage((await read($, snapshot))?.reads ?? [], segment).has(arg)
    await writeSelf($, (r) => ({ ...r, package: arg, bindSource: 'manual' }))
    return { text: exists ? c.bound(arg) : c.boundMissing(arg) }
  }
  if (action === 'unbind') {
    await writeSelf($, (r) => ({ ...r, package: null, bindSource: null }))
    return { text: c.unbound }
  }
  if (action === 'language') return setLanguage($, arg)
  if (action === 'init') return initFolder($)
  if (action === 'name') {
    const label = snippetOf(arg, LABEL_MAX)
    await writeSelf($, (r) => ({ ...r, label }))
    return { text: label ? c.named(label) : c.nameCleared }
  }
  await refresh($, action === 'refresh' || known.length === 0)
  const opened = await $.ui.open({ id: PANE, title: c.paneTitle })
  return { text: opened.isPlaced ? c.paneOpened : c.paneNotPlaced }
}

/** The README `/progress init` puts in the new packages folder (repository text: always English). */
const PACKAGES_README = `# Work packages

One folder per piece of multi-step work, each holding a \`progress.json\` with its phases. Claude writes them as the work moves;
the session-progress plugin for Claude Code shows them above the prompt and in its panels.
Commit this folder with the project.
`

/**
 * `/progress init`: creates the packages folder (from the project's config, default `.progress`) in THIS checkout with a short
 * README, so the plugin starts working in a repository that never used it. Nothing is overwritten.
 */
async function initFolder($: Env): Promise<{ text: string }> {
  await refresh($, true)
  const c = t().c
  if (!cwdRoot) return { text: c.initNoRepo }
  const dir = `${cwdRoot}/${packagesDir}`
  if (await $.fs.exists(dir)) return { text: c.initExists(packagesDir) }
  try {
    await $.fs.write(`${dir}/README.md`, PACKAGES_README)
  } catch (e) {
    return { text: c.initFailed((e as Error).message) }
  }
  await refresh($, true)
  // The registry is on now: write this session's record so the sessions panel lists it at once.
  await writeSelf($, (r, now) => ({ ...r, lastSeen: now }))
  return { text: c.initDone(packagesDir) }
}

/** Registers the command names of the language in use (the other language's names keep answering if registered earlier). */
async function registerCommands($: Env): Promise<void> {
  const c = t().c
  if (lang === 'tr') {
    await $.command.register({ name: 'ilerleme', description: c.progressDescription, argumentHint: c.progressHint })
    await $.command.register({ name: 'oturumlar', description: c.sessionsDescription })
  } else {
    await $.command.register({ name: 'progress', description: c.progressDescription, argumentHint: c.progressHint })
    await $.command.register({ name: 'sessions', description: c.sessionsDescription })
  }
}

/**
 * Switches the person's language: kept in this plugin's own store (so every later session starts in it), applied to this session at
 * once (the band and the panels redraw from state; the new command names are registered). The answer is in the NEW language.
 */
async function setLanguage($: Env, arg: string): Promise<{ text: string }> {
  const next = arg.trim().toLowerCase()
  if (!LANGS.includes(next as Lang)) return { text: `${t().c.languageNow}\n${t().c.languageUsage}` }
  try {
    await $.store.set(LANGUAGE_KEY, next)
  } catch (e) {
    return { text: t().c.languageFailed((e as Error).message) }
  }
  lang = next as Lang
  await update($, language, () => lang)
  try {
    await registerCommands($)
  } catch (e) {
    $.ui.toast(t().commandFailed((e as Error).message))
  }
  return { text: DICTS[lang].c.languageNow }
}

async function runSessions($: Env): Promise<{ text: string }> {
  await refresh($, true)
  const c = t().c
  const opened = await $.ui.open({ id: SESSIONS_PANE, title: c.sessionsTitle })
  return { text: opened.isPlaced ? c.sessionsOpened : c.sessionsNotPlaced }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      lang = resolveLang(await $.store.get(LANGUAGE_KEY))
    } catch {
      lang = 'en'
    }
    await update($, language, () => lang)
    // Scanning does not depend on registering commands: the band works even if a registration is refused.
    await refresh($, true)
    try {
      await initSelf($)
    } catch (err) {
      // Without a session record binding and the sessions panel do not work, but the band and the progress panel do.
      $.ui.toast(t().recordSetupFailed((err as Error).message))
    }
    await refresh($, false)
    try {
      await registerCommands($)
    } catch (err) {
      $.ui.toast(t().commandFailed((err as Error).message))
    }
    $.clock.every(QUICK_MS, () => {
      // The heartbeat never takes "ended" back; when the id changed `writeSelf` sets up the new record.
      void writeSelf($, (r, now) => (r.ended ? null : { ...r, lastSeen: now }))
      void refresh($, false)
    })
    $.clock.every(FULL_MS, () => void refresh($, true))
    return started
  })

  on('session.end', async ($, e, next) => {
    await markEnded($, e.sessionId)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // A turn starting is sure proof the session lives: an "ended" left by mistake is taken back.
    await writeSelf($, (r, now) => ({ ...r, busy: true, ended: false, lastSeen: now, snippet: r.snippet ?? snippetOf(e.text) }))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await writeSelf($, (r, now) => ({ ...r, busy: false, lastSeen: now }))
      await refresh($, true)
    }
    return result
  })

  // ── Binding: the session's OWN tool call wrote a package's progress.json ─────────────────────────────────────────────
  // Only write tools + Bash (every other tool call never reaches the plugin).
  on('tool.call', { tool: ['Write', 'Edit', 'NotebookEdit', 'Bash'] }, async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const rawPath = PATH_TOOLS.has(e.tool) ? (input['file_path'] ?? input['notebook_path']) : null
    const directPath = typeof rawPath === 'string' ? normPath(rawPath) : null
    const direct = packageFromPath(directPath, segment)
    // Bash: candidates are ONLY the packages the command names; their path in every root is measured before and after the call.
    const names = e.tool === 'Bash' && mentionsProgress(input['command']) ? candidatePackages(input['command'], segment) : []
    if (!direct && names.length === 0) return next(e)
    if (names.length && roots.length === 0) await scan($)
    const paths = names.flatMap((n) => roots.map((root) => `${root}/${packagesDir}/${n}/progress.json`))
    const before: Record<string, number> = paths.length ? await mtimesOf($, paths) : {}
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran // a refused or failed write never binds
    if (direct) {
      await bindIfLive($, direct, directPath && isAbsolute(directPath) ? directPath : null)
      return ran
    }
    let after = await mtimesOf($, paths)
    let pkg = changedPackage(before, after, segment)
    if (!pkg && names.length && mainRoot && sigOf(await worktreeEntries($, mainRoot)) !== worktreeSig) {
      // The command added a worktree in this turn (`.git/worktrees` changed): discover the roots again; candidate paths in the new
      // roots did not exist before the call (-1) — only the packages the command names. Unchanged: a single `list` call.
      const fresh = await discoverRoots($, mainRoot)
      const added = fresh.filter((root) => !roots.includes(root))
      if (added.length) {
        roots = fresh
        const extra = names.flatMap((n) => added.map((root) => `${root}/${packagesDir}/${n}/progress.json`))
        for (const path of extra) before[path] = -1
        after = { ...after, ...(await mtimesOf($, extra)) }
        pkg = changedPackage(before, after, segment)
      }
    }
    if (pkg) {
      const written = Object.keys(after).find((path) => packageFromPath(path, segment) === pkg && after[path] !== before[path]) ?? null
      await bindIfLive($, pkg, written)
    }
    return ran
  }).catch(($, e, next) => next(e)) // binding is a side job: its failure never blocks the tool call

  on('command.run', { command: ['progress', 'ilerleme'] }, async ($, e) => runProgress($, e.args))
  on('command.run', { command: ['sessions', 'oturumlar'] }, async ($) => runSessions($))

  // ── Band: this session's package only ─────────────────────────────────────────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap) return next(e)
    const me = await read($, self)
    const now = await $.clock.now()
    await read($, language) // subscribes: a language switch redraws this site
    const d = t()
    const { errors } = organize(snap.reads)
    const mine = boundRead(snap.reads, me?.package ?? null, segment)
    const waitingElsewhere = othersWaitingOnUser(snap.sessions, me, snap.reads, now, segment)
    // In a repository without the packages folder (or outside one) the band is not drawn at all.
    if (snap.reads.length === 0 && !snap.error && waitingElsewhere === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const lines = []
    const counter = waitingElsewhere > 0 ? <Text color="warning">  ·  {d.b.elsewhere(waitingElsewhere)}</Text> : null

    if (mine && !isComplete(mine.doc)) {
      const doc = mine.doc
      const p = progressOf(doc)
      const cur = currentPhase(doc)
      const who = waitingWho(doc)
      const elapsed = packageElapsed(doc, now, d)
      lines.push(
        <Box key="l1">
          <Text color="claude" bold>▶ {doc.title}  </Text>
          <Text color="success">{bar(p.percent)}</Text>
          <Text>  {p.done}/{p.total}  {d.pct(p.percent)}</Text>
        </Box>,
        <Box key="l2">
          <Text dimColor>  {d.b.now}: {cur?.title ?? '—'}</Text>
          {who === 'user' ? <Text color="warning" bold>  ·  {d.b.waitingYou}</Text> : who ? <Text dimColor>  ·  {owner(who)}</Text> : null}
          {elapsed ? <Text dimColor>  ·  {elapsed}</Text> : null}
          {isStale(doc, now) ? <Text color="warning">  ·  {d.b.updated(ago(doc.updatedAt, now))}</Text> : null}
          {counter}
        </Box>,
      )
    } else if (mine) {
      lines.push(
        <Box key="done">
          <Text color="success">{d.b.done(mine.doc.title)}</Text>
          <Text dimColor>  ·  {packageElapsed(mine.doc, now, d)}  ·  {d.b.nextBinds}</Text>
          {counter}
        </Box>,
      )
    } else {
      lines.push(
        <Box key="hint">
          <Text dimColor>
            ○ {me?.package ? d.b.notFound(me.package) : d.b.notBound}  ·  {d.b.bindsOnFirstWrite}  ·  {d.b.bindHint}
          </Text>
          {counter}
        </Box>,
      )
    }
    // An error line only for a discovery error or THIS session's package file being broken (others lead the progress panel).
    const myError = me?.package ? errors.find((r) => packageFromPath(r.path, segment) === me.package) : undefined
    if (snap.error || myError) {
      lines.push(<Text key="err" color="error">⚠ {snap.error ?? `${me?.package}: ${myError?.error}`}</Text>)
    }
    return <Box flexDirection="column" paddingX={1}>{lines}</Box>
  })

  // ── Panel: progress (this session's package in focus) ───────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, language) // subscribes: a language switch redraws this site
    const d = t()
    const snap = await read($, snapshot)
    if (!snap) return <Text dimColor>{d.p.reading}</Text>
    const me = await read($, self)
    const now = await $.clock.now()
    const { active, completed, errors } = organize(snap.reads)
    const mine = boundRead(snap.reads, me?.package ?? null, segment)
    const focus = (mine && active.find((r) => packageKey(r, segment) === packageKey(mine, segment))) ?? focusOf(active, snap.cwdRoot)
    const others = active.filter((r) => r !== focus)
    const out = []

    const phaseRows = (doc: ProgressDoc) =>
      doc.phases.map((ph) => {
        const v = STATUS_VIEW[ph.status]
        const finished = ph.status === 'done' || ph.status === 'skipped'
        const meta = [
          ph.owner ? owner(ph.owner) : '',
          phaseDuration(ph, now, d),
          ph.note ?? '',
          ...Object.entries(ph.metrics ?? {}).map(([k, val]) => `${k} ${val}`),
          ...(ph.refs ?? []),
        ].filter(Boolean)
        return (
          <Box key={`ph-${doc.package}-${ph.id}`}>
            <Text color={v.tone} bold={!finished}>{v.icon} </Text>
            <Text dimColor={finished} bold={ph.status === 'active' || ph.status === 'waiting-user'}>{ph.title}</Text>
            {meta.length ? <Text dimColor>  {meta.join(' · ')}</Text> : null}
          </Box>
        )
      })

    if (focus) {
      const doc = focus.doc
      const p = progressOf(doc)
      const who = waitingWho(doc)
      out.push(
        <Text key="h" bold color="claude">
          {doc.title}{doc.branch ? `  (${doc.branch})` : ''}{mine && packageKey(focus, segment) === packageKey(mine, segment) ? '' : d.p.notBoundHere}
        </Text>,
        <Box key="b">
          <Text color="success">{bar(p.percent, 24)}</Text>
          <Text>  {d.p.phasesDone(p.done, p.total, p.percent)}  ·  {packageElapsed(doc, now, d)}</Text>
        </Box>,
      )
      if (who === 'user') {
        out.push(<Text key="w" color="warning" bold>{d.p.waitingYou(waitingWhat(doc))}</Text>)
      } else if (doc.waitingOn) {
        out.push(<Text key="w" dimColor>{d.p.waiting(owner(doc.waitingOn.who), doc.waitingOn.what)}</Text>)
      }
      if (isStale(doc, now)) out.push(<Text key="st" color="warning">{d.p.stale(ago(doc.updatedAt, now))}</Text>)
      out.push(<Text key="sp1"> </Text>, ...phaseRows(doc))
      if (doc.audits?.length) {
        out.push(<Text key="sp2"> </Text>, <Text key="ah" bold>{d.p.audits}</Text>)
        for (const a of doc.audits) {
          out.push(
            <Box key={`au-${doc.package}-${a.round}-${a.by}`}>
              <Text color={verdictTone(a.verdict)}>● </Text>
              <Text>{auditLine(a, d)}</Text>
              {a.at ? <Text dimColor>  {shortDate(a.at)}</Text> : null}
            </Box>,
          )
        }
      }
    } else if (snap.folder && !snap.folder.exists) {
      out.push(<Text key="none" bold>{d.p.noFolder(snap.folder.dir)}</Text>, <Text key="hint" dimColor>{d.p.noFolderHint}</Text>)
    } else {
      out.push(<Text key="none" dimColor>{d.p.none}</Text>)
    }

    if (others.length) {
      out.push(<Text key="sp3"> </Text>, <Text key="oh" bold>{d.p.others}</Text>)
      for (const r of others) {
        const p = progressOf(r.doc)
        const cur = currentPhase(r.doc)
        const who = waitingWho(r.doc)
        out.push(
          <Box key={`o-${r.doc.package}`}>
            <Text color="claude">● {r.doc.title}  </Text>
            <Text color="success">{bar(p.percent, 8)}</Text>
            <Text dimColor>  {p.done}/{p.total} · {cur?.title ?? '—'}{who ? ` · ${owner(who)}` : ''} · {ago(r.doc.updatedAt, now)}</Text>
          </Box>,
        )
      }
    }

    if (completed.length) {
      out.push(<Text key="sp4"> </Text>, <Text key="ch" bold>{d.p.completed}</Text>)
      for (const r of completed.slice(0, 6)) {
        const lastEnd = r.doc.phases.map((ph) => ph.finishedAt).filter(Boolean).sort().pop()
        out.push(
          <Box key={`c-${r.doc.package}`}>
            <Text color="success">✓ </Text>
            <Text dimColor>{r.doc.title}{lastEnd ? `  ·  ${shortDate(lastEnd)}` : ''}  ·  {packageElapsed(r.doc, now, d)}</Text>
          </Box>,
        )
      }
    }

    // Errors at the TOP (visible in a short window too); the list is never cut — the engine scrolls the pane body.
    const errorRows = []
    if (snap.error) errorRows.push(<Text key="se" color="error">⚠ {snap.error}</Text>)
    for (const r of errors) errorRows.push(<Text key={`e-${r.path}`} color="error">⚠ {r.path}: {r.error}</Text>)
    if (errorRows.length) errorRows.push(<Text key="sp5"> </Text>)

    out.push(<Text key="sp6"> </Text>, <Text key="f" dimColor>{d.p.footer(shortDate(new Date(snap.readAt).toISOString()))}</Text>)
    return <Box flexDirection="column">{[...errorRows, ...out]}</Box>
  })

  // ── Panel: sessions (open sessions one by one) ─────────────────────────────────────────────────────────────────────
  // Readable in a narrow side panel: every session is a framed card, each fact on its OWN line. Coloured parts of one line are nested
  // Text — side-by-side Texts split into columns when the line wraps. Phases as an icon strip, not names (names are in the progress panel).
  on('ui.render', { component: 'Pane', requestId: SESSIONS_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    await read($, language) // subscribes: a language switch redraws this site
    const d = t()
    const snap = await read($, snapshot)
    if (!snap) return <Text dimColor>{d.p.reading}</Text>
    const me = await read($, self)
    const now = await $.clock.now()
    const { rows, closed, orphans } = organizeSessions(snap.sessions, me, snap.reads, now, snap.closedSessions, segment)
    const waiting = rows.filter((r) => r.status === 'user').length
    const unbound = rows.filter((r) => !r.rec.package).length

    const phaseStrip = (doc: ProgressDoc, k: string) => (
      <Text key={`ps-${k}`}>
        {doc.phases.map((ph) => (
          <Text key={`${k}-${ph.id}`} color={STATUS_VIEW[ph.status].tone}>{STATUS_VIEW[ph.status].icon}</Text>
        ))}
      </Text>
    )
    const progressLine = (doc: ProgressDoc, k: string, width: number) => {
      const p = progressOf(doc)
      return (
        <Text key={`pb-${k}`}>
          <Text color="success">{bar(p.percent, width)}</Text>
          <Text dimColor>  {p.done}/{p.total} · {d.pct(p.percent)}</Text>
        </Text>
      )
    }
    /** What is happening in the package now: a decision waiting on the person, work another side waits on, or the running phase (+ next). */
    const stateLines = (doc: ProgressDoc, k: string) => {
      if (isComplete(doc)) return [<Text key={`st-${k}`} color="success">{d.s.completed}</Text>]
      const who = waitingWho(doc)
      if (who === 'user') return [<Text key={`st-${k}`} color="warning">{d.s.waitingFor(waitingWhat(doc))}</Text>]
      const cur = currentPhase(doc)
      const lines = [
        doc.waitingOn
          ? <Text key={`st-${k}`}>⧗ {owner(doc.waitingOn.who)}: {doc.waitingOn.what}</Text>
          : <Text key={`st-${k}`}>{d.s.now(cur?.title ?? '—')}{who ? <Text dimColor>  ·  {owner(who)}</Text> : null}</Text>,
      ]
      const idx = cur ? doc.phases.indexOf(cur) : -1
      const nextPh = doc.phases.slice(idx + 1).find((ph) => ph.status === 'pending')
      if (nextPh) lines.push(<Text key={`nx-${k}`} dimColor>{d.s.next(nextPh.title)}</Text>)
      return lines
    }

    if (snap.folder && !snap.folder.exists) {
      // A repository that does not use the plugin yet: no records are kept, so there is nothing to list — say how to start.
      return (
        <Box flexDirection="column">
          <Text bold>{d.p.noFolder(snap.folder.dir)}</Text>
          <Text dimColor>{d.p.noFolderHint}</Text>
        </Box>
      )
    }
    const out = [
      <Text key="hd">
        <Text bold>{d.s.open(rows.length)}</Text>
        {waiting ? <Text color="warning" bold>{d.s.waitingYou(waiting)}</Text> : null}
        {unbound ? <Text dimColor>{d.s.unbound(unbound)}</Text> : null}
      </Text>,
    ]
    for (const row of rows) {
      const { rec, doc } = row
      const k = rec.id
      const tone = row.status === 'user' ? 'warning' : row.status === 'busy' ? 'claude' : undefined
      const status =
        row.status === 'user' ? (
          <Text color="warning" bold>{d.s.statusWaiting}</Text>
        ) : row.status === 'busy' ? (
          <Text color="claude" bold>{d.s.statusBusy}</Text>
        ) : (
          <Text dimColor>{d.s.statusIdle}</Text>
        )
      const body = [
        <Text key={`h-${k}`}>{status}<Text dimColor>  ·  {ago(rec.lastSeen, now)}</Text></Text>,
      ]
      if (doc) {
        body.push(<Text key={`t-${k}`} bold color="claude">{doc.title}</Text>, progressLine(doc, k, 12), phaseStrip(doc, k), ...stateLines(doc, k))
      } else {
        body.push(<Text key={`t-${k}`} dimColor>{rec.package ? d.s.notFound(rec.package) : d.s.noPackage}</Text>)
      }
      body.push(
        <Text key={`o-${k}`} dimColor>
          {labelOf(rec, d.s.sessionId)}{row.isSelf ? d.s.thisSession : ''}  ·  {baseName(rec.checkout ?? rec.cwd)}
        </Text>,
      )
      out.push(
        <Box key={`card-${k}`} flexDirection="column" borderStyle="round" borderColor={tone} borderDimColor={!tone} paddingX={1} marginTop={1}>
          {body}
        </Box>,
      )
    }
    if (orphans.length) {
      out.push(
        <Box key="oh" marginTop={1}>
          <Text bold>{d.s.orphans(orphans.length)}</Text>
          <Text dimColor>{d.s.orphansHint}</Text>
        </Box>,
      )
      for (const { key, doc: od } of orphans) {
        out.push(
          <Box key={`o-${key}`} flexDirection="column" paddingLeft={2} marginTop={1}>
            <Text>{od.title}</Text>
            {progressLine(od, key, 8)}
            <Text dimColor>{currentPhase(od)?.title ?? '—'}  ·  {ago(od.updatedAt, now)}</Text>
          </Box>,
        )
      }
    }
    out.push(
      <Box key="ft" flexDirection="column" marginTop={1}>
        <Text dimColor>{closed ? d.s.closed(closed) : ''}{d.s.read(shortDate(new Date(snap.readAt).toISOString()))}</Text>
        <Text dimColor>{d.s.hint}</Text>
      </Box>,
    )
    return <Box flexDirection="column">{out}</Box>
  })
}
