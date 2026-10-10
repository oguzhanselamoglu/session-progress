// Pure core (sessions): record validation, package from a tool call, openness, labels, panel ordering. Never touches `$`.
import type { PackageRead, ProgressDoc, SessionRecord } from '../types'
import { isComplete, waitingWho } from './model'

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
  return { ...(raw as SessionRecord), checkout: (raw.checkout as string | null | undefined) ?? null }
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
  }
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
    const status: SessionStatus = doc && !isComplete(doc) && waitingWho(doc) === 'user' ? 'user' : rec.busy ? 'busy' : 'idle'
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
 * Band counter: DIFFERENT packages bound to other open sessions that wait on the person — two sessions on one package count once,
 * this session's own package never (the band already says "WAITING ON YOU" for it).
 */
export function othersWaitingOnUser(
  records: readonly SessionRecord[],
  self: SessionRecord | null,
  reads: readonly PackageRead[],
  now: number,
  segment = DEFAULT_SEGMENT,
): number {
  const docs = docsByPackage(reads, segment)
  const pkgs = new Set<string>()
  for (const r of records) {
    if (r.id === self?.id || !isOpen(r, now) || !r.package || r.package === self?.package) continue
    const d = docs.get(r.package)
    if (d && !isComplete(d) && waitingWho(d) === 'user') pkgs.add(r.package)
  }
  return pkgs.size
}
