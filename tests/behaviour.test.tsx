import { expect, mock, test } from 'claude-code/testing'

import { parseDoc } from '../hooks/model'
import { BAND, NOW, PANE, doc, fakeRepo, pkg, start, turnComplete, writeProgress } from './fixture'

const SURFACES = ['terminal', 'desktop'] as const
const waitingUser = { who: 'user', what: 'Plan approval' } as const

test('in a short window (24 rows) no pane section is cut: error on top, other active packages, completed, footer', async ($, on) => {
  mock.clock(on, { now: NOW })
  const phases = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, title: `Step ${i}`, status: i < 7 ? 'done' : 'pending' }) as const)
  fakeRepo(on, {
    [pkg('/repo', 'focus')]: JSON.stringify(doc({ package: 'focus', title: 'Focus', phases: [...phases], audits: [1, 2, 3].map((r) => ({ round: r, by: 'reviewer', verdict: 'MINOR' })) })),
    [pkg('/repo', 'parallel')]: JSON.stringify(doc({ package: 'parallel', title: 'Parallel', updatedAt: '2026-10-08T10:00:00Z' })),
    [pkg('/repo', 'finished')]: JSON.stringify(doc({ package: 'finished', title: 'Finished', phases: [{ id: 'a', title: 'A', status: 'done' }] })),
    [pkg('/repo', 'broken')]: '{"schema":"x"}',
  })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface, viewport: { columns: 100, rows: 24 } } as never)
    expect(await ui.find({ type: 'Text', text: /broken.*schema/ }), 'error line').toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Other active packages/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Completed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Read .*\/progress refresh/ })).toBeDefined()
    await ui.unmount()
  }
})

test('fields that deviate from the type file are rejected by the schema (with their path)', async () => {
  const bad = (over: Record<string, unknown>, at = 0): string => {
    const base = doc() as unknown as Record<string, unknown>
    const phases = (base['phases'] as Record<string, unknown>[]).map((p, i) => (i === at ? { ...p, ...over } : p))
    const r = parseDoc(JSON.stringify({ ...base, phases }))
    return 'error' in r ? r.error : ''
  }
  expect(bad({ refs: 5 })).toMatch(/phases\[0\]\.refs/)
  expect(bad({ refs: {} })).toMatch(/phases\[0\]\.refs/)
  expect(bad({ refs: 'abc' })).toMatch(/phases\[0\]\.refs/)
  expect(bad({ metrics: 'xy' })).toMatch(/phases\[0\]\.metrics/)
  expect(bad({ metrics: { a: { b: 1 } } })).toMatch(/phases\[0\]\.metrics/)
  expect(bad({ note: {} })).toMatch(/phases\[0\]\.note/)
  // A review round that deviates is left out with a warning naming it (the package itself is still read).
  const audit = (a: Record<string, unknown>): string => {
    const r = parseDoc(JSON.stringify({ ...doc(), audits: [{ round: 1, by: 'reviewer', verdict: 'APPROVED', ...a }] }))
    return 'doc' in r && r.doc.audits?.length === 0 ? (r.warning ?? '') : ''
  }
  expect(audit({ closedBy: 'abc' })).toMatch(/audits\[0\]\.closedBy/)
  expect(audit({ findings: 3 })).toMatch(/audits\[0\]\.findings/)
  expect(audit({ at: 'yesterday' })).toMatch(/audits\[0\]\.at/)
  expect('doc' in parseDoc(JSON.stringify(doc({ phases: [{ id: 'a', title: 'A', status: 'done', metrics: { tests: '412/0', n: 3 }, refs: ['abc'] }] })))).toBe(true)
})

test('a file with broken types does not take the pane down: an error line is drawn, the other packages are visible', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, {
    [pkg('/repo', 'healthy')]: JSON.stringify(doc({ package: 'healthy', title: 'Healthy' })),
    [pkg('/repo', 'faulty')]: JSON.stringify(doc({ package: 'faulty', title: 'Faulty', phases: [{ id: 'a', title: 'A', status: 'active', refs: 5 as never }] })),
  })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    expect(await ui.find({ key: 'engine-own' }), 'the plugin drew its own tree').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /faulty.*refs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Healthy/ })).toBeDefined()
    await ui.unmount()
  }
})

test('two concurrent turn ends report the same transition ONCE', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'a')]: JSON.stringify(doc()) }
  const { toasts } = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc()) // this session binds to the package (notifications are only for its own package)
  expect(toasts).toEqual([]) // the first sight at session start is silent
  files[pkg('/repo', 'a')] = JSON.stringify(doc({ waitingOn: waitingUser }))
  await Promise.all([turnComplete($, 't1'), turnComplete($, 't2')])
  expect(toasts.filter((t) => t.includes('waiting on you'))).toHaveLength(1)
})

test('a new package the session creates shows at once; if the decision is yours it is reported once (not another package\'s history)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'older')]: JSON.stringify(doc({ package: 'older', title: 'Older', waitingOn: waitingUser })) }
  const { toasts } = fakeRepo(on, files)
  await start($)
  expect(toasts, 'no history notification for a package already waiting at the start').toEqual([])
  await writeProgress($, files, pkg('/repo', 'new-feature'), doc({ package: 'new-feature', title: 'New feature', updatedAt: '2026-10-08T14:59:00Z', waitingOn: waitingUser }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /New feature/ }), 'visible right after the write (without waiting 5 minutes)').toBeDefined()
  await ui.unmount()
  expect(toasts).toEqual(['⏸ New feature: waiting on you — Plan approval'])
  await turnComplete($, 't2')
  expect(toasts, 'the same state is not reported again').toHaveLength(1)
})

test('notification: once when a phase finishes', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'a')]: JSON.stringify(doc()) }
  const { toasts } = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc())
  const next = doc()
  next.phases = next.phases.map((p) => (p.id === 'impl' ? { ...p, status: 'done' } : p))
  files[pkg('/repo', 'a')] = JSON.stringify(next)
  await turnComplete($)
  expect(toasts).toEqual(['✓ Checkout redesign: Build done'])
})

test('while a phase waits on you the band says WAITING ON YOU even if waitingOn names someone else', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({
    waitingOn: { who: 'reviewer', what: 'round 3' },
    phases: [{ id: 'g', title: 'Review decision', status: 'waiting-user' }, { id: 'm', title: 'Ship', status: 'pending' }],
  }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /WAITING ON YOU/ })).toBeDefined()
    await ui.unmount()
  }
})

test('staleness: an active package not updated for more than 3 hours shows a warning on the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ updatedAt: '2026-10-08T10:00:00Z' }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /⚠ updated 5h ago/ })).toBeDefined()
  await ui.unmount()
})

test('while the survey band is open (hasSurvey) the plugin does not draw on the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, { [pkg('/repo', 'a')]: JSON.stringify(doc()) })
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { hasSurvey: true, isWorking: false, maxRows: 10 } } as never)
  expect(await ui.find({ type: 'Text', text: /▶/ })).toBeUndefined()
  expect(await ui.find({ key: 'engine-own' })).toBeDefined()
  await ui.unmount()
})
