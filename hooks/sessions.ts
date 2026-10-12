// Pure core (sessions): record validation, package from a tool call, openness, labels, panel ordering. Never touches `$`.
import type { AgentRun, Decision, PackageRead, ProgressDoc, SessionRecord } from '../types'
import { isComplete, waitingWho, waitingWhat } from './model'

/** A session whose last signal is older than this (or that ended) counts as closed. The heartbeat is every 30 s. */
export const OPEN_MS = 3 * 60_000
/** Default packages folder (relative to the checkout root) when the project does not name one. */
export const DEFAULT_PACKAGES_DIR = '.progress'
/** Session records folder (under the main repository's `.git`: shared by every worktree, never tracked by git). */
export const sessionsDir = (mainRoot: string): string => `${mainRoot}/.git/session-progress/sessions`

/**
 * The folder name paths are matched on: the LAST segment of the packages folder (`docs/work-packages` → `work-packages`), so a
 * path written relative to any folder (`cd docs && … work-packages/x/progress.json`) still names its package.
 */
export const segmentOf = (packagesDir: string): string => packagesDir.replace(/\/+$/, '').split('/').pop() || 'progress'
const DEFAULT_SEGMENT = segmentOf(DEFAULT_PACKAGES_DIR)

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Windows paths (`C:\\repo\\x`) → forward slashes, the form every path here is compared in. */
export const normPath = (p: string): string => p.replace(/\\/g, '/')
const NAME = '([A-Za-z0-9._-]+)'

/** The package named by a `progress.json` path (the last one when several are in it). */
export function packageFromPath(path: unknown, segment = DEFAULT_SEGMENT): string | null {
  if (typeof path !== 'string') return null
  const all = [...normPath(path).matchAll(new RegExp(`${escape(segment)}/${NAME}/progress\\.json`, 'g'))]
  return all.length ? (all[all.length - 1]?.[1] ?? null) : null
}

/** Whether a Bash command mentions `progress.json` (the first condition for it to be a write candidate). */
export const mentionsProgress = (command: unknown): boolean => typeof command === 'string' && command.includes('progress.json')

/**
 * Packages a Bash command names (`…/<segment>/<p>/progress.json` or `D=…/<segment>/<p>; … $D/progress.json`). ONLY these are binding
 * candidates: a package the command does not name (another session's concurrent write, a new worktree) never is. A glob (`*`) is no
 * name.
 */
export function candidatePackages(command: unknown, segment = DEFAULT_SEGMENT): string[] {
  if (typeof command !== 'string') return []
  const re = new RegExp(`${escape(segment)}/${NAME}`, 'g')
  return [...new Set([...normPath(command).matchAll(re)].map((m) => m[1]).filter((x): x is string => !!x && x !== 'progress.json'))]
}

/**
 * Modification times of the candidate paths before and after the call (path → mtimeMs; missing = -1) → the package the call wrote.
 * If the files that changed (or appeared) belong to ONE package, that package; none (a read) or several (ambiguous) → `null`.
 */
export function changedPackage(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
  segment = DEFAULT_SEGMENT,
): string | null {
  const changed = new Set<string>()
  for (const [path, at] of Object.entries(after)) {
    if (at < 0 || before[path] === at) continue
    const pkg = packageFromPath(path, segment)
    if (pkg) changed.add(pkg)
  }
  return changed.size === 1 ? ([...changed][0] ?? null) : null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const strOrNull = (v: unknown): boolean => v === null || typeof v === 'string'
const KINDS: readonly string[] = ['permission', 'question', 'plan']

/** A record's `decision`: a malformed one reads as none (it never hides the whole session); a record written by 0.3.x has none. */
function decisionOf(v: unknown): Decision | null {
  if (!isObj(v) || !KINDS.includes(v.kind as string) || typeof v.tool !== 'string' || !v.tool || !isTime(v.since)) return null
  return { kind: v.kind as Decision['kind'], tool: v.tool, since: v.since }
}

const AGENT_STATUSES: readonly string[] = ['running', 'done', 'failed']

/** A record's `agents`: malformed entries are dropped (never the whole session); a record written by 0.3.x has none. */
function agentsOf(v: unknown): AgentRun[] {
  if (!Array.isArray(v)) return []
  const out: AgentRun[] = []
  for (const a of v) {
    if (!isObj(a) || typeof a.id !== 'string' || typeof a.description !== 'string' || !AGENT_STATUSES.includes(a.status as string)) continue
    const run: AgentRun = { id: a.id, description: a.description, status: a.status as AgentRun['status'] }
    if (typeof a.agentId === 'string') run.agentId = a.agentId
    out.push(run)
  }
  return out
}

/** The dialog a tool opens on the person: its own question or plan, else a permission prompt for it. */
export function decisionFor(tool: string, since: string): Decision {
  const kind = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'permission'
  return { kind, tool, since }
}

/** Validates a record's text; a broken record is `null` (the panel skips it: another session's half-written file never breaks it). */
export function parseSession(text: string): SessionRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObj(raw) || raw.schema !== 'session-progress-session-v1') return null
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.cwd !== 'string') return null
  if (!isTime(raw.startedAt) || !isTime(raw.lastSeen)) return null
  if (!strOrNull(raw.label) || !strOrNull(raw.snippet) || !strOrNull(raw.package)) return null
  if (typeof raw.busy !== 'boolean' || typeof raw.ended !== 'boolean') return null
  if (raw.bindSource !== null && raw.bindSource !== 'auto' && raw.bindSource !== 'manual') return null
  if (raw.checkout !== undefined && !strOrNull(raw.checkout)) return null
  return {
    ...(raw as SessionRecord),
    checkout: (raw.checkout as string | null | undefined) ?? null,
    decision: decisionOf(raw.decision),
    branch: typeof raw.branch === 'string' && raw.branch ? raw.branch : null,
    worktree: raw.worktree === true,
    agents: agentsOf(raw.agents),
  }
}

export function newSession(id: string, cwd: string, nowIso: string, checkout: string | null = null): SessionRecord {
  return {
    schema: 'session-progress-session-v1',
    id,
    label: null,
    snippet: null,
    cwd,
    checkout,
    startedAt: nowIso,
    lastSeen: nowIso,
    busy: false,
    ended: false,
    package: null,
    bindSource: null,
    decision: null,
    branch: null,
    worktree: false,
    agents: [],
  }
}

// ── Subagents ──────────────────────────────────────────────────────────────────────────────────────────────────
/** The most subagents a record keeps (running ones always stay; the oldest finished ones go first). */
export const AGENTS_MAX = 20

const capAgents = (list: readonly AgentRun[]): AgentRun[] => {
  const out = [...list]
  while (out.length > AGENTS_MAX) {
    const i = out.findIndex((a) => a.status !== 'running')
    out.splice(i >= 0 ? i : 0, 1)
  }
  return out
}

/** A subagent started (its tool call is about to run). */
export const startAgent = (list: readonly AgentRun[] | undefined, id: string, description: string): AgentRun[] =>
  capAgents([...(list ?? []).filter((a) => a.id !== id), { id, description, status: 'running' }])

/**
 * The Agent tool call ended: refused or failed → `failed`; launched in the background (`async_launched`, its `agentId` kept for
 * SubagentStop) → still `running`; otherwise `done`.
 */
export function settleAgent(list: readonly AgentRun[] | undefined, id: string, ran: { deny?: unknown; isError?: boolean; result?: unknown }): AgentRun[] {
  const result = isObj(ran.result) ? ran.result : {}
  const background = result.status === 'async_launched' || result.status === 'remote_launched'
  return (list ?? []).map((a) => {
    if (a.id !== id) return a
    if (ran.deny !== undefined || ran.isError) return { ...a, status: 'failed' }
    if (background && typeof result.agentId === 'string') return { ...a, agentId: result.agentId }
    return { ...a, status: 'done' }
  })
}

/** SubagentStop: a background subagent with that id ended. `null` when none matches (nothing to write). */
export function stopAgent(list: readonly AgentRun[] | undefined, agentId: string): AgentRun[] | null {
  if (!(list ?? []).some((a) => a.agentId === agentId && a.status === 'running')) return null
  return (list ?? []).map((a) => (a.agentId === agentId && a.status === 'running' ? { ...a, status: 'done' } : a))
}

/** A new turn: the finished subagents of the last one go, running ones stay. `null` when nothing changes. */
export function pruneAgents(list: readonly AgentRun[] | undefined): AgentRun[] | null {
  const kept = (list ?? []).filter((a) => a.status === 'running')
  return kept.length === (list ?? []).length ? null : kept
}

export function agentSummary(list: readonly AgentRun[] | undefined): { running: AgentRun[]; done: number; failed: number } {
  const all = list ?? []
  return { running: all.filter((a) => a.status === 'running'), done: all.filter((a) => a.status === 'done').length, failed: all.filter((a) => a.status === 'failed').length }
}

/** Open: not ended and the last signal within `OPEN_MS` — a time far in the FUTURE (a clock set back) does not count as open either. */
export function isOpen(r: SessionRecord, now: number): boolean {
  const t = Date.parse(r.lastSeen)
  return !r.ended && Math.abs(now - t) < OPEN_MS
}

/** A tagged message line (`<agent-message …>`, `<command-name>`): not something the person typed. */
const isTagged = (line: string): boolean => /^<[a-z][\w-]*[\s>]/i.test(line)

/** First line of the first message, shortened (the desktop title is not in the API). */
export function snippetOf(text: string, max = 36): string | null {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  // A tagged message makes no name: the next message is tried.
  if (!line || isTagged(line)) return null
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** A tagged piece an older version stored (`<agent-message from=…`) is no name. */
export const labelOf = (r: SessionRecord, idLabel: (id: string) => string = (id) => `session ${id}`): string =>
  r.label ?? (r.snippet && !isTagged(r.snippet) ? r.snippet : null) ?? idLabel(r.id.slice(0, 6))

/** Auto-binding: a manually bound session is never overridden; binding again to the same package is no change. */
export function autoBind(r: SessionRecord, pkg: string): SessionRecord | null {
  if (r.bindSource === 'manual' || r.package === pkg) return null
  return { ...r, package: pkg, bindSource: 'auto' }
}

/**
 * Binding key: the package's FOLDER name (known for sure from the written file's path). By convention it equals the document's
 * `package`; when it differs the binding still follows the folder (it never silently breaks).
 */
export const packageKey = (r: PackageRead, segment = DEFAULT_SEGMENT): string =>
  packageFromPath(r.path, segment) ?? (r.ok ? r.doc.package : r.path)

/** Newest document per folder name (the main checkout and a worktree carrying the same package → newest `updatedAt` wins). */
export function docsByPackage(reads: readonly PackageRead[], segment = DEFAULT_SEGMENT): Map<string, ProgressDoc> {
  const out = new Map<string, ProgressDoc>()
  for (const r of reads) {
    if (!r.ok) continue
    const key = packageKey(r, segment)
    const prev = out.get(key)
    if (!prev || Date.parse(r.doc.updatedAt) > Date.parse(prev.updatedAt)) out.set(key, r.doc)
  }
  return out
}

/** Read binding: the newest read of the bound package (by folder name). */
export function boundRead(reads: readonly PackageRead[], pkg: string | null, segment = DEFAULT_SEGMENT): Extract<PackageRead, { ok: true }> | null {
  if (!pkg) return null
  let best: Extract<PackageRead, { ok: true }> | null = null
  for (const r of reads) {
    if (!r.ok || packageKey(r, segment) !== pkg) continue
    if (!best || Date.parse(r.doc.updatedAt) > Date.parse(best.doc.updatedAt)) best = r
  }
  return best
}

/** An unfinished package whose decision is on the person. */
const docWaits = (d: ProgressDoc | null | undefined): d is ProgressDoc => !!d && !isComplete(d) && waitingWho(d) === 'user'

export type SessionStatus = 'user' | 'busy' | 'idle'
export type SessionRow = { rec: SessionRecord; isSelf: boolean; doc: ProgressDoc | null; status: SessionStatus }

/**
 * The sessions panel: open sessions (this session's own record always counts as open) — first those waiting on the person, then THIS
 * session (even idle — the session running the command usually is), then by last signal; the closed count (`closedUnread`: old records
 * skipped without reading); active packages bound to no open session ("unowned", keyed by folder).
 */
export function organizeSessions(
  records: readonly SessionRecord[],
  self: SessionRecord | null,
  reads: readonly PackageRead[],
  now: number,
  closedUnread = 0,
  segment = DEFAULT_SEGMENT,
): { rows: SessionRow[]; closed: number; orphans: { key: string; doc: ProgressDoc }[] } {
  const docs = docsByPackage(reads, segment)
  const byId = new Map<string, SessionRecord>()
  for (const r of records) byId.set(r.id, r)
  if (self) byId.set(self.id, self)
  const rows: SessionRow[] = []
  let closed = closedUnread
  for (const rec of byId.values()) {
    const isSelf = rec.id === self?.id
    if (!isSelf && !isOpen(rec, now)) {
      closed++
      continue
    }
    const doc = rec.package ? (docs.get(rec.package) ?? null) : null
    // A subagent still running in the background is work going on, even between turns.
    const working = rec.busy || (rec.agents ?? []).some((a) => a.status === 'running')
    const status: SessionStatus = rec.decision || docWaits(doc) ? 'user' : working ? 'busy' : 'idle'
    rows.push({ rec, isSelf, doc, status })
  }
  const rank = (r: SessionRow): number => (r.status === 'user' ? 0 : r.isSelf ? 1 : 2)
  rows.sort((a, b) => rank(a) - rank(b) || Date.parse(b.rec.lastSeen) - Date.parse(a.rec.lastSeen))
  const bound = new Set(rows.map((r) => r.rec.package).filter((p): p is string => !!p))
  const orphans = [...docs.entries()]
    .filter(([key, d]) => !isComplete(d) && !bound.has(key))
    .map(([key, doc]) => ({ key, doc }))
    .sort((a, b) => Date.parse(b.doc.updatedAt) - Date.parse(a.doc.updatedAt))
  return { rows, closed, orphans }
}

/**
 * Band counter: what waits on the person in OTHER open sessions — DIFFERENT packages waiting on them (two sessions on one package count
 * once, this session's own package never: the band already says "WAITING ON YOU" for it), plus each session with a dialog open on them
 * whose package is not already counted.
 */
export function othersWaitingOnUser(
  records: readonly SessionRecord[],
  self: SessionRecord | null,
  reads: readonly PackageRead[],
  now: number,
  segment = DEFAULT_SEGMENT,
): number {
  const docs = docsByPackage(reads, segment)
  const keys = new Set<string>()
  for (const r of records) {
    if (r.id === self?.id || !isOpen(r, now)) continue
    if (r.package && r.package !== self?.package && docWaits(docs.get(r.package))) keys.add(`p:${r.package}`)
    else if (r.decision) keys.add(`s:${r.id}`)
  }
  return keys.size
}

/** One announcement for another session that just started waiting on the person: a dialog, or its package's decision. */
export type WaitingAlert = { rec: SessionRecord; decision: Decision | null; doc: ProgressDoc | null }

/**
 * Other open sessions that started waiting on the person since the last pass (`seen`: session id → [dialog key, package key] last seen). A dialog is
 * announced once per opening (its `since`); a package's decision once per decision, never for this session's own package (its own
 * notifications tell it) and once per package when several sessions share it. `seen === null` is the first pass: nothing is announced,
 * only remembered (what was already waiting before this session looked is not news).
 */
export function waitingAlerts(
  records: readonly SessionRecord[],
  self: SessionRecord | null,
  reads: readonly PackageRead[],
  now: number,
  seen: Readonly<Record<string, readonly [string, string]>> | null,
  segment = DEFAULT_SEGMENT,
): { alerts: WaitingAlert[]; seen: Record<string, [string, string]> } {
  const docs = docsByPackage(reads, segment)
  const next: Record<string, [string, string]> = {}
  const alerts: WaitingAlert[] = []
  const told = new Set<string>()
  for (const rec of records) {
    if (rec.id === self?.id || !isOpen(rec, now)) continue
    const raw = rec.package ? docs.get(rec.package) : undefined
    const doc = rec.package && rec.package !== self?.package && docWaits(raw) ? raw : null
    const dKey = rec.decision ? `${rec.decision.kind}|${rec.decision.tool}|${rec.decision.since}` : ''
    const pKey = doc ? `${rec.package}|${waitingWhat(doc)}` : ''
    next[rec.id] = [dKey, pKey]
    if (seen === null) continue
    const [prevD, prevP] = seen[rec.id] ?? ['', '']
    const newDecision = !!dKey && dKey !== prevD
    const newDoc = !!pKey && pKey !== prevP && !told.has(pKey)
    if (newDoc) told.add(pKey)
    if (newDecision || newDoc) alerts.push({ rec, decision: newDecision ? rec.decision ?? null : null, doc: newDoc ? doc : null })
  }
  return { alerts, seen: next }
}
