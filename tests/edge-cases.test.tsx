// Regression tests for binding, session records and refresh edge cases. Each failed before its fix.
import { expect, mock, test } from 'claude-code/testing'

import { isOpen, organizeSessions, snippetOf } from '../hooks/sessions'
import { BAND, NOW, SESSIONS, doc, fakeRepo, pkg, session, sessionFile, start, writeProgress } from './fixture'

const waitingUser = { who: 'user', what: 'Plan approval' } as const
const mine = () => doc({ package: 'api-v2-migration', title: 'API v2 migration' })

test('a Bash that only READS does not bind to a package another session created meanwhile', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  repo.touch(pkg('/repo', 'someone-elses'), JSON.stringify(doc({ package: 'someone-elses', title: "Someone else's" })))
  await $.tool.call({ tool: 'Bash', command: `cat ${pkg('/repo', 'api-v2-migration')}` } as never)
  expect(repo.self()?.package).toBe('api-v2-migration')
})

test('a read after a new worktree was added does not bind to the (finished) package found there', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  files['/repo/.git/worktrees/x/gitdir'] = '/wt/x/.git\n'
  files['/wt/x/.git'] = 'gitdir: /repo/.git/worktrees/x\n'
  repo.touch(pkg('/wt/x', 'old-package'), JSON.stringify(doc({ package: 'old-package', title: 'Old', phases: [{ id: 'a', title: 'A', status: 'done' }] })))
  await $.tool.call({ tool: 'Bash', command: `jq .phases ${pkg('/repo', 'api-v2-migration')}` } as never)
  expect(repo.self()?.package).toBe('api-v2-migration')
})

test('another session\'s write during a long Bash (to a package the command does not name) does not bind to this session', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'other')]: JSON.stringify(doc({ package: 'other', title: 'Other' })) }
  const repo = fakeRepo(on, files, {
    onTool: (e, r) => {
      if (typeof e['command'] === 'string' && e['command'].includes('npm test')) r.touch(pkg('/repo', 'other'), files[pkg('/repo', 'other')] ?? '')
    },
  })
  await start($)
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  await $.tool.call({ tool: 'Bash', command: `npm test && node scripts/update-progress.js ${pkg('/repo', 'api-v2-migration')}` } as never)
  expect(repo.self()?.package).toBe('api-v2-migration')
})

test('no automatic binding to a finished package (writing its final state is not new work); an existing binding stays', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files)
  await start($)
  const finished = doc({ package: 'finished', title: 'Finished', phases: [{ id: 'a', title: 'A', status: 'done' }] })
  await writeProgress($, files, pkg('/repo', 'finished'), finished)
  expect(repo.self()?.package).toBeNull()
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), { ...mine(), phases: mine().phases.map((p) => ({ ...p, status: 'done' as const })) })
  expect(repo.self()?.package, 'writing the final state of its own package keeps the binding').toBe('api-v2-migration')
})

test('a Write that returns an error does not bind', async ($, on) => {
  mock.clock(on, { now: NOW })
  const repo = fakeRepo(on, {}, { toolResult: { isError: true, result: 'File has not been read yet', text: 'err' } })
  await start($)
  await $.tool.call({ tool: 'Write', file_path: pkg('/repo', 'missing'), content: '{}' } as never)
  expect(repo.self()?.package).toBeNull()
})

test('/sessions: an idle "this" session comes BEFORE another working session; waiting on you still comes first', () => {
  const me = session({ id: 'me', busy: false })
  const { rows } = organizeSessions([session({ id: 'other', busy: true }), session({ id: 'wait', package: 'b' })], me, [
    { ok: true, root: '/r', path: '/r/docs/packages/b/progress.json', doc: doc({ package: 'b', waitingOn: waitingUser }) },
  ], NOW)
  expect(rows.map((r) => r.rec.id)).toEqual(['wait', 'me', 'other'])
})

test('the counter does not count its own package; two sessions bound to the same other package count once', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkg('/repo', 'other')]: JSON.stringify(doc({ package: 'other', title: 'Other', waitingOn: waitingUser })),
    [sessionFile('second')]: JSON.stringify(session({ id: 'second', package: 'api-v2-migration' })),
    [sessionFile('d1')]: JSON.stringify(session({ id: 'd1', package: 'other' })),
    [sessionFile('d2')]: JSON.stringify(session({ id: 'd2', package: 'other' })),
  }
  fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), doc({ package: 'api-v2-migration', title: 'API v2 migration', waitingOn: waitingUser }))
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /WAITING ON YOU/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+1 waiting on you in other sessions/ }), 'other counted once; own package not at all').toBeDefined()
  await ui.unmount()
})

test('a session-end "ended" is not undone by the heartbeat; after /clear a new id gets a new record', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const idRef = { id: 'self-1' }
  const repo = fakeRepo(on, files, { idRef })
  await start($)
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  await $.session.end({ reason: 'clear', sessionId: 'self-1', resume: { id: 'self-1' } } as never)
  await clock.advance(31_000)
  expect(repo.self()?.ended, 'stays ended under the same id').toBe(true)
  idRef.id = 'self-2'
  await clock.advance(31_000)
  const fresh = JSON.parse(files[sessionFile('self-2')] ?? 'null') as { ended: boolean; package: string | null } | null
  expect(fresh).toMatchObject({ ended: false, package: null })
  expect(JSON.parse(files[sessionFile('self-1')] ?? '{}').ended, 'the old record stays ended').toBe(true)
})

test('old records count as closed WITHOUT being read — the quick refresh stays cheap with 300 old records, the panel count is right', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [pkg('/repo', 'a')]: JSON.stringify(doc({ package: 'a' })) }
  for (let i = 0; i < 300; i++) files[sessionFile(`old${i}`)] = JSON.stringify(session({ id: `old${i}`, lastSeen: '2026-09-01T00:00:00Z', ended: true }))
  const counter = { n: 0 }
  const repo = fakeRepo(on, files, { counter })
  for (let i = 0; i < 300; i++) repo.age(sessionFile(`old${i}`), Date.parse('2026-09-01T00:00:00Z'))
  await start($)
  counter.n = 0
  await clock.advance(30_000)
  expect(counter.n, `quick refresh fs calls: ${counter.n}`).toBeLessThan(30)
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /300 closed sessions hidden/ })).toBeDefined()
  await ui.unmount()
})

test('in a repository without the packages folder (a project that does not use it) no record is written under .git and no toast shows', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/README.md': 'x' }
  const { toasts } = fakeRepo(on, files, { bare: true })
  await start($)
  expect(Object.keys(files).filter((f) => f.includes('/.git/session-progress/'))).toEqual([])
  expect(toasts).toEqual([])
})

test('in a large repository a Bash that READS a package it names is cheap (no full scan)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  for (let i = 0; i < 9; i++) {
    files[`/repo/.git/worktrees/w${i}/gitdir`] = `/wt/w${i}/.git\n`
    files[`/wt/w${i}/.git`] = `gitdir: /repo/.git/worktrees/w${i}\n`
  }
  for (const r of ['/repo', ...Array.from({ length: 9 }, (_, i) => `/wt/w${i}`)]) {
    for (let p = 0; p < 60; p++) files[`${r}/docs/packages/p${p}/notes.md`] = 'x'
    for (let p = 0; p < 5; p++) files[pkg(r, `p${p}`)] = JSON.stringify(doc({ package: `p${p}`, title: `P${p}` }))
  }
  const counter = { n: 0 }
  fakeRepo(on, files, { counter })
  await start($)
  counter.n = 0
  await $.tool.call({ tool: 'Bash', command: 'cat docs/packages/p0/progress.json' } as never)
  expect(counter.n, `reading Bash fs calls: ${counter.n}`).toBeLessThan(60)
  counter.n = 0
  await $.tool.call({ tool: 'Read', file_path: pkg('/repo', 'p0') } as never)
  expect(counter.n, 'Read never reaches the plugin').toBe(0)
})

test('when the session record could not be set up, /progress bind does not claim it bound', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, {}, { sessionId: null })
  await start($)
  const res = (await $.command.run({ command: 'progress', args: 'bind x' } as never)) as { text?: string }
  expect(res.text).toMatch(/could not be set up/)
})

test('a time in the future does not count as open; the session name is shortened', () => {
  expect(isOpen(session({ id: 's', lastSeen: '2026-10-08T18:00:00Z' }), NOW), '3 hours ahead').toBe(false)
  expect(isOpen(session({ id: 's', lastSeen: '2026-10-08T15:00:20Z' }), NOW), 'a small clock drift is tolerated').toBe(true)
  expect(snippetOf('é'.repeat(80), 40)?.length).toBe(40)
})

test('during /clear, even if the id changes BEFORE session.end, "ended" is written only to the ended session; the new record is open', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const idRef = { id: 'self-1' }
  fakeRepo(on, files, { idRef })
  await start($)
  idRef.id = 'self-2'
  await $.session.end({ reason: 'clear', sessionId: 'self-1', resume: { id: 'self-1' } } as never)
  await clock.advance(31_000)
  expect(JSON.parse(files[sessionFile('self-1')] ?? 'null')?.ended, 'the ended session').toBe(true)
  expect(JSON.parse(files[sessionFile('self-2')] ?? 'null')?.ended, 'the new conversation is open').toBe(false)
})

test('a new package written by Bash in a worktree added in the same turn binds', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files, {
    onTool: (e, r) => {
      const c = String(e['command'])
      if (c.includes('worktree add')) {
        files['/repo/.git/worktrees/n/gitdir'] = '/wt/n/.git\n'
        files['/wt/n/.git'] = 'gitdir: /repo/.git/worktrees/n\n'
      }
      if (c.includes('cat >')) r.touch(pkg('/wt/n', 'search-index'), JSON.stringify(doc({ package: 'search-index', title: 'Search index' })))
    },
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git worktree add /wt/n -b feature/search-index' } as never)
  await $.tool.call({ tool: 'Bash', command: "cat > /wt/n/docs/packages/search-index/progress.json <<'EOF'\n{}\nEOF" } as never)
  expect(repo.self()?.package).toBe('search-index')
})

test('agent pattern: a literal path inside a python heredoc binds', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const repo = fakeRepo(on, files, {
    onTool: (e, r) => {
      if (String(e['command']).startsWith('python3')) r.touch(pkg('/repo', 'dark-mode'), JSON.stringify(doc({ package: 'dark-mode', title: 'Dark mode' })))
    },
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: `python3 - <<'EOF'\nimport json\np='${pkg('/repo', 'dark-mode')}'\nEOF` } as never)
  expect(repo.self()?.package).toBe('dark-mode')
})

test('after /resume (no session.start, the session\'s state starts empty) the resumed session\'s record is continued and a write binds', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [sessionFile('old-1')]: JSON.stringify(session({ id: 'old-1', label: 'Earlier work' })) }
  const idRef = { id: 'self-1' }
  const repo = fakeRepo(on, files, { idRef })
  // The host keeps `$.state` per session: after the switch the plugin's value reads as never set, until the plugin sets it again.
  let wiped = false
  on('state.get', async ($, e, next) => {
    const read = (await next(e)) as unknown as { value: { value: unknown; version: number } }
    return (wiped && e.plugin === 'session-progress' && e.key === 'self' ? { value: { value: undefined, version: read.value.version } } : read) as never
  })
  on('state.set', async ($, e, next) => {
    if (e.plugin === 'session-progress' && e.key === 'self') wiped = false
    return next(e)
  })
  await start($)
  await $.session.end({ reason: 'resume', sessionId: 'self-1', resume: { id: 'self-1' } } as never)
  idRef.id = 'old-1'
  wiped = true
  await writeProgress($, files, pkg('/repo', 'api-v2-migration'), mine())
  const resumed = JSON.parse(files[sessionFile('old-1')] ?? 'null') as { ended: boolean; package: string | null; label: string | null } | null
  expect(resumed).toMatchObject({ ended: false, package: 'api-v2-migration', label: 'Earlier work' })
  expect(JSON.parse(files[sessionFile('self-1')] ?? '{}').ended, 'the session left stays ended').toBe(true)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /API v2 migration/ })).toBeDefined()
  await band.unmount()
  await clock.advance(31_000)
  expect(repo.self(), 'the left session\'s file is not the one kept alive').toMatchObject({ ended: true })
  // A command right after the switch, before any write, still finds a record.
  await $.session.end({ reason: 'resume', sessionId: 'old-1', resume: { id: 'old-1' } } as never)
  idRef.id = 'self-1'
  wiped = true
  const res = (await $.command.run({ command: 'progress', args: 'bind api-v2-migration' } as never)) as { text?: string }
  expect(res.text).not.toMatch(/could not be set up/)
  expect(repo.self()).toMatchObject({ ended: false, package: 'api-v2-migration', bindSource: 'manual' })
})
