import { expect, mock, test } from 'claude-code/testing'

import { candidatePackages, changedPackage, isOpen, labelOf, organizeSessions, packageFromPath, parseSession, segmentOf, snippetOf } from '../hooks/sessions'

const SEG = 'packages'
import type { PackageRead } from '../types'
import { BAND, NOW, SESSIONS, doc, fakeRepo, pkg, session, sessionFile, start, turnComplete, turnStart, writeProgress } from './fixture'

const SURFACES = ['terminal', 'desktop'] as const
const waitingUser = { who: 'user', what: 'Plan approval' } as const

// ── Pure core ───────────────────────────────────────────────────────────────────────────────────────────────
test('package detection: Write/Edit path; Bash candidates from the command text; binds when the time change belongs to one package, not when ambiguous', () => {
  expect(packageFromPath('/r/docs/packages/checkout-redesign/progress.json', SEG)).toBe('checkout-redesign')
  expect(packageFromPath('/r/docs/packages/x/report.md', SEG)).toBeNull()
  expect(packageFromPath(undefined)).toBeNull()
  const a = '/r/docs/packages/a/progress.json'
  const b = '/r/docs/packages/b/progress.json'
  expect(changedPackage({ [a]: 1, [b]: 1 }, { [a]: 1, [b]: 1 }, SEG), 'a command that only reads does not bind').toBeNull()
  expect(changedPackage({ [a]: 1, [b]: -1 }, { [a]: 1, [b]: 5 }, SEG), 'a newly created package').toBe('b')
  expect(changedPackage({ [a]: 1, [b]: 1 }, { [a]: 7, [b]: 3 }, SEG), 'two packages changed → ambiguous, no binding').toBeNull()
  expect(changedPackage({ [a]: 1, [`/w${a}`]: 1 }, { [a]: 7, [`/w${a}`]: 9 }, SEG), 'the same package in two roots → one package').toBe('a')
  expect(candidatePackages(`cat ${a} && jq . /x/packages/b/progress.json`, SEG)).toEqual(['a', 'b'])
  expect(candidatePackages('D=/r/docs/packages/new-one; python3 x.py $D/progress.json', SEG)).toEqual(['new-one'])
  expect(candidatePackages('git add docs/packages/*/progress.json', SEG), 'a glob is no name').toEqual([])
})

test('default folder (.progress): path and Bash candidate; `progress.json` is not a package name', () => {
  expect(packageFromPath('/r/.progress/login-flow/progress.json')).toBe('login-flow')
  expect(packageFromPath('/r/docs/packages/x/progress.json'), 'another folder').toBeNull()
  expect(candidatePackages('cat .progress/login-flow/progress.json')).toEqual(['login-flow'])
  expect(segmentOf('docs/packages/')).toBe('packages')
})

test('record: a broken or incomplete record is rejected; openness threshold; first message snippet', () => {
  const ok = session({ id: 's' })
  expect(parseSession(JSON.stringify(ok))).toEqual(ok)
  expect(parseSession('{half')).toBeNull()
  expect(parseSession(JSON.stringify({ ...ok, schema: 'x' }))).toBeNull()
  expect(parseSession(JSON.stringify({ ...ok, bindSource: 'other' }))).toBeNull()
  expect(isOpen(ok, NOW)).toBe(true)
  expect(isOpen({ ...ok, lastSeen: '2026-10-08T14:50:00Z' }, NOW), 'silent for 10 minutes').toBe(false)
  expect(isOpen({ ...ok, ended: true }, NOW)).toBe(false)
  expect(snippetOf('  Ship the checkout redesign\nsecond line')).toBe('Ship the checkout redesign')
  expect(snippetOf('x'.repeat(50))?.endsWith('…')).toBe(true)
  expect(snippetOf('   ')).toBeNull()
})

test('panel order: waiting on you first, then this session, then the latest signal; closed ones counted; unowned packages', () => {
  const read = (name: string, over = {}): PackageRead => ({ ok: true, root: '/r', path: `/r/docs/packages/${name}/progress.json`, doc: doc({ package: name, title: name, ...over }) })
  const reads = [read('a'), read('b', { waitingOn: waitingUser }), read('c'), read('finished', { phases: [{ id: 'x', title: 'X', status: 'done' }] })]
  const me = session({ id: 'me', package: 'a', busy: true })
  const { rows, closed, orphans } = organizeSessions(
    [
      session({ id: 'idle', lastSeen: '2026-10-08T14:59:50Z' }),
      session({ id: 'wait', package: 'b', lastSeen: '2026-10-08T14:58:00Z' }),
      session({ id: 'old', package: 'c', lastSeen: '2026-10-08T14:00:00Z' }),
      session({ id: 'ended', ended: true }),
    ],
    me,
    reads,
    NOW,
  )
  expect(rows.map((r) => r.rec.id)).toEqual(['wait', 'me', 'idle'])
  expect(rows.map((r) => r.status)).toEqual(['user', 'busy', 'idle'])
  expect(closed).toBe(2)
  expect(orphans.map((o) => o.key), 'c is bound to a closed session → unowned; a finished package is not counted as unowned').toEqual(['c'])
})

// ── Binding ─────────────────────────────────────────────────────────────────────────────────────────────────
test('binding: automatic through Write; a manual binding is NOT overridden by the automatic one; after unbind automatic works again', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files)
  await start($)
  expect(repo.self()?.package).toBeNull()
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  expect(repo.self()).toMatchObject({ package: 'a', bindSource: 'auto' })
  await $.command.run({ command: 'progress', args: 'bind b' } as never)
  expect(repo.self()).toMatchObject({ package: 'b', bindSource: 'manual' })
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  expect(repo.self()?.package, 'the manual binding is kept').toBe('b')
  await $.command.run({ command: 'progress', args: 'unbind' } as never)
  expect(repo.self()).toMatchObject({ package: null, bindSource: null })
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  expect(repo.self()).toMatchObject({ package: 'a', bindSource: 'auto' })
})

test('binding: Bash only when it REALLY wrote the file (even with the path in a variable); a command that only reads does not bind', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'was-read')]: JSON.stringify(doc({ package: 'was-read', title: 'Was read' })) }
  const repo = fakeRepo(on, files, {
    onTool: (e, r) => {
      if (typeof e['command'] === 'string' && e['command'].includes('python3')) {
        r.touch(pkg('/repo', 'was-written'), JSON.stringify(doc({ package: 'was-written', title: 'Was written' })))
      }
    },
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: `cat ${pkg('/repo', 'was-read')}` } as never)
  expect(repo.self()?.package, 'reading does not bind').toBeNull()
  await $.tool.call({ tool: 'Bash', command: "D=/repo/docs/packages/was-written; python3 - <<EOF\nopen('$D/progress.json','w')\nEOF" } as never)
  expect(repo.self()).toMatchObject({ package: 'was-written', bindSource: 'auto' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Was written/ })).toBeDefined()
  await ui.unmount()
})

// ── Session record ──────────────────────────────────────────────────────────────────────────────────────────
test('record: turn start busy + first message snippet, turn end idle, session end ended; manual name', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files)
  await start($)
  expect(files[sessionFile('self-1')], 'the record is written at session start').toBeDefined()
  await turnStart($, 'Ship checkout redesign please')
  expect(repo.self()).toMatchObject({ busy: true, snippet: 'Ship checkout redesign please' })
  await turnStart($, 'second message', 't2')
  expect(repo.self()?.snippet, 'the first message is kept').toBe('Ship checkout redesign please')
  await turnComplete($, 't2')
  expect(repo.self()?.busy).toBe(false)
  await $.command.run({ command: 'progress', args: 'name Checkout work' } as never)
  expect(repo.self()?.label).toBe('Checkout work')
  await $.session.end({ reason: 'other', sessionId: 'self-1', resume: { id: 'self-1' } } as never)
  expect(repo.self()?.ended).toBe(true)
})

test('robustness: if the engine cannot give a session id the band and the scan still work (the hint is drawn)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { toasts } = fakeRepo(on, { [pkg('/repo', 'a')]: JSON.stringify(doc()) }, { sessionId: null })
  await start($)
  expect(toasts.some((t) => t.includes('session record could not be set up'))).toBe(true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /not bound/ })).toBeDefined()
    await ui.unmount()
  }
})

// ── Band counter + /sessions ────────────────────────────────────────────────────────────────────────────────
test('band counter: a decision waiting on you in another open session → +N; a closed session is not counted', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkg('/repo', 'b')]: JSON.stringify(doc({ package: 'b', title: 'Package B', waitingOn: waitingUser })),
    [pkg('/repo', 'c')]: JSON.stringify(doc({ package: 'c', title: 'Package C', waitingOn: waitingUser })),
    [sessionFile('other')]: JSON.stringify(session({ id: 'other', package: 'b' })),
    [sessionFile('closed')]: JSON.stringify(session({ id: 'closed', package: 'c', lastSeen: '2026-10-08T13:00:00Z' })),
  }
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Package A/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+1 waiting on you in other sessions/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Package B/ }), 'a counter, not the other package\'s name').toBeUndefined()
    await ui.unmount()
  }
})

test('/sessions: open sessions on separate rows (waiting on you first, this session marked), unowned packages, closed ones hidden', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkg('/repo', 'api-v2-migration')]: JSON.stringify(doc({ package: 'api-v2-migration', title: 'API v2 migration', waitingOn: waitingUser })),
    [pkg('/repo', 'search-index')]: JSON.stringify(doc({ package: 'search-index', title: 'Search index' })),
    [sessionFile('api')]: JSON.stringify(session({ id: 'api', label: 'API work', package: 'api-v2-migration' })),
    [sessionFile('fx')]: JSON.stringify(session({ id: 'fx', snippet: 'feature-x task', cwd: '/wt/feature-x' })),
    [sessionFile('old')]: JSON.stringify(session({ id: 'old', label: 'Old session', lastSeen: '2026-10-07T10:00:00Z' })),
  }
  fakeRepo(on, files)
  await start($)
  await $.command.run({ command: 'progress', args: 'name Checkout work' } as never)
  await writeProgress($, files, pkg('/repo', 'checkout-redesign'), doc())
  await turnStart($, 'continue')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...SESSIONS, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Open sessions · 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 waiting on you/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /API work/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /API v2 migration/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Plan approval/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Checkout work/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\(this\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● working/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /feature-x task/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /no bound package/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Unowned packages/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Search index/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Old session/ }), 'a closed session is hidden').toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /1 closed sessions hidden/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the /sessions command opens the panel', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, {})
  await start($)
  const res = (await $.command.run({ command: 'sessions', args: '' } as never)) as { text?: string }
  expect(res.text).toMatch(/Sessions panel opened/)
})

test('notifications only for this session\'s package: another package\'s phase transition makes no toast in this session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'b')]: JSON.stringify(doc({ package: 'b', title: 'Package B' })) }
  const { toasts } = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  const done = (d: ReturnType<typeof doc>) => ({ ...d, phases: d.phases.map((p) => (p.id === 'impl' ? { ...p, status: 'done' as const } : p)) })
  files[pkg('/repo', 'b')] = JSON.stringify(done(doc({ package: 'b', title: 'Package B' })))
  await turnComplete($)
  expect(toasts, 'another package\'s transition is silent').toEqual([])
  files[pkg('/repo', 'a')] = JSON.stringify(done(doc({ package: 'a', title: 'Package A' })))
  await turnComplete($, 't2')
  expect(toasts).toEqual(['✓ Package A: Build done'])
})

test('a tagged message (<agent-message …>) does not become the session name; a tagged snippet in an older record is not shown', () => {
  expect(snippetOf('<agent-message from="aa409679e9f232">hello</agent-message>')).toBeNull()
  expect(snippetOf('<command-name>/sessions</command-name>')).toBeNull()
  expect(snippetOf('<3 issues left')).toBe('<3 issues left')
  expect(labelOf(session({ id: 'abcdef123', snippet: '<agent-message from="aa…' }))).toBe('session abcdef')
  expect(labelOf(session({ id: 'abcdef123', snippet: 'Feature X merged' }))).toBe('Feature X merged')
})

test('/sessions card: phase strip, next phase, pending decision', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkg('/repo', 'b')]: JSON.stringify(doc({ package: 'b', title: 'Package B', waitingOn: waitingUser })),
    [sessionFile('o2')]: JSON.stringify(session({ id: 'o2', label: 'Second', package: 'b' })),
  }
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /^Now: Build/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Next: Review$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Waiting: Plan approval$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /WAITING ON YOU/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓●○$/ }), 'phase strip').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Plan · Build/ }), 'phase names are not listed on the card').toBeUndefined()
  await ui.unmount()
})

test('Windows paths: backslashes in a written path or a command still name the package', () => {
  expect(packageFromPath('C:\\dev\\acme\\docs\\packages\\checkout-redesign\\progress.json', SEG)).toBe('checkout-redesign')
  expect(candidatePackages('type C:\\dev\\acme\\docs\\packages\\search-index\\progress.json', SEG)).toEqual(['search-index'])
})

