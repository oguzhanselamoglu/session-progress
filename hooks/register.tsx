import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Decision, ForeignProject, PackageRead, ProgressDoc, ProjectConfig, SessionRecord, Snapshot } from '../types'
import { DICTS, LANGS, SCOPE_ALIASES, SUB_ALIASES, resolveLang, type Dict, type Lang } from './i18n'
import {
  STATUS_VIEW,
  auditLine,
  auditNote,
  bar,
  branchFromHead,
  currentPhase,
  focusOf,
  gitDirOf,
  isComplete,
  isStale,
  mainRootFromGitFile,
  organize,
  ownerLabel,
  packageElapsed,
  parseDoc,
  phaseDuration,
  schemaNote,
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
  agentSummary,
  autoBind,
  boundRead,
  candidatePackages,
  changedPackage,
  ANY_TOOL,
  decisionFor,
  docsByPackage,
  isOpen,
  labelOf,
  mentionsProgress,
  newSession,
  normPath,
  organizeSessions,
  othersWaitingOnUser,
  type SessionRow,
  packageFromPath,
  packageKey,
  parseProject,
  parseSession,
  projectEntry,
  projectFileName,
  projectsDir,
  pruneAgents,
  settleAgent,
  startAgent,
  stopAgent,
  segmentOf,
  sessionsDir,
  permissionToolFrom,
  snippetOf,
  waitingAlerts,
} from './sessions'

const PANE = 'session-progress'
const SESSIONS_PANE = 'session-progress-sessions'
/** Per-project settings file, relative to the checkout root. */
const CONFIG_FILE = '.claude/session-progress.json'
const QUICK_MS = 30_000
/** Every 5 s only the session records are read again: another session's dialog or status reaches this one within seconds. */
const SESSIONS_MS = 5_000
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
/** `$.store` key of the person's choice to see other projects too (`/sessions all`); off unless they turned it on. */
const SCOPE_KEY = 'otherProjects'

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
/** The subagents line: running / done / failed and the running ones' task labels; `null` without subagents. */
const agentsText = (agents: readonly AgentRun[] | undefined): { head: string; names: string } | null => {
  if (!agents?.length) return null
  const s = agentSummary(agents)
  const a = t().a
  const parts = [a.running(s.running.length), a.done(s.done)]
  if (s.failed) parts.push(a.failed(s.failed))
  return { head: `⑂ ${a.label}: ${parts.join(' · ')}`, names: s.running.map((x) => x.description).join(', ') }
}
/** What waits on the person in other projects' open sessions (0 while other projects are off). */
const foreignWaitingCount = (snap: Snapshot, now: number): number =>
  (snap.foreign ?? []).reduce((n, p) => n + othersWaitingOnUser(p.sessions, null, p.reads, now, segmentOf(p.packagesDir)), 0)
const decisionText = (x: Decision): string =>
  x.kind === 'permission' ? (x.tool === ANY_TOOL ? t().dec.permissionAny : t().dec.permission(x.tool)) : t().dec[x.kind]

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
/** Other sessions' waiting state at the last pass (`waitingAlerts`); `null` until the first pass, which announces nothing. */
let sessionSeen: Record<string, [string, string]> | null = null
/** The tool whose dialog this session has open (mirrors the record's `decision`): a tool call that ends clears it only when it matches. */
let openDialog: string | null = null
/** Told once when the record file could not be written. */
let writeWarned = false
/** Bash calls that name a package file, while they run: tool_use_id → the files' modification times before the call (PostToolUse). */
const writing = new Map<string, Record<string, number>>()
/**
 * Record files at the last read: name → modification time and record. The 5 s pass reads a file again only when its time moved; the
 * 30 s refresh reads every open one.
 */
let recordCache = new Map<string, { mtimeMs: number; rec: SessionRecord | null }>()
/** The open record files' names and times (+ the closed count) at the last read: unchanged → the 5 s pass draws nothing again. */
let recordSig = ''
/** The checkout's branch (`null` when detached) and whether it is a linked worktree, from git's own files at each full scan. */
let liveBranch: string | null = null
let isWorktree = false
/**
 * The sessions panel as this module last left it: opened (by the command or unasked) and, once the person closed it, never opened
 * unasked again in this load.
 */
let sessionsPaneOpen = false
let sessionsPaneDismissed = false
/** The last full scan's error (discovery or project config), carried by quick refreshes. */
let lastScanError: string | null = null

// ── Other projects (only while the person has them on) ────────────────────────────────────────────────────────────────
/** Whether the person turned other projects on (`$.store`, read again at every heartbeat: a switch in one session reaches all). */
let allProjects = false
/** The person's Claude Code configuration folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`); `null` when it cannot be found. */
let configDir: string | null = null
/** Other projects' open sessions at the last read. */
let foreign: ForeignProject[] = []
/** Other projects' files at the last read: path → modification time and what was read (read again only when the time moved). */
let foreignCache = new Map<string, { mtimeMs: number; value: unknown }>()
/** Other projects' waiting state at the last pass, per project: a project seen for the first time announces nothing. */
let foreignSeen = new Map<string, Record<string, [string, string]>>()

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
  isWorktree = main !== cwdRoot
  try {
    const head = await $.fs.read(`${gitDirOf(cwdRoot, typeof gitText === 'string' ? gitText : null)}/HEAD`)
    liveBranch = typeof head === 'string' ? branchFromHead(head) : null
  } catch {
    liveBranch = null
  }
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
 * they pile up, and reading them all would be costly. `cached`: a file whose modification time did not move since the last read is not
 * read again (the 5 s pass). `sig` names the open files and their times, to tell whether anything changed.
 */
async function readSessions($: Env, now: number, cached = false): Promise<{ records: SessionRecord[]; closedUnread: number; sig: string }> {
  if (!mainRoot || !registryOn) return { records: [], closedUnread: 0, sig: '' }
  const dir = sessionsDir(mainRoot)
  let entries: readonly { name: string; kind: string; mtimeMs: number }[]
  try {
    entries = await $.fs.list(dir)
  } catch {
    return { records: [], closedUnread: 0, sig: '' } // no records yet
  }
  const out: SessionRecord[] = []
  const next = new Map<string, { mtimeMs: number; rec: SessionRecord | null }>()
  const parts: string[] = []
  let closedUnread = 0
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > OPEN_MS + 60_000) {
      closedUnread++
      continue
    }
    parts.push(`${entry.name}@${entry.mtimeMs}`)
    const hit = recordCache.get(entry.name)
    let rec: SessionRecord | null = null
    if (cached && hit && hit.mtimeMs === entry.mtimeMs) {
      rec = hit.rec
    } else {
      try {
        const text = await $.fs.read(`${dir}/${entry.name}`)
        rec = typeof text === 'string' ? parseSession(text) : null
      } catch {
        // skip — a half-written file is read again once its time moves
      }
    }
    next.set(entry.name, { mtimeMs: entry.mtimeMs, rec })
    if (rec) out.push(rec)
  }
  recordCache = next
  return { records: out, closedUnread, sig: `${closedUnread}|${parts.join(',')}` }
}

/** The 5 s pass: only the session records (one listing; a record is read only when its file changed), then the waiting alerts. */
function refreshSessions($: Env): Promise<void> {
  queue = queue.then(() => refreshSessionsNow($)).catch(() => undefined)
  return queue
}

async function refreshSessionsNow($: Env): Promise<void> {
  await trackSessionsPane($)
  const local = !!mainRoot && registryOn
  if (!local && !allProjects && !foreign.length) return
  const now = await $.clock.now()
  const { records, closedUnread, sig } = await readSessions($, now, true)
  const foreignSig = await readForeign($, now, true)
  if (`${sig}#${foreignSig}` === recordSig) return
  recordSig = `${sig}#${foreignSig}`
  const snap = await read($, snapshot)
  if (!snap) return
  await update($, snapshot, () => ({ ...snap, sessions: records, closedSessions: closedUnread, foreign }))
  if (local) await notifyElsewhere($, records, snap.reads, now)
  await notifyForeign($, now)
}

/**
 * Other projects' open sessions (only while they are on): the project files (a stale one is skipped unread), each project's records,
 * and the package file each open session there is bound to — read again only when a file's time moved. Returns what was read, as a
 * signature (unchanged → nothing to draw again). This project's own file is skipped: its sessions are read the usual way.
 */
async function readForeign($: Env, now: number, cached: boolean): Promise<string> {
  if (!allProjects || !configDir) {
    foreign = []
    foreignCache = new Map()
    return ''
  }
  const dir = projectsDir(configDir)
  let entries: readonly { name: string; kind: string; mtimeMs: number }[]
  try {
    entries = await $.fs.list(dir)
  } catch {
    foreign = []
    return '' // no project has written one yet
  }
  const next = new Map<string, { mtimeMs: number; value: unknown }>()
  const get = async <T,>(path: string, mtimeMs: number, parse: (text: string) => T | null): Promise<T | null> => {
    const hit = foreignCache.get(path)
    let value: T | null = null
    if (cached && hit && hit.mtimeMs === mtimeMs) {
      value = hit.value as T | null
    } else {
      try {
        const text = await $.fs.read(path)
        value = typeof text === 'string' ? parse(text) : null
      } catch {
        // half-written or gone: read again once its time moves
      }
    }
    next.set(path, { mtimeMs, value })
    return value
  }
  const fresh = (mtimeMs: number): boolean => now - mtimeMs <= OPEN_MS + 60_000
  /** This project's own file (spelt as project files are: forward slashes, no trailing one) is never listed as another project. */
  const ownRoot = mainRoot ? normPath(mainRoot).replace(/\/+$/, '') : null
  const parts: string[] = []
  const out: ForeignProject[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || !fresh(entry.mtimeMs)) continue
    const project = await get(`${dir}/${entry.name}`, entry.mtimeMs, parseProject)
    if (!project || project.root === ownRoot || Math.abs(now - Date.parse(project.lastSeen)) > OPEN_MS + 60_000) continue
    const recDir = sessionsDir(project.root)
    let recs: readonly { name: string; kind: string; mtimeMs: number }[]
    try {
      recs = await $.fs.list(recDir)
    } catch {
      continue
    }
    const sessions: SessionRecord[] = []
    for (const r of recs) {
      if (r.kind !== 'file' || !r.name.endsWith('.json') || !fresh(r.mtimeMs)) continue
      parts.push(`${recDir}/${r.name}@${r.mtimeMs}`)
      const rec = await get(`${recDir}/${r.name}`, r.mtimeMs, parseSession)
      if (rec && isOpen(rec, now)) sessions.push(rec)
    }
    if (!sessions.length) continue
    const reads: PackageRead[] = []
    const segmentThere = segmentOf(project.packagesDir)
    for (const name of new Set(sessions.map((x) => x.package).filter((x): x is string => !!x))) {
      // The package in the checkout of a session bound to it (a worktree), and in the main checkout.
      const checkouts = sessions.filter((x) => x.package === name).map((x) => x.checkout).filter((x): x is string => !!x)
      for (const root of new Set([...checkouts, project.root])) {
        const path = `${root}/${project.packagesDir}/${name}/progress.json`
        let mtimeMs: number
        try {
          mtimeMs = (await $.fs.stat(path)).mtimeMs
        } catch {
          continue
        }
        parts.push(`${path}@${mtimeMs}`)
        const r = await get(path, mtimeMs, (text): PackageRead => {
          const parsed = parseDoc(text, t(), project.schemaAliases)
          return 'doc' in parsed ? { ok: true, path, root, doc: parsed.doc, warning: parsed.warning } : { ok: false, path, root, error: parsed.error }
        })
        if (r && packageFromPath(r.path, segmentThere)) reads.push(r)
      }
    }
    out.push({ root: project.root, name: baseName(project.root), packagesDir: project.packagesDir, sessions, reads })
  }
  foreignCache = next
  foreign = out
  return parts.join(',')
}

/**
 * One notification when a session in ANOTHER project starts waiting on the person (only while other projects are on), naming the
 * project, the session and what waits. A project seen for the first time announces nothing (what already waited is no news).
 */
async function notifyForeign($: Env, now: number): Promise<void> {
  const next = new Map<string, Record<string, [string, string]>>()
  let told = false
  for (const p of foreign) {
    const { alerts, seen: s } = waitingAlerts(p.sessions, null, p.reads, now, foreignSeen.get(p.root) ?? null, segmentOf(p.packagesDir))
    next.set(p.root, s)
    for (const { rec, decision, doc } of alerts) {
      const label = labelOf(rec, t().s.sessionId)
      if (decision) $.ui.toast(t().n.elsewhereProject(p.name, label, decisionText(decision)), { timeoutMs: 8000 })
      if (doc) $.ui.toast(t().n.elsewhereProject(p.name, label, `${doc.title}: ${waitingWhat(doc)}`), { timeoutMs: 8000 })
      told = true
    }
  }
  foreignSeen = next
  if (told) await autoOpenSessions($)
}

/** The person's Claude Code configuration folder: `CLAUDE_CONFIG_DIR`, else `.claude` in the home folder; `null` when neither is known. */
async function findConfigDir($: Env): Promise<string | null> {
  try {
    const own = await $.env.get('CLAUDE_CONFIG_DIR')
    if (own) return normPath(own).replace(/\/+$/, '')
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
    return home ? `${normPath(home).replace(/\/+$/, '')}/.claude` : null
  } catch {
    return null
  }
}

/** The person's other-projects choice, from the plugin's store (a switch made in another session is picked up here). */
async function loadScope($: Env): Promise<void> {
  let on = false
  try {
    on = (await $.store.get(SCOPE_KEY)) === true
  } catch {
    on = allProjects // unknown: keep what was in use
  }
  if (!on && allProjects) {
    foreign = []
    foreignSeen = new Map()
  }
  allProjects = on
}

/**
 * Tells other projects' sessions that this project has an open session: its file under the configuration folder (where it is and its
 * packages folder, nothing else). Only while other projects are on, and only in a project whose sessions keep records.
 */
async function publishProject($: Env): Promise<void> {
  if (!allProjects || !configDir || !mainRoot || !registryOn) return
  try {
    const entry = projectEntry(mainRoot, packagesDir, new Date(await $.clock.now()).toISOString(), schemaAliases)
    await $.fs.write(`${projectsDir(configDir)}/${projectFileName(mainRoot)}`, `${JSON.stringify(entry, null, 2)}\n`)
  } catch {
    // other projects simply do not see this one until the next heartbeat
  }
}

async function readAll($: Env, scanError: string | null): Promise<void> {
  const reads: PackageRead[] = []
  for (const { root, path } of known) {
    try {
      const text = await $.fs.read(path)
      const parsed = parseDoc(typeof text === 'string' ? text : '', t(), schemaAliases)
      reads.push('doc' in parsed ? { ok: true, path, root, doc: parsed.doc, warning: parsed.warning } : { ok: false, path, root, error: parsed.error })
    } catch (e) {
      reads.push({ ok: false, path, root, error: t().v.unreadable((e as Error).message) })
    }
  }
  const now = await $.clock.now()
  const { records: sessions, closedUnread, sig } = await readSessions($, now)
  const foreignSig = await readForeign($, now, false)
  recordSig = `${sig}#${foreignSig}`
  const folder = folderExists === null ? null : { dir: packagesDir, exists: folderExists }
  const snap: Snapshot = { readAt: now, cwdRoot, reads, error: scanError, sessions, closedSessions: closedUnread, folder, foreign }
  await update($, snapshot, () => snap)
  await notify($, reads)
  await notifyElsewhere($, sessions, reads, now)
  await notifyForeign($, now)
}

/**
 * One notification when ANOTHER open session starts waiting on the person: a dialog opened there (a permission prompt, a question, a
 * plan to approve) or its package's decision moved to them. Silent at the first pass of a module load (what already waited is no news).
 */
async function notifyElsewhere($: Env, sessions: readonly SessionRecord[], reads: readonly PackageRead[], now: number): Promise<void> {
  const me = await read($, self)
  const { alerts, seen: next } = waitingAlerts(sessions, me, reads, now, sessionSeen, segment)
  sessionSeen = next
  for (const { rec, decision, doc } of alerts) {
    const where = `${labelOf(rec, t().s.sessionId)} (${baseName(rec.checkout ?? rec.cwd)})`
    if (decision) $.ui.toast(t().n.elsewhere(where, decisionText(decision)), { timeoutMs: 8000 })
    if (doc) $.ui.toast(t().n.elsewhere(where, `${doc.title}: ${waitingWhat(doc)}`), { timeoutMs: 8000 })
  }
  if (alerts.length) await autoOpenSessions($)
}

const paneShown = async ($: Env, id: string): Promise<boolean> => (await $.ui.panes()).some((p) => p.id === id)

/**
 * Another session started waiting on the person: the sessions panel opens by itself (on a wide enough window; a narrow one keeps it
 * waiting) — unless the person closed it in this session.
 */
async function autoOpenSessions($: Env): Promise<void> {
  if (sessionsPaneDismissed) return
  try {
    if (await paneShown($, SESSIONS_PANE)) return
    await $.ui.open({ id: SESSIONS_PANE, title: t().c.sessionsTitle })
    sessionsPaneOpen = true
  } catch {
    // the panel is a convenience; the toast already told
  }
}

/** The sessions panel this module opened is gone: the person closed it — never opened unasked again in this load. */
async function trackSessionsPane($: Env): Promise<void> {
  if (!sessionsPaneOpen) return
  try {
    if (!(await paneShown($, SESSIONS_PANE))) {
      sessionsPaneOpen = false
      sessionsPaneDismissed = true
    }
  } catch {
    // unknown: asked again on the next pass
  }
}

/**
 * The package files a finished tool call wrote: a Write/Edit/NotebookEdit target that is a `progress.json`, or the package files a Bash
 * command names whose modification time moved during the call (measured before it by the binding hook).
 */
async function writtenPackageFiles($: Env, tool: string, input: unknown, toolUseId: string): Promise<string[]> {
  const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  if (PATH_TOOLS.has(tool)) {
    const raw = args['file_path'] ?? args['notebook_path']
    const path = typeof raw === 'string' ? normPath(raw) : null
    return path && isAbsolute(path) && packageFromPath(path, segment) ? [path] : []
  }
  const before = tool === 'Bash' ? writing.get(toolUseId) : undefined
  if (!before) return []
  const after = await mtimesOf($, Object.keys(before))
  return Object.keys(after).filter((path) => (after[path] ?? -1) >= 0 && after[path] !== before[path])
}

/** One note per package file the call wrote that does not match the schema (unreadable counts too); none when all match. */
async function schemaNotes($: Env, tool: string, input: unknown, toolUseId: string): Promise<string[]> {
  const notes: string[] = []
  for (const path of await writtenPackageFiles($, tool, input, toolUseId)) {
    let error: string | null
    let warning: string | null = null
    try {
      const text = await $.fs.read(path)
      const parsed = parseDoc(typeof text === 'string' ? text : '', DICTS.en, schemaAliases)
      error = 'error' in parsed ? parsed.error : null
      if ('doc' in parsed) warning = parsed.warning ?? null
    } catch (err) {
      error = DICTS.en.v.unreadable((err as Error).message)
    }
    if (error) notes.push(schemaNote(path, error))
    else if (warning) notes.push(auditNote(path, warning))
  }
  return notes
}

/** Opens (or replaces) the dialog this session has open on the person, in its record at once (other sessions read it). */
async function openDecision($: Env, tool: string): Promise<void> {
  openDialog = tool
  const since = new Date(await $.clock.now()).toISOString()
  await writeSelf($, (r) => ({ ...r, decision: decisionFor(tool, since) }))
}

/** Closes the open dialog: any (`tool` undefined) or only the given tool's. Nothing is written when none is open. */
async function closeDecision($: Env, tool?: string): Promise<void> {
  if (tool !== undefined && openDialog !== tool) return
  openDialog = null
  await writeSelf($, (r) => (r.decision && (tool === undefined || r.decision.tool === tool) ? { ...r, decision: null } : null))
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
    if (full || known.length === 0) {
      lastScanError = await scan($)
      await syncLocation($)
    }
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
      foreign: s?.foreign ?? [],
    }))
  }
}

/** The checkout, its branch and whether it is a worktree, in this session's record — written only when one changed (a `git checkout`). */
function syncLocation($: Env): Promise<void> {
  return writeSelf($, (r) =>
    r.branch === liveBranch && r.worktree === isWorktree && r.checkout === cwdRoot ? null : { ...r, branch: liveBranch, worktree: isWorktree, checkout: cwdRoot },
  )
}

/** Changes this session's own record (in order) and writes its file; nothing is written when `patch` returns `null`. */
function writeSelf($: Env, patch: (r: SessionRecord, nowIso: string) => SessionRecord | null): Promise<void> {
  selfQueue = selfQueue.then(() => writeSelfNow($, patch)).catch(() => undefined)
  return selfQueue
}

async function writeSelfNow($: Env, patch: (r: SessionRecord, nowIso: string) => SessionRecord | null): Promise<void> {
  let cur = await read($, self)
  const nowIso = new Date(await $.clock.now()).toISOString()
  // `/clear` or `/resume` changes the session id without restarting the process (no `session.start`): the old record stays ended and
  // a record is set up under the new id (continuing the resumed session's own record when it has one). The host keeps `$.state` per
  // session, so after the switch `self` may read as never set: the new id's record is set up the same way.
  const id = await currentId($)
  if (id && id !== cur?.id) cur = { ...((await loadRecord($, id)) ?? newSession(id, await $.session.cwd(), nowIso, cwdRoot)), ended: false }
  if (!cur) return
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
      const done = { ...target, busy: false, ended: true, lastSeen: nowIso, decision: null, agents: [] }
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
  await writeSelf($, (r, now) => ({ ...r, cwd, checkout: cwdRoot, branch: liveBranch, worktree: isWorktree, lastSeen: now, ended: false, busy: false }))
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
  const needsRecord = action === 'bind' || action === 'unbind' || action === 'name'
  // After `/clear` or `/resume` the record is set up by the next write: a command can come before any.
  if (needsRecord && !(await read($, self))) await writeSelf($, (r) => r)
  if (needsRecord && !(await read($, self))) return { text: c.noRecord }
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
  // The bare command toggles the panel; `refresh` always (re)opens it.
  if (sub === '' && (await paneShown($, PANE))) {
    await $.ui.close({ id: PANE })
    return { text: c.paneClosed }
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

/** The project's CLAUDE.md files `/progress init` may add its line to, in order (it never creates one). */
const CLAUDE_FILES = ['CLAUDE.md', '.claude/CLAUDE.md']

/**
 * Offers the "track multi-step work with session-progress" line (in the language in use) for the checkout's EXISTING CLAUDE.md, so Claude
 * tracks work there without being asked. CLAUDE.md is the person's own instruction file: the line is added only after they say yes in a
 * dialog that shows it word for word. Appended, never overwritten; a file that already mentions session-progress is left as it is (the
 * project's own rule, or the line added before). Without a CLAUDE.md nothing is created; declined, or nobody to ask (`-p`): the tip.
 */
async function addClaudeLine($: Env, root: string): Promise<{ text: string; changed: boolean }> {
  const c = t().c
  for (const name of CLAUDE_FILES) {
    const path = `${root}/${name}`
    if (!(await $.fs.exists(path))) continue
    try {
      const text = await $.fs.read(path)
      const current = typeof text === 'string' ? text : ''
      if (/session-progress/i.test(current)) return { text: c.claudePresent(name), changed: false }
      let answer: string
      try {
        answer = await $.ui.ask(c.claudeAsk(name, c.claudeLine), { options: [c.claudeYes, c.claudeNo], header: 'CLAUDE.md' })
      } catch {
        return { text: c.claudeTip(c.claudeLine), changed: false } // dismissed, or no one to ask
      }
      if (answer !== c.claudeYes) return { text: c.claudeDeclined(name, c.claudeLine), changed: false }
      const sep = current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
      await $.fs.write(path, `${current}${sep}${c.claudeLine}\n`)
      return { text: c.claudeAdded(name, c.claudeLine), changed: true }
    } catch (e) {
      return { text: c.claudeFailed(name, (e as Error).message), changed: false }
    }
  }
  return { text: c.claudeTip(c.claudeLine), changed: false }
}

/**
 * `/progress init`: creates the packages folder (from the project's config, default `.progress`) in THIS checkout with a short
 * README, so the plugin starts working in a repository that never used it, and adds its line to an existing CLAUDE.md (also when the
 * folder was there already). Nothing is overwritten.
 */
async function initFolder($: Env): Promise<{ text: string }> {
  await refresh($, true)
  const c = t().c
  if (!cwdRoot) return { text: c.initNoRepo }
  const root = cwdRoot
  const dir = `${root}/${packagesDir}`
  if (await $.fs.exists(dir)) {
    const claude = await addClaudeLine($, root)
    return { text: `${claude.changed ? c.initExistsShort(packagesDir) : c.initExists(packagesDir)}\n${claude.text}` }
  }
  try {
    await $.fs.write(`${dir}/README.md`, PACKAGES_README)
  } catch (e) {
    return { text: c.initFailed((e as Error).message) }
  }
  await refresh($, true)
  // The registry is on now: write this session's record so the sessions panel lists it at once.
  await writeSelf($, (r, now) => ({ ...r, lastSeen: now }))
  return { text: `${c.initDone(packagesDir)}\n${(await addClaudeLine($, root)).text}` }
}

/** Registers the command names of the language in use (the other language's names keep answering if registered earlier). */
async function registerCommands($: Env): Promise<void> {
  const c = t().c
  if (lang === 'tr') {
    await $.command.register({ name: 'ilerleme', description: c.progressDescription, argumentHint: c.progressHint })
    await $.command.register({ name: 'oturumlar', description: c.sessionsDescription, argumentHint: c.sessionsHint })
  } else {
    await $.command.register({ name: 'progress', description: c.progressDescription, argumentHint: c.progressHint })
    await $.command.register({ name: 'sessions', description: c.sessionsDescription, argumentHint: c.sessionsHint })
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

/**
 * The sessions command toggles its panel. Closing it by command also stops it opening unasked in this session; opening allows it again.
 * `all` / `this` (either language) turn other projects on / off for all the person's sessions.
 */
async function runSessions($: Env, args: string): Promise<{ text: string }> {
  const c = t().c
  const [word = ''] = args.trim().split(/\s+/)
  const scope = SCOPE_ALIASES[word.toLocaleLowerCase('tr')] ?? SCOPE_ALIASES[word.toLowerCase()]
  if (word && !scope) return { text: c.sessionsDescription }
  if (scope) return setScope($, scope === 'all')
  if (await paneShown($, SESSIONS_PANE)) {
    await $.ui.close({ id: SESSIONS_PANE })
    sessionsPaneOpen = false
    sessionsPaneDismissed = true
    return { text: c.sessionsClosed }
  }
  await refresh($, true)
  const opened = await $.ui.open({ id: SESSIONS_PANE, title: c.sessionsTitle })
  sessionsPaneOpen = true
  sessionsPaneDismissed = false
  return { text: opened.isPlaced ? c.sessionsOpened : c.sessionsNotPlaced }
}

/**
 * Turns other projects on or off, for all the person's sessions (kept in the plugin's store; the others pick it up at their next
 * heartbeat). On: this project is published at once and the sessions panel opens. Off: nothing is written outside the project any more.
 */
async function setScope($: Env, on: boolean): Promise<{ text: string }> {
  const c = t().c
  if (on && !configDir) return { text: c.scopeUnavailable }
  try {
    await $.store.set(SCOPE_KEY, on)
  } catch (e) {
    return { text: c.scopeFailed((e as Error).message) }
  }
  if (!on) {
    foreign = []
    foreignSeen = new Map()
  }
  allProjects = on
  await publishProject($)
  await refresh($, true)
  if (on && configDir) {
    try {
      if (!(await paneShown($, SESSIONS_PANE))) await $.ui.open({ id: SESSIONS_PANE, title: c.sessionsTitle })
      sessionsPaneOpen = true
      sessionsPaneDismissed = false
    } catch {
      // the answer below still says how it works
    }
    return { text: c.scopeAll(projectsDir(configDir)) }
  }
  return { text: c.scopeThis }
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
    configDir = await findConfigDir($)
    await loadScope($)
    // Scanning does not depend on registering commands: the band works even if a registration is refused.
    await refresh($, true)
    try {
      await initSelf($)
    } catch (err) {
      // Without a session record binding and the sessions panel do not work, but the band and the progress panel do.
      $.ui.toast(t().recordSetupFailed((err as Error).message))
    }
    await publishProject($)
    await refresh($, false)
    try {
      await registerCommands($)
    } catch (err) {
      $.ui.toast(t().commandFailed((err as Error).message))
    }
    $.clock.every(QUICK_MS, () => {
      // The heartbeat never takes "ended" back; when the id changed `writeSelf` sets up the new record.
      void writeSelf($, (r, now) => (r.ended ? null : { ...r, lastSeen: now }))
      // Other projects: a switch made in another session is picked up here, and this project tells the others it is open.
      void loadScope($)
        .then(() => publishProject($))
        .then(() => refresh($, false))
    })
    $.clock.every(FULL_MS, () => void refresh($, true))
    $.clock.every(SESSIONS_MS, () => void refreshSessions($))
    return started
  })

  on('session.end', async ($, e, next) => {
    await markEnded($, e.sessionId)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // A turn starting is sure proof the session lives: an "ended" left by mistake is taken back.
    // A new prompt means no dialog is open any more (a safety net for one whose end was never seen).
    openDialog = null
    await writeSelf($, (r, now) => ({ ...r, busy: true, ended: false, lastSeen: now, snippet: r.snippet ?? snippetOf(e.text), decision: null, agents: pruneAgents(r.agents) ?? r.agents ?? [] }))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      openDialog = null
      await writeSelf($, (r, now) => ({ ...r, busy: false, lastSeen: now, decision: null }))
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
    if (paths.length) writing.set(e.tool_use_id, before)
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } finally {
      writing.delete(e.tool_use_id)
    }
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

  // ── Decisions: a dialog open on the person, in the record so other sessions see it ─────────────────────────────────
  // A permission prompt is showing: Claude Code's own notice of it (`classic.Notification`, `permission_prompt`). Observe only — a
  // notification decides nothing, and this plugin hooks no permission check at all.
  on('classic.Notification', async ($, e, next) => {
    const result = await next(e)
    if (e.notification_type === 'permission_prompt') await openDecision($, permissionToolFrom(e.message))
    return result
  }).catch(($, e, next) => next(e)) // a side job: its failure never touches the notification

  // A question or a plan to approve is open for the whole call; any other call that ends closes its own prompt (allowed or refused —
  // there is no event for the answer itself, so a long command that was allowed still reads as waiting until it ends).
  // A subagent is tracked from its call (running) to its end: the call's result, or SubagentStop for one sent to the background. Only
  // its short task label is kept, never its prompt.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent') {
      const id = e.tool_use_id
      await writeSelf($, (r) => ({ ...r, agents: startAgent(r.agents, id, e.description) }))
      let ran: Awaited<ReturnType<typeof next>>
      try {
        ran = await next(e)
      } catch (err) {
        await writeSelf($, (r) => ({ ...r, agents: settleAgent(r.agents, id, { isError: true }) }))
        throw err
      }
      await writeSelf($, (r) => ({ ...r, agents: settleAgent(r.agents, id, ran) }))
      return ran
    }
    if (e.tool === 'AskUserQuestion' || e.tool === 'ExitPlanMode') {
      await openDecision($, e.tool)
      try {
        return await next(e)
      } finally {
        await closeDecision($, e.tool)
      }
    }
    const ran = await next(e)
    if (openDialog === e.tool || openDialog === ANY_TOOL) await closeDecision($)
    return ran
  }).catch(($, e, next) => next(e)) // a side job: its failure never blocks the tool call

  // A package file this call just WROTE that does not match the schema: a short note for the model (the file's writer) so it fixes the
  // file in the same turn. The tool's result is never changed; a file the call only read gets no note.
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    const notes = await schemaNotes($, e.tool_name, e.tool_input, e.tool_use_id)
    return notes.length ? { ...result, additionalContext: [...(result.additionalContext ?? []), ...notes] } : result
  }).catch(($, e, next) => next(e))

  // A subagent sent to the background ended. Observe only: its result passes on untouched.
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    await writeSelf($, (r) => {
      const agents = stopAgent(r.agents, e.agent_id)
      return agents ? { ...r, agents } : null
    })
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: ['progress', 'ilerleme'] }, async ($, e) => runProgress($, e.args))
  on('command.run', { command: ['sessions', 'oturumlar'] }, async ($, e) => runSessions($, e.args))

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
    const foreignWaiting = foreignWaitingCount(snap, now)
    const waitingElsewhere = othersWaitingOnUser(snap.sessions, me, snap.reads, now, segment) + foreignWaiting
    // In a repository without the packages folder (or outside one) the band is not drawn at all.
    if (snap.reads.length === 0 && !snap.error && waitingElsewhere === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // A project without work packages: only what waits on the person in other projects (shown only while they are on).
    if (snap.reads.length === 0 && !snap.folder?.exists && foreignWaiting > 0) {
      return (
        <Box paddingX={1}>
          <Text color="warning">{d.b.elsewhere(waitingElsewhere)}</Text>
        </Box>
      )
    }
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
    const ag = agentsText(me?.agents)
    if (ag) {
      lines.push(
        <Text key="ag">
          <Text color="merged">{ag.head}</Text>
          {ag.names ? <Text dimColor>  —  {ag.names}</Text> : null}
        </Text>,
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
    const { active, completed, errors, warnings } = organize(snap.reads)
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
      // The package's own branch, else this session's live one when the package is in its checkout.
      const branch = doc.branch ?? (focus.root === snap.cwdRoot ? me?.branch : null)
      const p = progressOf(doc)
      const who = waitingWho(doc)
      out.push(
        <Text key="h" bold color="claude">
          {doc.title}{branch ? `  (${branch})` : ''}{mine && packageKey(focus, segment) === packageKey(mine, segment) ? '' : d.p.notBoundHere}
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
    for (const r of errors) {
      errorRows.push(<Text key={`e-${r.path}`} color="error">⚠ {r.path}: {r.error}{r.elsewhere ? d.p.elsewhereToo(r.elsewhere) : ''}</Text>)
    }
    // Review rounds left out: the package shows, so a dim line is enough.
    for (const r of warnings) errorRows.push(<Text key={`w-${r.path}`} dimColor>⚠ {r.doc.title}: {d.p.auditsLeftOut(r.warning ?? '')}</Text>)
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
    /** Other projects' owner labels are shown as written there (this project's display names do not apply). */
    const ownerThere = (who: string): string => ownerLabel(who, d, {})

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
    const stateLines = (doc: ProgressDoc, k: string, own: (who: string) => string) => {
      if (isComplete(doc)) return [<Text key={`st-${k}`} color="success">{d.s.completed}</Text>]
      const who = waitingWho(doc)
      if (who === 'user') return [<Text key={`st-${k}`} color="warning">{d.s.waitingFor(waitingWhat(doc))}</Text>]
      const cur = currentPhase(doc)
      const lines = [
        doc.waitingOn
          ? <Text key={`st-${k}`}>⧗ {own(doc.waitingOn.who)}: {doc.waitingOn.what}</Text>
          : <Text key={`st-${k}`}>{d.s.now(cur?.title ?? '—')}{who ? <Text dimColor>  ·  {own(who)}</Text> : null}</Text>,
      ]
      const idx = cur ? doc.phases.indexOf(cur) : -1
      const nextPh = doc.phases.slice(idx + 1).find((ph) => ph.status === 'pending')
      if (nextPh) lines.push(<Text key={`nx-${k}`} dimColor>{d.s.next(nextPh.title)}</Text>)
      return lines
    }
    /** One session's card: the same for this project and another one (`k`: unique across projects). */
    const card = (row: SessionRow, k: string, own: (who: string) => string) => {
      const { rec, doc } = row
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
      if (rec.decision) body.push(<Text key={`d-${k}`} color="warning">{d.s.waitingFor(decisionText(rec.decision))}</Text>)
      if (doc) {
        body.push(<Text key={`t-${k}`} bold color="claude">{doc.title}</Text>, progressLine(doc, k, 12), phaseStrip(doc, k), ...stateLines(doc, k, own))
      } else {
        body.push(<Text key={`t-${k}`} dimColor>{rec.package ? d.s.notFound(rec.package) : d.s.noPackage}</Text>)
      }
      const ag = agentsText(rec.agents)
      if (ag) {
        body.push(
          <Text key={`ag-${k}`}>
            <Text color="merged">{ag.head}</Text>
            {ag.names ? <Text dimColor>  —  {ag.names}</Text> : null}
          </Text>,
        )
      }
      body.push(
        <Text key={`o-${k}`} dimColor>
          {labelOf(rec, d.s.sessionId)}{row.isSelf ? d.s.thisSession : ''}  ·  {baseName(rec.checkout ?? rec.cwd)}
          {rec.branch ? `  ·  ⎇ ${rec.branch}` : ''}{rec.worktree ? ` (${d.s.worktree})` : ''}
        </Text>,
      )
      return (
        <Box key={`card-${k}`} flexDirection="column" borderStyle="round" borderColor={tone} borderDimColor={!tone} paddingX={1} marginTop={1}>
          {body}
        </Box>
      )
    }

    // Other projects (only while they are on): projects with something waiting on the person first, then the most recently active.
    const foreignRows = (snap.foreign ?? [])
      .map((p) => ({ p, rows: organizeSessions(p.sessions, null, p.reads, now, 0, segmentOf(p.packagesDir)).rows }))
      .filter((x) => x.rows.length > 0)
      .map((x) => ({ ...x, waiting: x.rows.filter((r) => r.status === 'user').length, last: Math.max(...x.rows.map((r) => Date.parse(r.rec.lastSeen))) }))
      .sort((a, b) => b.waiting - a.waiting || b.last - a.last)
    const foreignWaiting = foreignRows.reduce((n, x) => n + x.waiting, 0)
    const foreignSection = []
    if (allProjects) {
      foreignSection.push(
        <Box key="fp-h" marginTop={1}>
          <Text bold>{d.s.otherProjects(foreignRows.length)}</Text>
          {foreignWaiting ? <Text color="warning" bold>{d.s.waitingYou(foreignWaiting)}</Text> : null}
        </Box>,
      )
      if (!foreignRows.length) foreignSection.push(<Text key="fp-none" dimColor>{d.s.noOtherProjects}</Text>)
      for (const { p, rows: prow } of foreignRows) {
        foreignSection.push(
          <Box key={`fp-${p.root}`} marginTop={1}>
            <Text>
              <Text bold color="claude">▸ {p.name}</Text>
              <Text dimColor>  ·  {d.s.open(prow.length)}</Text>
            </Text>
          </Box>,
        )
        for (const row of prow) foreignSection.push(card(row, `${p.root}|${row.rec.id}`, ownerThere))
      }
    }
    const footer = (
      <Box key="ft" flexDirection="column" marginTop={1}>
        <Text dimColor>{closed ? d.s.closed(closed) : ''}{d.s.read(shortDate(new Date(snap.readAt).toISOString()))}</Text>
        <Text dimColor>{d.s.hint}</Text>
        <Text dimColor>{allProjects ? d.s.scopeOn : d.s.scopeOff}</Text>
      </Box>
    )

    if (snap.folder && !snap.folder.exists) {
      // A repository that does not use the plugin yet: no records are kept, so there is nothing to list — say how to start.
      return (
        <Box flexDirection="column">
          <Text bold>{d.p.noFolder(snap.folder.dir)}</Text>
          <Text dimColor>{d.p.noFolderHint}</Text>
          {foreignSection}
          {allProjects ? footer : null}
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
    // What waits on the person in another project is said at the top too: the cards are further down.
    if (foreignWaiting) out.push(<Text key="fw" color="warning" bold>{d.s.otherWaiting(foreignWaiting)}</Text>)
    for (const row of rows) out.push(card(row, row.rec.id, owner))
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
    out.push(...foreignSection, footer)
    return <Box flexDirection="column">{out}</Box>
  })
}
