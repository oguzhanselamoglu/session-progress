import { expect, mock, test } from 'claude-code/testing'

import { decisionFor, organizeSessions, othersWaitingOnUser, parseSession, waitingAlerts } from '../hooks/sessions'
import type { PackageRead } from '../types'
import { BAND, NOW, SESSIONS, TR_STORE, doc, fakeRepo, pkg, session, sessionFile, start, turnComplete, turnStart, writeProgress } from './fixture'

const SEG = 'packages'
const SINCE = '2026-10-08T14:59:40Z'
const bashPrompt = decisionFor('Bash', SINCE)
const waitingUser = { who: 'user', what: 'Plan approval' } as const
const read = (name: string, over = {}): PackageRead => ({ ok: true, root: '/r', path: `/r/docs/packages/${name}/progress.json`, doc: doc({ package: name, title: name, ...over }) })

// ── Pure core ───────────────────────────────────────────────────────────────────────────────────────────────
test('decision: the tool names the kind; a record without one (0.3.x) or with a malformed one still reads, as none', () => {
  expect(decisionFor('Bash', SINCE)).toEqual({ kind: 'permission', tool: 'Bash', since: SINCE })
  expect(decisionFor('AskUserQuestion', SINCE).kind).toBe('question')
  expect(decisionFor('ExitPlanMode', SINCE).kind).toBe('plan')
  const { decision: _none, ...old } = session({ id: 'old' })
  expect(parseSession(JSON.stringify(old))?.decision, 'an older record').toBeNull()
  expect(parseSession(JSON.stringify({ ...old, decision: { kind: 'x', tool: 'Bash', since: SINCE } }))?.decision, 'malformed: the session stays listed').toBeNull()
  expect(parseSession(JSON.stringify({ ...old, decision: bashPrompt }))?.decision).toEqual(bashPrompt)
})

test('panel order and counter: a session with a dialog open waits on you even without a package; counted once with its own waiting package', () => {
  const me = session({ id: 'me', package: 'a', busy: true })
  const records = [
    session({ id: 'idle' }),
    session({ id: 'prompt', decision: bashPrompt, lastSeen: '2026-10-08T14:58:00Z' }),
    session({ id: 'both', package: 'b', decision: bashPrompt }),
    session({ id: 'closed', decision: bashPrompt, ended: true }),
  ]
  const reads = [read('a'), read('b', { waitingOn: waitingUser })]
  const { rows } = organizeSessions(records, me, reads, NOW, 0, SEG)
  expect(rows.map((r) => [r.rec.id, r.status])).toEqual([['both', 'user'], ['prompt', 'user'], ['me', 'busy'], ['idle', 'idle']])
  expect(othersWaitingOnUser(records, me, reads, NOW, SEG), 'package b + the prompt session; a closed session never').toBe(2)
  expect(othersWaitingOnUser(records, { ...me, decision: bashPrompt }, reads, NOW, SEG), 'this session\'s own dialog is not counted').toBe(2)
})

test('alerts: silent at the first pass; once per dialog opening; this session\'s package never; a shared package once', () => {
  const me = session({ id: 'me', package: 'mine' })
  const reads = [read('mine', { waitingOn: waitingUser }), read('shared', { waitingOn: waitingUser })]
  const others = [session({ id: 'p' }), session({ id: 's1', package: 'shared' }), session({ id: 's2', package: 'shared' }), session({ id: 'm', package: 'mine' })]
  const first = waitingAlerts(others, me, reads, NOW, null, SEG)
  expect(first.alerts, 'what already waited is no news').toEqual([])

  const withPrompt = others.map((r) => (r.id === 'p' ? { ...r, decision: bashPrompt } : r))
  const second = waitingAlerts(withPrompt, me, reads, NOW, first.seen, SEG)
  expect(second.alerts.map((a) => [a.rec.id, a.decision?.tool ?? null, a.doc?.title ?? null])).toEqual([['p', 'Bash', null]])
  expect(waitingAlerts(withPrompt, me, reads, NOW, second.seen, SEG).alerts, 'the same dialog is told once').toEqual([])

  const again = withPrompt.map((r) => (r.id === 'p' ? { ...r, decision: decisionFor('Bash', '2026-10-08T14:59:55Z') } : r))
  expect(waitingAlerts(again, me, reads, NOW, second.seen, SEG).alerts.length, 'a new dialog is told again').toBe(1)

  const fresh = waitingAlerts(others, me, reads, NOW, {}, SEG)
  expect(fresh.alerts.map((a) => a.rec.id), 'shared package told once; this session\'s own package (m) never').toEqual(['s1'])
})

// ── Hooks ───────────────────────────────────────────────────────────────────────────────────────────────────
test('permission prompt: in the record at once (tool name only, never its input), the hook does not answer; closed when that tool\'s call ends', async ($, on) => {
  mock.clock(on, { now: NOW })
  const repo = fakeRepo(on, {})
  await start($)
  const answer = await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'cat secret.env' } } as never)
  expect(answer, 'observe only: no decision is made for the person').toEqual({})
  expect(repo.self()?.decision).toMatchObject({ kind: 'permission', tool: 'Bash' })
  expect(JSON.stringify(repo.self()), 'the command never reaches the record').not.toMatch(/secret/)
  await $.tool.call({ tool: 'Read', file_path: '/repo/x' } as never)
  expect(repo.self()?.decision, 'another tool ending leaves the prompt open').not.toBeNull()
  await $.tool.call({ tool: 'Bash', command: 'cat secret.env' } as never)
  expect(repo.self()?.decision).toBeNull()
})

test('question and plan approval: open for the whole call, closed after; a turn ending closes a dialog whose end was never seen', async ($, on) => {
  mock.clock(on, { now: NOW })
  const during: unknown[] = []
  const repo = fakeRepo(on, {}, { onTool: (e, r) => during.push(e.tool === 'Bash' ? null : r.self()?.decision?.kind) })
  await start($)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.tool.call({ tool: 'ExitPlanMode', plan: 'x' } as never)
  expect(during).toEqual(['question', 'plan'])
  expect(repo.self()?.decision).toBeNull()
  await turnStart($)
  await $.classic.PermissionRequest({ tool_name: 'Edit', tool_input: {} } as never)
  expect(repo.self()?.decision?.tool).toBe('Edit')
  await turnComplete($)
  expect(repo.self()?.decision).toBeNull()
})

test('another session\'s dialog: one toast in this session (silent for what already waited), on the card and in the band counter', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [sessionFile('api')]: JSON.stringify(session({ id: 'api', label: 'API work', checkout: '/wt/api' })),
    [sessionFile('pre')]: JSON.stringify(session({ id: 'pre', label: 'Earlier', decision: bashPrompt })),
  }
  const repo = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  expect(repo.toasts, 'a dialog open before this session looked').toEqual([])
  repo.touch(sessionFile('api'), JSON.stringify(session({ id: 'api', label: 'API work', checkout: '/wt/api', decision: decisionFor('ExitPlanMode', SINCE) })))
  await turnComplete($)
  expect(repo.toasts).toEqual(['⏸ API work (api): waiting on you — plan approval'])
  await turnComplete($, 't2')
  expect(repo.toasts.length, 'told once').toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /\+2 waiting on you in other sessions/ })).toBeDefined()
  await band.unmount()
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^Waiting: plan approval$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Waiting: permission: Bash$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 waiting on you/ })).toBeDefined()
  await ui.unmount()
})

test('another session\'s package decision is told here too (Turkish)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkg('/repo', 'b')]: JSON.stringify(doc({ package: 'b', title: 'Paket B' })),
    [sessionFile('o')]: JSON.stringify(session({ id: 'o', label: 'Arama', package: 'b' })),
  }
  const repo = fakeRepo(on, files, { store: { ...TR_STORE } })
  await start($)
  files[pkg('/repo', 'b')] = JSON.stringify(doc({ package: 'b', title: 'Paket B', waitingOn: { who: 'user', what: 'Şema onayı' } }))
  await turnComplete($)
  expect(repo.toasts).toEqual(['⏸ Arama (repo): sende bekliyor — Paket B: Şema onayı'])
})
