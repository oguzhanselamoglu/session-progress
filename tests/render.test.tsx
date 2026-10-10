import { expect, mock, test } from 'claude-code/testing'

import type { ProgressDoc } from '../types'
import { BAND, NOW, PANE, fakeRepo, pkg, start, writeProgress } from './fixture'

const SURFACES = ['terminal', 'desktop'] as const

function doc(over: Partial<ProgressDoc> = {}): ProgressDoc {
  return {
    schema: 'session-progress-v1',
    package: 'checkout-redesign',
    title: 'Checkout redesign',
    branch: 'feature/checkout-redesign',
    updatedAt: '2026-10-08T14:00:00Z',
    phases: [
      { id: 'analysis', title: 'Plan', status: 'done', owner: 'claude' },
      { id: 'impl', title: 'Build', status: 'done', owner: 'qa', metrics: { tests: '412/0' } },
      { id: 'audit', title: 'Review round 3', status: 'waiting-external', owner: 'reviewer' },
      { id: 'merge', title: 'Ship', status: 'pending' },
    ],
    audits: [{ round: 1, by: 'reviewer', verdict: 'CHANGES REQUESTED', findings: '3 major 1 minor', closedBy: ['000c0b38'] }],
    waitingOn: { who: 'user', what: 'start review round 3' },
    ...over,
  }
}

test('band shows ONLY this session\'s package: a newer package of another session that waits on you does not leak in (discriminating)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    '/repo/.git/worktrees/x/gitdir': '/wt/x/.git\n',
    '/wt/x/.git': 'gitdir: /repo/.git/worktrees/x\n',
    // Another session's package: newer and waiting on you — the old "most recently updated" rule would have shown THIS on the band.
    [pkg('/repo', 'search-index')]: JSON.stringify(doc({ package: 'search-index', title: 'Search index', updatedAt: '2026-10-08T14:50:00Z' })),
  }
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/wt/x', 'checkout-redesign'), doc({ updatedAt: '2026-10-08T10:00:00Z' }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Checkout redesign/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2\/4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /WAITING ON YOU/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Search index/ }), 'the other package is not on the band').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\+1 package/ }), 'no old parallel package counter').toBeUndefined()
    await ui.unmount()
  }
})

test('band: without a packages folder in the repository the engine\'s own rendering stays', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, { '/repo/README.md': 'x' }, { bare: true })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /▶|○/ })).toBeUndefined()
    expect(await ui.find({ key: 'engine-own' })).toBeDefined()
    await ui.unmount()
  }
})

test('band: packages exist but the session is not bound → a one-line hint, no other package\'s name', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, { [pkg('/repo', 'checkout-redesign')]: JSON.stringify(doc()) })
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /this session is not bound to a package/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Checkout redesign/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('band: a broken progress.json of the bound package shows an error line; another package\'s breakage stays off the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'other-broken')]: '{"schema":"y"}' }
  fakeRepo(on, files)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /other-broken/ }), 'the error of a package it is not bound to is not on the band').toBeUndefined()
    await ui.unmount()
  }
  files[pkg('/repo', 'broken')] = '{"schema":"x"}'
  await $.tool.call({ tool: 'Edit', file_path: pkg('/repo', 'broken'), old_string: 'a', new_string: 'b' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /broken: schema/ })).toBeDefined()
    await ui.unmount()
  }
})

test('progress pane: the bound package in focus; phases, review rounds, other active packages, completed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    '/repo/.git/worktrees/x/gitdir': '/wt/x/.git\n',
    [pkg('/wt/x', 'dark-mode')]: JSON.stringify(doc({ package: 'dark-mode', title: 'Dark mode', updatedAt: '2026-10-08T14:30:00Z', waitingOn: null })),
    [pkg('/repo', 'api-v2-migration')]: JSON.stringify(doc({ package: 'api-v2-migration', title: 'API v2 migration', phases: [{ id: 'a', title: 'A', status: 'done', finishedAt: '2026-10-07T18:00:00Z' }], waitingOn: null })),
  }
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'checkout-redesign'), doc())
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Waiting on you: start review round 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /round 1 · reviewer · CHANGES REQUESTED · 3 major 1 minor → 000c0b38/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /tests 412\/0/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /not bound to this session/ }), 'the bound package is in focus').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Other active packages/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Dark mode/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Completed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /API v2 migration/ })).toBeDefined()
    await ui.unmount()
  }
})
