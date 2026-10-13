import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decisionFor, parseProject, projectEntry, projectFileName } from '../hooks/sessions'
import { BAND, NOW, PROJECTS_DIR, SESSIONS, doc, fakeRepo, pkg, session, sessionFile, start, writeProgress } from './fixture'

/** Another project on the same machine, with its packages in `.progress` (the default). */
const SHOP = '/work/shop'
const SHOP_FILE = `${PROJECTS_DIR}/${projectFileName(SHOP)}`
const SELF_FILE = `${PROJECTS_DIR}/${projectFileName('/repo')}`
const shopPkg = (name: string): string => `${SHOP}/.progress/${name}/progress.json`
const SINCE = '2026-10-08T14:59:40Z'

/** The other project as its own session left it: its project file, one open session (bound to `cart`) and that package. */
function shop(files: Record<string, string>, over: Parameters<typeof session>[0] = { id: 'api' }): void {
  files[SHOP_FILE] = JSON.stringify(projectEntry(SHOP, '.progress', '2026-10-08T14:59:50Z'))
  files[sessionFile(over.id, SHOP)] = JSON.stringify(session({ label: 'API work', cwd: SHOP, checkout: SHOP, package: 'cart', ...over }))
  files[shopPkg('cart')] ??= JSON.stringify(doc({ package: 'cart', title: 'Cart rewrite' }))
}

const run = async ($: Engine, args: string): Promise<string | undefined> =>
  ((await $.command.run({ command: 'sessions', args } as never)) as { text?: string }).text

const paneText = async ($: Engine, re: RegExp): Promise<boolean> => {
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  const found = (await ui.find({ type: 'Text', text: re })) !== undefined
  await ui.unmount()
  return found
}

// ── Pure core ───────────────────────────────────────────────────────────────────────────────────────────────────
test('project file: a readable name that two folders of the same name never share; a broken file or one leaving the project is refused', () => {
  expect(projectFileName('/work/api')).toMatch(/^api-[0-9a-f]{8}\.json$/)
  expect(projectFileName('/work/api')).not.toBe(projectFileName('/home/api'))
  expect(projectFileName('C:\\work\\api\\'), 'Windows spelling: same project').toBe(projectFileName('C:/work/api'))
  const ok = projectEntry('/work/api', '.progress', SINCE, ['old-v1'])
  expect(parseProject(JSON.stringify(ok))).toEqual(ok)
  expect(parseProject('{')).toBeNull()
  expect(parseProject(JSON.stringify({ ...ok, packagesDir: '../elsewhere' }))).toBeNull()
  expect(parseProject(JSON.stringify({ ...ok, packagesDir: '/etc' }))).toBeNull()
  expect(parseProject(JSON.stringify({ ...ok, schema: 'x' }))).toBeNull()
})

// ── Off by default ──────────────────────────────────────────────────────────────────────────────────────────────
test('off by default: nothing is written outside the project, other projects are not shown or told; the panel says how to turn them on', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files)
  const repo = fakeRepo(on, files)
  await start($)
  await clock.advance(30_000)
  files[sessionFile('api', SHOP)] = JSON.stringify(session({ id: 'api', label: 'API work', cwd: SHOP, package: 'cart', decision: decisionFor('Bash', SINCE) }))
  repo.touch(sessionFile('api', SHOP), files[sessionFile('api', SHOP)] ?? '')
  await clock.advance(5_000)
  expect(Object.keys(files).filter((p) => p.startsWith(PROJECTS_DIR)), 'only the other project\'s own file').toEqual([SHOP_FILE])
  expect(repo.toasts).toEqual([])
  expect(await paneText($, /shop/)).toBe(false)
  expect(await paneText($, /Other projects: off {2}· {2}\/sessions all shows them/)).toBe(true)
})

// ── On ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('/sessions all: kept for every session, this project published at once, the panel opens and the answer says what it does', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  const store: Record<string, unknown> = {}
  const repo = fakeRepo(on, files, { store })
  await start($)
  expect(files[SELF_FILE]).toBeUndefined()
  const text = await run($, 'all')
  expect(text).toMatch(/Other projects are on/)
  expect(text).toContain(PROJECTS_DIR)
  expect(store['otherProjects']).toBe(true)
  expect(parseProject(files[SELF_FILE] ?? '')).toMatchObject({ root: '/repo', packagesDir: 'docs/packages' })
  expect(repo.panes.has('session-progress-sessions')).toBe(true)
  expect(await run($, 'bu'), 'the other language\'s word works too').toMatch(/Other projects are off/)
  expect(store['otherProjects']).toBe(false)
})

test('another project\'s session that starts waiting: told within 5 s, naming the project; what already waited is not told', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files, { id: 'old', label: 'Old wait', decision: decisionFor('Edit', '2026-10-08T14:50:00Z') })
  shop(files)
  const repo = fakeRepo(on, files, { store: { otherProjects: true } })
  await start($)
  await clock.advance(5_000)
  expect(repo.toasts, 'first sight: nothing').toEqual([])
  repo.touch(sessionFile('api', SHOP), JSON.stringify(session({ id: 'api', label: 'API work', cwd: SHOP, package: 'cart', decision: decisionFor('Bash', SINCE) })))
  await clock.advance(5_000)
  expect(repo.toasts).toEqual(['⏸ shop › API work: waiting on you — permission: Bash'])
  expect(repo.panes.has('session-progress-sessions'), 'the panel opens by itself, as for this project').toBe(true)
})

test('panel: the other project\'s cards show where its work stands (package, phases, now and next), after this project\'s', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files)
  fakeRepo(on, files, { store: { otherProjects: true } })
  await start($)
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  for (const re of [/Other projects · 1/, /▸ shop/, /Cart rewrite/, /Now: Build/, /Next: Review/, /API work {2}· {2}shop/, /Other projects: on/]) {
    expect(await ui.find({ type: 'Text', text: re }), String(re)).toBeDefined()
  }
  await ui.unmount()
})

test('a package waiting on the person there counts on the band here, even when this session\'s package has the same folder name', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [shopPkg('a')]: JSON.stringify(doc({ package: 'a', title: 'Shop A' })) }
  shop(files, { id: 'api', package: 'a' })
  const repo = fakeRepo(on, files, { store: { otherProjects: true } })
  await start($)
  await writeProgress($, files, pkg('/repo', 'a'), doc({ package: 'a', title: 'Here A' }))
  repo.touch(shopPkg('a'), JSON.stringify(doc({ package: 'a', title: 'Shop A', waitingOn: { who: 'user', what: 'Approve the schema' } })))
  await clock.advance(5_000)
  expect(repo.toasts).toEqual(['⏸ shop › API work: waiting on you — Shop A: Approve the schema'])
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /\+1 waiting on you in other sessions/ })).toBeDefined()
  await band.unmount()
  expect(await paneText($, /⏸ 1 waiting on you in other projects \(below\)/)).toBe(true)
})

test('a switch made in another session is picked up at the next heartbeat; turning it off hides other projects', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files)
  const store: Record<string, unknown> = {}
  fakeRepo(on, files, { store })
  await start($)
  store['otherProjects'] = true
  await clock.advance(30_000)
  expect(parseProject(files[SELF_FILE] ?? '')?.root).toBe('/repo')
  expect(await paneText($, /▸ shop/)).toBe(true)
  store['otherProjects'] = false
  await clock.advance(30_000)
  expect(await paneText($, /▸ shop/)).toBe(false)
})

test('a project whose file has not been written for minutes is skipped unread; one with no open session is not listed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files)
  const repo = fakeRepo(on, files, { store: { otherProjects: true } })
  repo.age(SHOP_FILE, NOW - 10 * 60_000)
  await start($)
  expect(await paneText($, /No open sessions in other projects\./)).toBe(true)
})

test('no home folder: other projects cannot be turned on, and the answer says why', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  fakeRepo(on, {}, { store, env: {} })
  await start($)
  expect(await run($, 'all')).toMatch(/configuration folder could not be found/)
  expect(store['otherProjects']).toBeUndefined()
})

test('cost: an idle 5 s pass with one other project lists the folders and checks the bound package, reading nothing again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  shop(files)
  const counter = { n: 0 }
  fakeRepo(on, files, { store: { otherProjects: true }, counter })
  await start($)
  await clock.advance(5_000)
  counter.n = 0
  await clock.advance(5_000)
  expect(counter.n, `${counter.n} fs calls`).toBeLessThanOrEqual(4)
})
