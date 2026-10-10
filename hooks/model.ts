// Pure core: schema validation, progress, status → icon/colour, durations, staleness, ordering. Never touches `$` (unit tests call it).
import type { Audit, Owner, PackageRead, Phase, PhaseStatus, ProgressDoc } from '../types'
import { DICTS, type Dict } from './i18n'

const EN = DICTS.en

export const STATUSES: readonly PhaseStatus[] = ['pending', 'active', 'waiting-user', 'waiting-external', 'blocked', 'done', 'skipped']
/** The `schema` value; a project may accept older names too (`schemaAliases` in its config). */
export const SCHEMA = 'session-progress-v1'
/** An unfinished package not updated for this long gets a "stale" warning. */
export const STALE_MS = 3 * 60 * 60 * 1000

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isTime = (v: unknown): boolean => v === undefined || (typeof v === 'string' && !Number.isNaN(Date.parse(v)))
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isMetrics = (v: unknown): boolean =>
  isObj(v) && Object.values(v).every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)))

/** Validates a document: `null` when valid, otherwise a short description of the first error (with its path). */
export function validate(raw: unknown, d: Dict = EN, aliases: readonly string[] = []): string | null {
  if (!isObj(raw)) return d.v.notObject
  if (raw.schema !== SCHEMA && !aliases.includes(raw.schema as string)) return d.v.schema(JSON.stringify(raw.schema))
  if (!isStr(raw.package)) return d.v.missing('package')
  if (!isStr(raw.title)) return d.v.missing('title')
  if (!isStr(raw.updatedAt) || !isTime(raw.updatedAt)) return d.v.badDate('updatedAt')
  if (!Array.isArray(raw.phases) || raw.phases.length === 0) return d.v.phasesEmpty
  const ids = new Set<string>()
  for (let i = 0; i < raw.phases.length; i++) {
    const p = raw.phases[i]
    const at = `phases[${i}]`
    if (!isObj(p)) return d.v.notObj(at)
    if (!isStr(p.id)) return d.v.missing(`${at}.id`)
    if (ids.has(p.id)) return d.v.duplicateId(at, p.id)
    ids.add(p.id)
    if (!isStr(p.title)) return d.v.missing(`${at}.title`)
    if (!STATUSES.includes(p.status as PhaseStatus)) return d.v.badStatus(at, String(p.status))
    if (p.owner !== undefined && !isStr(p.owner)) return d.v.badOwner(at)
    if (!isTime(p.startedAt) || !isTime(p.finishedAt)) return d.v.badDates(at)
    if (p.note !== undefined && typeof p.note !== 'string') return d.v.noteText(at)
    if (p.refs !== undefined && !isStrArray(p.refs)) return d.v.refsList(at)
    if (p.metrics !== undefined && !isMetrics(p.metrics)) return d.v.metricsMap(at)
  }
  if (raw.audits !== undefined) {
    if (!Array.isArray(raw.audits)) return d.v.auditsList
    for (let i = 0; i < raw.audits.length; i++) {
      const a = raw.audits[i]
      if (!isObj(a) || typeof a.round !== 'number' || !isStr(a.by) || !isStr(a.verdict)) return d.v.auditFields(i)
      if (a.findings !== undefined && typeof a.findings !== 'string') return d.v.auditFindings(i)
      if (a.closedBy !== undefined && !isStrArray(a.closedBy)) return d.v.auditClosedBy(i)
      if (!isTime(a.at)) return d.v.auditAt(i)
    }
  }
  if (raw.waitingOn !== undefined && raw.waitingOn !== null) {
    const w = raw.waitingOn
    if (!isObj(w) || !isStr(w.who) || !isStr(w.what)) return d.v.waitingOn
  }
  return null
}

/** Parses and validates a text. */
export function parseDoc(text: string, d: Dict = EN, aliases: readonly string[] = []): { doc: ProgressDoc } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { error: d.v.json((e as Error).message) }
  }
  const error = validate(raw, d, aliases)
  return error ? { error } : { doc: raw as ProgressDoc }
}

const FINISHED: ReadonlySet<PhaseStatus> = new Set(['done', 'skipped'])

export function progressOf(doc: ProgressDoc): { done: number; total: number; percent: number } {
  const total = doc.phases.length
  const done = doc.phases.filter((p) => FINISHED.has(p.status)).length
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

export const isComplete = (doc: ProgressDoc): boolean => doc.phases.every((p) => FINISHED.has(p.status))

/** The current phase: the first unfinished one that is not `pending`; else the first unfinished; `null` when all are finished. */
export function currentPhase(doc: ProgressDoc): Phase | null {
  return doc.phases.find((p) => !FINISHED.has(p.status) && p.status !== 'pending') ?? doc.phases.find((p) => !FINISHED.has(p.status)) ?? null
}

/**
 * Who is being waited on. Any `waiting-user` phase means the person (a decision on them matters most, even when `waitingOn` names
 * someone else), else the explicit `waitingOn`, else the current phase's owner.
 */
export function waitingWho(doc: ProgressDoc): Owner | null {
  if (doc.phases.some((p) => p.status === 'waiting-user')) return 'user'
  if (doc.waitingOn) return doc.waitingOn.who
  return currentPhase(doc)?.owner ?? null
}

/** The decision waiting on the person: `waitingOn.what` when it names the user, else the `waiting-user` phase's title. */
export function waitingWhat(doc: ProgressDoc): string {
  if (doc.waitingOn?.who === 'user') return doc.waitingOn.what
  return doc.phases.find((p) => p.status === 'waiting-user')?.title ?? doc.waitingOn?.what ?? currentPhase(doc)?.title ?? ''
}

export function bar(percent: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** `2h 14m`, `45m`, `3d 2h`, `<1m` (units from the dictionary). */
export function duration(ms: number, t: Dict = EN): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60000)
  const u = t.dur
  if (min < 1) return u.lessThanMinute
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return h > 0 ? `${d}${u.d} ${h}${u.h}` : `${d}${u.d}`
  if (h > 0) return m > 0 ? `${h}${u.h} ${m}${u.m}` : `${h}${u.h}`
  return `${m}${u.m}`
}

/** A phase's duration: start→finish when finished, start→now while running; empty without a start. */
export function phaseDuration(p: Phase, now: number, t: Dict = EN): string {
  if (!p.startedAt) return ''
  const start = Date.parse(p.startedAt)
  const end = p.finishedAt ? Date.parse(p.finishedAt) : FINISHED.has(p.status) ? NaN : now
  return Number.isNaN(end) ? '' : duration(end - start, t)
}

/** Time since the package started (from the first start; to the last finish once complete). */
export function packageElapsed(doc: ProgressDoc, now: number, t: Dict = EN): string {
  const starts = doc.phases.map((p) => (p.startedAt ? Date.parse(p.startedAt) : NaN)).filter((n) => !Number.isNaN(n))
  if (starts.length === 0) return ''
  const first = Math.min(...starts)
  if (!isComplete(doc)) return duration(now - first, t)
  const ends = doc.phases.map((p) => (p.finishedAt ? Date.parse(p.finishedAt) : NaN)).filter((n) => !Number.isNaN(n))
  return ends.length ? duration(Math.max(...ends) - first, t) : ''
}

/** Is an unfinished package's last update older than `STALE_MS`? */
export const isStale = (doc: ProgressDoc, now: number): boolean => !isComplete(doc) && now - Date.parse(doc.updatedAt) > STALE_MS

export type Tone = 'success' | 'subtle' | 'claude' | 'warning' | 'permission' | 'error' | 'inactive'
export const STATUS_VIEW: Record<PhaseStatus, { icon: string; tone: Tone }> = {
  done: { icon: '✓', tone: 'success' },
  skipped: { icon: '–', tone: 'subtle' },
  active: { icon: '●', tone: 'claude' },
  'waiting-user': { icon: '⏸', tone: 'warning' },
  'waiting-external': { icon: '⧗', tone: 'permission' },
  blocked: { icon: '✗', tone: 'error' },
  pending: { icon: '○', tone: 'inactive' },
}

/** Display name of an owner: `user` is "YOU", others the project's `ownerLabels` entry or the label itself. */
export function ownerLabel(owner: Owner, t: Dict = EN, labels: Readonly<Record<string, string>> = {}): string {
  return owner === 'user' ? t.you : (labels[owner] ?? owner)
}

/** Verdict words in either language: clean/pass → green, fail/issues → red, warn/caution → amber. */
export function verdictTone(verdict: string): Tone {
  // Both casings: Turkish upper-cases `i` to `İ` ("fail" → "FAİL"), the default one keeps English words matchable.
  const v = `${verdict.toUpperCase()} ${verdict.toLocaleUpperCase('tr')}`
  if (/TEMİZ|BAŞARILI|CLEAN|PASS|APPROVED|\bOK\b/.test(v)) return 'success'
  if (/SORUNLU|FAIL|ISSUES|REJECT|BLOCK/.test(v)) return 'error'
  if (/DİKKAT|WARN|CAUTION|CONCERN/.test(v)) return 'warning'
  return 'subtle'
}

export const auditLine = (a: Audit, t: Dict = EN): string =>
  `${t.auditLine(a.round, a.by, a.verdict)}${a.findings ? ` · ${a.findings}` : ''}${a.closedBy?.length ? ` → ${a.closedBy.join(', ')}` : ''}`

/**
 * De-duplicates reads by package name (the same package in the main checkout and a worktree → the newest `updatedAt` wins), then
 * splits them: active (most recently updated first), completed, broken.
 */
export function organize(reads: readonly PackageRead[]): {
  active: Extract<PackageRead, { ok: true }>[]
  completed: Extract<PackageRead, { ok: true }>[]
  errors: Extract<PackageRead, { ok: false }>[]
} {
  const byName = new Map<string, Extract<PackageRead, { ok: true }>>()
  const errors: Extract<PackageRead, { ok: false }>[] = []
  for (const r of reads) {
    if (!r.ok) {
      errors.push(r)
      continue
    }
    const prev = byName.get(r.doc.package)
    if (!prev || Date.parse(r.doc.updatedAt) > Date.parse(prev.doc.updatedAt)) byName.set(r.doc.package, r)
  }
  const all = [...byName.values()].sort((a, b) => Date.parse(b.doc.updatedAt) - Date.parse(a.doc.updatedAt))
  return {
    active: all.filter((r) => !isComplete(r.doc)),
    completed: all.filter((r) => isComplete(r.doc)),
    errors,
  }
}

/** The focused package: the active package in the session's checkout, else the most recently updated active package. */
export function focusOf<T extends { root: string }>(active: readonly T[], cwdRoot: string | null): T | null {
  return active.find((r) => cwdRoot !== null && r.root === cwdRoot) ?? active[0] ?? null
}

/** State signature for notifications (who waits + finished phases). */
export function signature(doc: ProgressDoc): string {
  return `${waitingWho(doc) === 'user' ? 'user' : '-'}|${doc.phases.filter((p) => p.status === 'done').map((p) => p.id).join(',')}`
}

/**
 * Events to notify. Without `previous` the package is seen for the first time: at the session's first scan (`appearedMidSession`
 * false) its history is NOT announced; a package that appears later in the session is announced once if it waits on the person.
 */
export function transitions(doc: ProgressDoc, previous: string | undefined, appearedMidSession = false, t: Dict = EN): string[] {
  if (previous === undefined) {
    return appearedMidSession && waitingWho(doc) === 'user' ? [t.n.waiting(doc.title, waitingWhat(doc))] : []
  }
  const [prevWho, prevDone = ''] = previous.split('|')
  const prevSet = new Set(prevDone ? prevDone.split(',') : [])
  const out: string[] = []
  for (const p of doc.phases) if (p.status === 'done' && !prevSet.has(p.id)) out.push(t.n.phaseDone(doc.title, p.title))
  if (waitingWho(doc) === 'user' && prevWho !== 'user') out.push(t.n.waiting(doc.title, waitingWhat(doc)))
  return out
}

/** Main repository root from `<root>/.git`: a file `gitdir: <main>/.git/worktrees/<name>` gives `<main>`, a folder the root itself. */
export function mainRootFromGitFile(root: string, gitFileText: string | null): string {
  if (gitFileText === null) return root
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(gitFileText)
  const gitdir = m?.[1]?.replace(/\\/g, '/')
  if (!gitdir) return root
  const idx = gitdir.lastIndexOf('/.git/worktrees/')
  return idx >= 0 ? gitdir.slice(0, idx) : root
}

/** `.git/worktrees/<name>/gitdir` content (`<worktree>/.git`) → the worktree root. */
export function worktreeRootFromGitdir(text: string): string | null {
  const line = text.trim().replace(/\\/g, '/')
  return line.endsWith('/.git') ? line.slice(0, -'/.git'.length) : null
}
