import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { auditNote, schemaNote } from '../hooks/model'
import { NOW, PANE, doc, fakeRepo, pkg, start } from './fixture'

const PATH = pkg('/repo', 'a')
/** A document whose phase has a status the schema does not know (the first error the schema reports). */
const broken = (): string => JSON.stringify(doc({ package: 'a', phases: [{ id: 'a', title: 'A', status: 'running' as never }] }))
const BROKEN_ERROR = 'phases[0].status is not valid (running)'
type Answer = { additionalContext?: string[] }
const post = async ($: Engine, tool: string, input: Record<string, unknown>, id = 'tu1'): Promise<Answer> =>
  (await $.classic.PostToolUse({ tool_name: tool, tool_input: input, tool_use_id: id, tool_response: {} } as never)) as Answer

test('the note names the file and the first problem and says to fix it (English: the model reads it)', () => {
  const note = schemaNote('/r/.progress/a/progress.json', 'phases[4].status is not valid (running)')
  expect(note).toMatch(/^session-progress: \/r\/\.progress\/a\/progress\.json does not match the session-progress-v1 schema \(phases\[4\]\.status is not valid \(running\)\)\./)
  expect(note).toMatch(/fix the file now/)
})

test('a Write or Edit that leaves a package file off the schema: a note for the model; a matching one, a read or another file: none', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [PATH]: broken(), '/repo/notes.md': '# notes' }
  fakeRepo(on, files)
  await start($)
  const written = await post($, 'Write', { file_path: PATH, content: files[PATH] })
  expect(written.additionalContext).toEqual([schemaNote(PATH, BROKEN_ERROR)])
  expect((await post($, 'Edit', { file_path: PATH, old_string: 'a', new_string: 'b' })).additionalContext?.length, 'Edit too').toBe(1)
  expect((await post($, 'Read', { file_path: PATH })).additionalContext, 'reading never gets a note').toBeUndefined()
  expect((await post($, 'Write', { file_path: '/repo/notes.md', content: '#' })).additionalContext, 'not a package file').toBeUndefined()
  files[PATH] = JSON.stringify(doc({ package: 'a' }))
  expect((await post($, 'Write', { file_path: PATH, content: files[PATH] })).additionalContext, 'matches: no note').toBeUndefined()
})

test('Bash: a note only when the command really wrote the package file during the call; a command that only reads it gets none', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [PATH]: broken() }
  let entered!: () => void
  let release!: () => void
  const reached = new Promise<void>((r) => (entered = r))
  const repo = fakeRepo(on, files, {
    gate: { entered: () => entered(), wait: new Promise<void>((r) => (release = r)) },
    onTool: (e, r) => {
      if (String(e.command).startsWith('python3')) r.touch(PATH, broken())
    },
  })
  await start($)
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `python3 edit.py ${PATH}` } as never)
  await reached
  const answer = await post($, 'Bash', { command: `python3 edit.py ${PATH}` }, 'b1')
  release()
  await call
  expect(answer.additionalContext).toEqual([schemaNote(PATH, BROKEN_ERROR)])
  expect((await post($, 'Bash', { command: `cat ${PATH}` }, 'b2')).additionalContext, 'not running through the binding hook: no note').toBeUndefined()
  expect(repo.toasts).toEqual([])
})

test('Bash: a command that only reads the package file during the call gets no note', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [PATH]: broken() }
  let entered!: () => void
  let release!: () => void
  const reached = new Promise<void>((r) => (entered = r))
  fakeRepo(on, files, { gate: { entered: () => entered(), wait: new Promise<void>((r) => (release = r)) } })
  await start($)
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: `cat ${PATH}` } as never)
  await reached
  const answer = await post($, 'Bash', { command: `cat ${PATH}` }, 'b1')
  release()
  await call
  expect(answer.additionalContext).toBeUndefined()
})

test('review rounds that do not match: the package still shows, a dim line names it in the panel, and the model is told to fix them', async ($, on) => {
  mock.clock(on, { now: NOW })
  const text = JSON.stringify({ ...doc({ package: 'a', title: 'Old format' }), audits: [{ verdict: 'PASS', kind: 'plan' }, { round: 2, by: 'reviewer', verdict: 'PASS' }] })
  const files: Record<string, string> = { [PATH]: text }
  fakeRepo(on, files)
  await start($)
  const written = await post($, 'Write', { file_path: PATH, content: text })
  expect(written.additionalContext).toEqual([auditNote(PATH, 'audits[0] needs round/by/verdict')])
  expect(written.additionalContext?.[0]).toMatch(/The package still shows/)
  await $.command.run({ command: 'progress', args: 'refresh' } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const line = await ui.find({ type: 'Text', text: /⚠ Old format: some review rounds are not shown \(audits\[0\] needs round\/by\/verdict\)/ })
  expect(line, 'one dim line').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /R2 · reviewer|reviewer/ }), 'the matching round is still listed').toBeDefined()
  expect(await ui.find({ type: 'Text', text: /does not match|could not be read/ }), 'no error line').toBeUndefined()
  await ui.unmount()
})

test('the same broken file in the main checkout and a worktree is one error line saying where else', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    '/repo/.git/worktrees/w/gitdir': '/wt/w/.git\n',
    '/wt/w/.git': 'gitdir: /repo/.git/worktrees/w\n',
    '/wt/w/.claude/session-progress.json': JSON.stringify({ packagesDir: 'docs/packages' }),
    [PATH]: broken(),
    [pkg('/wt/w', 'a')]: broken(),
  }
  fakeRepo(on, files)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  const lines = await ui.findAll({ type: 'Text', text: /phases\[0\]\.status is not valid/ })
  expect(lines.length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /\(and in 1 more checkout\)/ })).toBeDefined()
  await ui.unmount()
})
