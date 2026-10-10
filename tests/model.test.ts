import { expect, test } from 'claude-code/testing'

import type { ProgressDoc } from '../types'
import {
  bar,
  currentPhase,
  duration,
  focusOf,
  isStale,
  mainRootFromGitFile,
  organize,
  parseDoc,
  progressOf,
  signature,
  transitions,
  waitingWho,
  worktreeRootFromGitdir,
} from '../hooks/model'
import { DICTS } from '../hooks/i18n'

const NOW = Date.parse('2026-10-08T15:00:00+03:00')

function doc(over: Partial<ProgressDoc> = {}): ProgressDoc {
  return {
    schema: 'session-progress-v1',
    package: 'package-a',
    title: 'Package A',
    updatedAt: '2026-10-08T14:30:00+03:00',
    phases: [
      { id: 'analysis', title: 'Plan', status: 'done', startedAt: '2026-10-08T10:00:00+03:00', finishedAt: '2026-10-08T10:25:00+03:00' },
      { id: 'impl', title: 'Build', status: 'active', owner: 'qa', startedAt: '2026-10-08T11:00:00+03:00' },
      { id: 'audit', title: 'Review', status: 'pending' },
      { id: 'merge', title: 'Ship', status: 'skipped' },
    ],
    ...over,
  }
}

test('schema: a valid document is accepted, a missing or wrong field is rejected with its path', async () => {
  expect('doc' in parseDoc(JSON.stringify(doc()))).toBe(true)
  const bad = (o: unknown): string => {
    const r = parseDoc(JSON.stringify(o), DICTS.en)
    return 'error' in r ? r.error : ''
  }
  expect(bad({ ...doc(), schema: 'x' })).toMatch(/schema/)
  expect(bad({ ...doc(), phases: [] })).toMatch(/phases/)
  expect(bad({ ...doc(), phases: [{ id: 'a', title: 'A', status: 'finished' }] })).toMatch(/phases\[0\]\.status/)
  expect(bad({ ...doc(), phases: [{ id: 'a', title: 'A', status: 'done' }, { id: 'a', title: 'B', status: 'done' }] })).toMatch(/repeated/)
  expect(bad({ ...doc(), waitingOn: { who: '', what: 'x' } })).toMatch(/waitingOn/)
  expect(bad({ ...doc(), phases: [{ id: 'a', title: 'A', status: 'done', owner: '' }] })).toMatch(/owner/)
  // The owner is free text: project-specific roles ('reviewer', 'qa') are valid. Other schema names only when the project lists them.
  expect('doc' in parseDoc(JSON.stringify(doc({ waitingOn: { who: 'reviewer', what: 'x' } })))).toBe(true)
  expect('doc' in parseDoc(JSON.stringify({ ...doc(), schema: 'legacy-progress-v1' }), DICTS.en, ['legacy-progress-v1'])).toBe(true)
  expect(bad({ ...doc(), schema: 'legacy-progress-v1' }), 'not listed → rejected').toMatch(/schema/)
  expect(bad({ ...doc(), audits: [{ round: 1 }] })).toMatch(/audits\[0\]/)
  const broken = parseDoc('{ broken', DICTS.en)
  expect('error' in broken && broken.error).toMatch(/JSON could not be read/)
})

test('progress: done + skipped count; the current phase and who is waited on', async () => {
  const d = doc()
  expect(progressOf(d)).toEqual({ done: 2, total: 4, percent: 50 })
  expect(currentPhase(d)?.id).toBe('impl')
  expect(waitingWho(d)).toBe('qa')
  expect(waitingWho(doc({ waitingOn: { who: 'user', what: 'review round 3' } }))).toBe('user')
  const waitingUser = doc({ phases: [{ id: 'g1', title: 'Plan approval', status: 'waiting-user' }] })
  expect(waitingWho(waitingUser)).toBe('user')
  expect(bar(50, 10)).toBe('█████░░░░░')
  expect(bar(0, 4)).toBe('░░░░')
  expect(bar(100, 4)).toBe('████')
})

test('duration format and staleness', async () => {
  expect(duration(30_000)).toBe('<1m')
  expect(duration(45 * 60_000)).toBe('45m')
  expect(duration(134 * 60_000, DICTS.tr)).toBe('2sa 14dk') // Turkish units stay covered
  expect(duration(2 * 24 * 60 * 60_000)).toBe('2d')
  expect(duration(134 * 60_000)).toBe('2h 14m')
  expect(duration((3 * 24 * 60 + 120) * 60_000)).toBe('3d 2h')
  expect(isStale(doc(), NOW)).toBe(false)
  expect(isStale(doc({ updatedAt: '2026-10-08T10:00:00+03:00' }), NOW)).toBe(true)
  const finished = doc({ updatedAt: '2026-10-01T10:00:00+03:00', phases: [{ id: 'a', title: 'A', status: 'done' }] })
  expect(isStale(finished, NOW)).toBe(false) // a finished package is never stale
})

test('de-duplication: the same package in two checkouts → the newest wins; active/completed/error split; focus', async () => {
  const older = doc({ updatedAt: '2026-10-08T12:00:00+03:00' })
  const newer = doc({ updatedAt: '2026-10-08T14:00:00+03:00', title: 'Package A (new)' })
  const done = doc({ package: 'package-b', title: 'B', phases: [{ id: 'a', title: 'A', status: 'done' }] })
  const r = organize([
    { ok: true, path: '/main/p.json', root: '/main', doc: older },
    { ok: true, path: '/wt/p.json', root: '/wt', doc: newer },
    { ok: true, path: '/main/b.json', root: '/main', doc: done },
    { ok: false, path: '/main/c.json', root: '/main', error: 'broken' },
  ])
  expect(r.active.map((x) => x.doc.title)).toEqual(['Package A (new)'])
  expect(r.completed.map((x) => x.doc.package)).toEqual(['package-b'])
  expect(r.errors).toHaveLength(1)
  const c = doc({ package: 'package-c', updatedAt: '2026-10-08T14:50:00+03:00' })
  const active = [{ root: '/wt2', doc: c }, { root: '/wt', doc: newer }]
  expect(focusOf(active, '/wt')?.root).toBe('/wt') // the session's own checkout first
  expect(focusOf(active, '/elsewhere')?.root).toBe('/wt2') // otherwise the most recently updated
  expect(focusOf([], '/wt')).toBeNull()
})

test('notification transitions: silent on first sight, a newly finished phase and "waiting on you" once each', async () => {
  const d0 = doc()
  expect(transitions(d0, undefined)).toEqual([])
  const sig0 = signature(d0)
  expect(transitions(d0, sig0)).toEqual([])
  const d1 = doc({
    waitingOn: { who: 'user', what: 'review round 3' },
    phases: [...doc().phases.slice(0, 1), { id: 'impl', title: 'Build', status: 'done' }, ...doc().phases.slice(2)],
  })
  const ev = transitions(d1, sig0, false, DICTS.en)
  expect(ev).toHaveLength(2)
  expect(ev[0]).toMatch(/Build done/)
  expect(ev[1]).toMatch(/waiting on you — review round 3/)
  expect(transitions(d1, signature(d1))).toEqual([]) // the same state is not reported again
})

test('git discovery: main root from a worktree .git file; worktree root from a gitdir file', async () => {
  expect(mainRootFromGitFile('/main', null)).toBe('/main')
  expect(mainRootFromGitFile('/w/feature-x', 'gitdir: /home/dev/acme-app/.git/worktrees/feature-x\n')).toBe('/home/dev/acme-app')
  expect(mainRootFromGitFile('/w/feature-x', 'garbage')).toBe('/w/feature-x')
  expect(worktreeRootFromGitdir('/home/dev/acme-app-worktrees/feature-x/.git\n')).toBe('/home/dev/acme-app-worktrees/feature-x')
  expect(worktreeRootFromGitdir('garbage')).toBeNull()
})
