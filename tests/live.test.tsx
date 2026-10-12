import { expect, mock, test } from 'claude-code/testing'

import { branchFromHead, gitDirOf } from '../hooks/model'
import { AGENTS_MAX, decisionFor, organizeSessions, parseSession, pruneAgents, settleAgent, startAgent, stopAgent } from '../hooks/sessions'
import { BAND, NOW, SESSIONS, doc, fakeRepo, pkg, session, sessionFile, start, turnComplete, turnStart, writeProgress } from './fixture'

const SINCE = '2026-10-08T14:59:40Z'
const SESSIONS_PANE = 'session-progress-sessions'
const PROGRESS_PANE = 'session-progress'

// ── Pure core ───────────────────────────────────────────────────────────────────────────────────────────────
test('git: the git folder of a main checkout and of a worktree; the branch HEAD names, none when detached', () => {
  expect(gitDirOf('/repo', null)).toBe('/repo/.git')
  expect(gitDirOf('/wt/a', 'gitdir: /main/.git/worktrees/a\n')).toBe('/main/.git/worktrees/a')
  expect(gitDirOf('/wt/a', 'gitdir: ../main/.git/worktrees/a')).toBe('/wt/a/../main/.git/worktrees/a')
  expect(gitDirOf('C:/wt/a', 'gitdir: C:\\main\\.git\\worktrees\\a')).toBe('C:/main/.git/worktrees/a')
  expect(branchFromHead('ref: refs/heads/feature/login\n')).toBe('feature/login')
  expect(branchFromHead('2f37ef6a9c1d0e4b5a6f7c8d9e0f1a2b3c4d5e6f\n')).toBeNull()
})

test('subagents: start → done, refused → failed, background → running until SubagentStop; finished ones go at a new turn; capped', () => {
  let list = startAgent([], 'a', 'Explore auth code')
  list = startAgent(list, 'b', 'Run the tests')
  list = startAgent(list, 'c', 'Review the diff')
  list = settleAgent(list, 'a', { result: { status: 'completed' } })
  list = settleAgent(list, 'b', { deny: 'no' })
  list = settleAgent(list, 'c', { result: { status: 'async_launched', agentId: 'bg1' } })
  expect(list.map((a) => [a.id, a.status])).toEqual([['a', 'done'], ['b', 'failed'], ['c', 'running']])
  expect(stopAgent(list, 'other'), 'no match → nothing to write').toBeNull()
  expect(stopAgent(list, 'bg1')?.find((a) => a.id === 'c')?.status).toBe('done')
  expect(pruneAgents(list)?.map((a) => a.id), 'a new turn keeps the running one').toEqual(['c'])
  expect(pruneAgents(pruneAgents(list) ?? []), 'nothing finished → nothing to write').toBeNull()
  let many = startAgent([], 'keep', 'Long running')
  for (let i = 0; i < AGENTS_MAX + 5; i++) many = settleAgent(startAgent(many, `x${i}`, `job ${i}`), `x${i}`, {})
  expect(many.length).toBe(AGENTS_MAX)
  expect(many[0]?.id, 'the running one stays; the oldest finished ones go').toBe('keep')
})

test('records: fields added after 0.3.x read as defaults when absent and are dropped when malformed; running subagents count as working', () => {
  const { branch: _b, worktree: _w, agents: _a, ...old } = session({ id: 'old' })
  expect(parseSession(JSON.stringify(old))).toMatchObject({ branch: null, worktree: false, agents: [] })
  const odd = parseSession(JSON.stringify({ ...old, branch: 7, worktree: 'yes', agents: [{ id: 'x' }, { id: 'y', description: 'ok', status: 'running' }] }))
  expect(odd).toMatchObject({ branch: null, worktree: false, agents: [{ id: 'y', description: 'ok', status: 'running' }] })
  const bg = session({ id: 'bg', agents: [{ id: 'y', description: 'ok', status: 'running' }] })
  expect(organizeSessions([bg], null, [], NOW).rows[0]?.status, 'idle between turns but a subagent runs').toBe('busy')
})

// ── 5 s pass ────────────────────────────────────────────────────────────────────────────────────────────────
test('another session\'s dialog is told within 5 s, without a turn; an unchanged record is not read again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [sessionFile('api')]: JSON.stringify(session({ id: 'api', label: 'API work' })) }
  const counter = { n: 0 }
  const repo = fakeRepo(on, files, { counter })
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  await clock.advance(5_000)
  counter.n = 0
  await clock.advance(5_000)
  expect(counter.n, `an idle 5 s pass costs one listing (${counter.n} fs calls)`).toBeLessThanOrEqual(1)
  repo.touch(sessionFile('api'), JSON.stringify(session({ id: 'api', label: 'API work', decision: decisionFor('Bash', SINCE) })))
  await clock.advance(5_000)
  expect(repo.toasts).toEqual(['⏸ API work (repo): waiting on you — permission: Bash'])
})

// ── Panels ──────────────────────────────────────────────────────────────────────────────────────────────────
test('sessions panel: opens by itself when another session starts waiting; once the person closes it, not again; the command toggles', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [sessionFile('o')]: JSON.stringify(session({ id: 'o', label: 'Other' })) }
  const repo = fakeRepo(on, files)
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a' }))
  expect(repo.panes.has(SESSIONS_PANE), 'nothing waits: not opened').toBe(false)
  const waitWith = (tool: string, since: string): void =>
    repo.touch(sessionFile('o'), JSON.stringify(session({ id: 'o', label: 'Other', decision: decisionFor(tool, since) })))
  waitWith('Bash', SINCE)
  await clock.advance(5_000)
  expect(repo.panes.has(SESSIONS_PANE), 'opened by itself').toBe(true)
  repo.panes.delete(SESSIONS_PANE) // the person closes it
  await clock.advance(5_000)
  waitWith('Edit', '2026-10-08T14:59:50Z')
  await clock.advance(5_000)
  expect(repo.toasts.length, 'still told').toBe(2)
  expect(repo.panes.has(SESSIONS_PANE), 'closed by the person: not opened again').toBe(false)

  const run = async (): Promise<string | undefined> => ((await $.command.run({ command: 'sessions', args: '' } as never)) as { text?: string }).text
  expect(await run()).toMatch(/Sessions panel opened/)
  expect(await run()).toMatch(/Sessions panel closed/)
  expect(repo.panes.has(SESSIONS_PANE)).toBe(false)
})

test('progress panel: the bare command toggles it; refresh keeps it open', async ($, on) => {
  mock.clock(on, { now: NOW })
  const repo = fakeRepo(on, {})
  await start($)
  const run = async (args: string): Promise<string | undefined> => ((await $.command.run({ command: 'progress', args } as never)) as { text?: string }).text
  expect(await run('')).toMatch(/Progress panel opened/)
  expect(await run('refresh')).toMatch(/Progress panel opened/)
  expect(repo.panes.has(PROGRESS_PANE)).toBe(true)
  expect(await run('')).toMatch(/Progress panel closed/)
  expect(repo.panes.has(PROGRESS_PANE)).toBe(false)
})

// ── Branch and subagents in the record ──────────────────────────────────────────────────────────────────────
test('branch: read from git\'s HEAD into the record and the card; a checkout of another branch is seen at the next turn end', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/.git/HEAD': 'ref: refs/heads/feature/login\n' }
  const repo = fakeRepo(on, files)
  await start($)
  expect(repo.self()).toMatchObject({ branch: 'feature/login', worktree: false })
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /⎇ feature\/login/ })).toBeDefined()
  await ui.unmount()
  files['/repo/.git/HEAD'] = 'ref: refs/heads/main\n'
  await turnComplete($)
  expect(repo.self()?.branch).toBe('main')
})

test('subagents: tracked in the record (label only, never the prompt), on the band and the card; a background one ends with SubagentStop', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const during: unknown[] = []
  const repo = fakeRepo(on, files, {
    onTool: (e, r) => during.push(e.tool === 'Agent' ? r.self()?.agents?.map((a) => a.status) : null),
    toolResult: { result: { status: 'async_launched', agentId: 'bg1' } },
  })
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Package A' }))
  await turnStart($, 'go')
  await $.tool.call({ tool: 'Agent', tool_use_id: 'tu1', description: 'Explore auth code', prompt: 'SECRET PLAN' } as never)
  expect(during.at(-1), 'running during its call').toEqual(['running'])
  expect(repo.self()?.agents).toEqual([{ id: 'tu1', description: 'Explore auth code', status: 'running', agentId: 'bg1' }])
  expect(JSON.stringify(repo.self()), 'the prompt never reaches the record').not.toMatch(/SECRET/)
  await turnComplete($)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /⑂ Subagents: 1 running · 0 done/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Explore auth code/ })).toBeDefined()
  await band.unmount()
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /● working/ }), 'turn over, but a subagent runs').toBeDefined()
  await ui.unmount()
  await $.classic.SubagentStop({ agent_id: 'bg1', agent_type: 'general-purpose', agent_transcript_path: '/t', stop_hook_active: false } as never)
  expect(repo.self()?.agents?.[0]?.status).toBe('done')
  await turnStart($, 'next', 't2')
  expect(repo.self()?.agents, 'finished ones go at a new turn').toEqual([])
})

