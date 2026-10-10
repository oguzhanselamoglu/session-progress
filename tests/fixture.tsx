import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { ProgressDoc, SessionRecord } from '../types'

export const NOW = Date.parse('2026-10-08T15:00:00Z')
export const pkg = (root: string, name: string): string => `${root}/docs/packages/${name}/progress.json`
export const sessionFile = (id: string, root = '/repo'): string => `${root}/.git/session-progress/sessions/${id}.json`
/** The project settings most tests run with: packages under `docs/packages`. */
export const PROJECT_CONFIG = JSON.stringify({ packagesDir: 'docs/packages' })
/** A plugin store in which the person chose Turkish (for tests that want Turkish texts; the default store is empty → English). */
export const TR_STORE = { language: 'tr' }

export function doc(over: Partial<ProgressDoc> = {}): ProgressDoc {
  return {
    schema: 'session-progress-v1',
    package: 'checkout-redesign',
    title: 'Checkout redesign',
    updatedAt: '2026-10-08T14:00:00Z',
    phases: [
      { id: 'analysis', title: 'Plan', status: 'done', owner: 'claude' },
      { id: 'impl', title: 'Build', status: 'active', owner: 'qa' },
      { id: 'audit', title: 'Review', status: 'pending' },
    ],
    waitingOn: null,
    ...over,
  }
}

/** Another session's record file (for panel and counter tests). */
export function session(over: Partial<SessionRecord> & { id: string }): SessionRecord {
  return {
    schema: 'session-progress-session-v1',
    label: null,
    snippet: null,
    cwd: '/repo',
    checkout: null,
    startedAt: '2026-10-08T14:00:00Z',
    lastSeen: '2026-10-08T14:59:30Z',
    busy: false,
    ended: false,
    package: null,
    bindSource: null,
    ...over,
  }
}

export type FakeRepo = {
  toasts: string[]
  /** A "tool" writing a file: content + a new modification time (Bash binding tests). */
  touch(path: string, text: string): void
  /** Set a file's modification time by hand (stale record tests). */
  age(path: string, mtimeMs: number): void
  /** This session's record file (written by the plugin through `$.fs.write`), parsed. */
  self(): SessionRecord | null
}

/**
 * Fake repository — `files` is a LIVE object: a test can add and change files later (folders are derived again on every call). Answers
 * the engine's lower layer (fs + writes, session, commands, pane opening, turn start/end, tool calls, rendering); `toasts` collects
 * notifications.
 */
export function fakeRepo(
  on: On,
  files: Record<string, string>,
  opts: {
    sessionId?: string | null
    onTool?: (e: Record<string, unknown>, repo: FakeRepo) => void
    /** The tool call's result (default: success). */
    toolResult?: Record<string, unknown>
    /** `$.fs` call counter (cost tests). */
    counter?: { n: number }
    /** The repository has NO `docs/packages` folder (a project that does not use it) — default: it has one. */
    bare?: boolean
    /** `.claude/session-progress.json` content; `null` → no file (plugin defaults). Default: `PROJECT_CONFIG`. */
    config?: string | null
    /** Names the plugin registers as commands, collected. */
    commands?: string[]
    /** The plugin's `$.store` (live; the test reads what it wrote). Default: empty (English). */
    store?: Record<string, unknown>
    /** A changeable session id (the id changes after `/clear`). */
    idRef?: { id: string }
  } = {},
): FakeRepo {
  if (!opts.bare) files['/repo/docs/packages/README.md'] ??= '# packages'
  const config = opts.config === undefined ? PROJECT_CONFIG : opts.config
  if (config !== null) files['/repo/.claude/session-progress.json'] ??= config
  const toasts: string[] = []
  const mtime: Record<string, number> = {}
  // Modification times on the real clock scale: a file without a hand-set time counts as written "now" (the stale record rule reads mtime).
  let clock = NOW
  const mtimeOf = (path: string): number => mtime[path] ?? NOW
  const count = (): void => {
    if (opts.counter) opts.counter.n++
  }
  const sid = opts.sessionId === undefined ? 'self-1' : opts.sessionId
  const dirs = (): Set<string> => {
    const out = new Set<string>(['/repo/.git'])
    for (const p of Object.keys(files)) {
      const parts = p.split('/')
      for (let i = 2; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
    }
    return out
  }
  const isFile = (p: string): boolean => p in files
  const store = opts.store ?? {}
  on('store.get', ($, e) => ({ value: store[e.key] }) as never)
  on('store.set', ($, e) => {
    store[e.key] = e.value
    return { value: undefined } as never
  })
  on('session.cwd', () => ({ value: '/repo' }) as never)
  // sessionId: null → the engine cannot give a session id (robustness test)
  if (sid !== null) on('session.id', () => ({ value: opts.idRef?.id ?? sid }) as never)
  on('fs.exists', ($, e) => {
    count()
    return { value: isFile(e.path) || dirs().has(e.path) } as never
  })
  on('fs.stat', ($, e) => {
    count()
    if (!isFile(e.path) && !dirs().has(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: isFile(e.path) ? 'file' : 'dir', size: 0, mtimeMs: mtimeOf(e.path), isLink: false } } as never
  })
  on('fs.read', ($, e) => {
    count()
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text } as never
  })
  on('fs.write', ($, e) => {
    count()
    files[e.path] = e.text
    mtime[e.path] = clock++
    return { value: undefined } as never
  })
  on('fs.list', ($, e) => {
    count()
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const p of [...Object.keys(files), ...dirs()]) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0] ?? '')
    return {
      value: [...names].filter(Boolean).map((name) => ({ name, kind: isFile(`${prefix}${name}`) ? 'file' : 'dir', size: 0, mtimeMs: mtimeOf(`${prefix}${name}`), isLink: false })),
    } as never
  })
  on('command.register', ($, e) => {
    opts.commands?.push(e.name)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/repo' }) as never)
  on('session.end', () => ({ sessionId: sid ?? '' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: 'ok' }) as never)
  on('tool.call', ($, e) => {
    opts.onTool?.(e as unknown as Record<string, unknown>, repo)
    return (opts.toolResult ?? { result: 'ok' }) as never
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-own" />
  })
  const repo: FakeRepo = {
    toasts,
    touch(path, text) {
      files[path] = text
      mtime[path] = clock++
    },
    age(path, mtimeMs) {
      mtime[path] = mtimeMs
    },
    self() {
      const text = sid === null ? undefined : files[sessionFile(sid)]
      return text ? (JSON.parse(text) as SessionRecord) : null
    },
  }
  return repo
}

export async function start($: Engine): Promise<void> {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
}

export async function turnStart($: Engine, text = 'hello', id = 't'): Promise<void> {
  await $.turn.start({ text, turnId: id } as never)
}

export async function turnComplete($: Engine, id = 't'): Promise<void> {
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer', turnId: id } as never)
}

/** The session writing a package's progress.json with its OWN `Write` tool → automatic binding. */
export async function writeProgress($: Engine, files: Record<string, string>, path: string, d: ProgressDoc): Promise<void> {
  files[path] = JSON.stringify(d)
  await $.tool.call({ tool: 'Write', file_path: path, content: files[path] } as never)
}

export const BAND = { plugin: 'session-progress', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as const
export const PANE = { plugin: 'session-progress', component: 'Pane', requestId: 'session-progress', props: {} } as const
export const SESSIONS = { plugin: 'session-progress', component: 'Pane', requestId: 'session-progress-sessions', props: {} } as const
