import { expect, mock, test } from 'claude-code/testing'

import { BAND, NOW, PANE, SESSIONS, doc, fakeRepo, sessionFile, start } from './fixture'

// A project that never configured the plugin: packages under `.progress`, English, any owner labels.
const DEFAULT_DIR = '/repo/.progress'
const pkgAt = (name: string, dir = DEFAULT_DIR): string => `${dir}/${name}/progress.json`
const SURFACES = ['terminal', 'desktop'] as const
const generic = { bare: true, config: null, store: {} } as const

test('no config: packages are read from .progress, texts are English, commands are /progress and /sessions', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {
    [pkgAt('login-flow')]: JSON.stringify(
      doc({
        schema: 'session-progress-v1',
        package: 'login-flow',
        title: 'Login flow',
        phases: [
          { id: 'plan', title: 'Plan', status: 'done' },
          { id: 'build', title: 'Build', status: 'active', owner: 'reviewer' },
          { id: 'ship', title: 'Ship', status: 'pending' },
        ],
      }),
    ),
  }
  const registered: string[] = []
  fakeRepo(on, files, { ...generic, commands: registered })
  await start($)
  expect(registered).toEqual(['progress', 'sessions'])
  // bind through the session's own write
  await $.tool.call({ tool: 'Write', file_path: pkgAt('login-flow'), content: files[pkgAt('login-flow')] } as never)
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ ...BAND, plugin: 'session-progress', surface } as never)
    expect(await band.find({ type: 'Text', text: /▶ Login flow/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Now: Build/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /reviewer/ }), 'a free owner label is shown as written').toBeDefined()
    expect(await band.find({ type: 'Text', text: /33%/ })).toBeDefined()
    await band.unmount()
    const pane = await $.ui.mount({ ...SESSIONS, surface } as never)
    expect(await pane.find({ type: 'Text', text: /Open sessions · 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Next: Ship$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /\(this\)/ })).toBeDefined()
    await pane.unmount()
  }
  // English sub-commands
  const named = (await $.command.run({ command: 'progress', args: 'name Login work' } as never)) as { text?: string }
  expect(named.text).toBe('Session name: Login work')
  expect(JSON.parse(files[sessionFile('self-1')] ?? '{}').package).toBe('login-flow')
})

test('a stored Turkish choice: Turkish texts and /ilerleme, /oturumlar', async ($, on) => {
  mock.clock(on, { now: NOW })
  const registered: string[] = []
  fakeRepo(on, { [pkgAt('a')]: JSON.stringify(doc({ package: 'a', title: 'Package A' })) }, { ...generic, store: { language: 'tr' }, commands: registered })
  await start($)
  expect(registered).toEqual(['ilerleme', 'oturumlar'])
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Açık oturumlar · 1/ })).toBeDefined()
  await ui.unmount()
})

test('/progress language tr: stored for later sessions, this session switches at once (panel redraws, Turkish commands)', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store: Record<string, unknown> = {}
  const registered: string[] = []
  fakeRepo(on, { [pkgAt('a')]: JSON.stringify(doc({ package: 'a', title: 'Package A' })) }, { ...generic, store, commands: registered })
  await start($)
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Open sessions · 1/ })).toBeDefined()
  const bad = (await $.command.run({ command: 'progress', args: 'language de' } as never)) as { text?: string }
  expect(bad.text).toMatch(/Usage: \/progress language en\|tr/)
  expect(store).toEqual({})
  const res = (await $.command.run({ command: 'progress', args: 'language tr' } as never)) as { text?: string }
  expect(res.text).toBe('Dil: Türkçe. Komutlar: /ilerleme, /oturumlar.')
  expect(store).toEqual({ language: 'tr' })
  expect(registered).toEqual(['progress', 'sessions', 'ilerleme', 'oturumlar'])
  expect(await ui.find({ type: 'Text', text: /Açık oturumlar · 1/ }), 'the open panel redraws in Turkish').toBeDefined()
  await ui.unmount()
  const back = (await $.command.run({ command: 'ilerleme', args: 'dil en' } as never)) as { text?: string }
  expect(back.text).toBe('Language: English. Commands: /progress, /sessions.')
  expect(store).toEqual({ language: 'en' })
})

test('project config: own packages folder and owner labels; `user` is always YOU', async ($, on) => {
  mock.clock(on, { now: NOW })
  const dir = '/repo/work/packages'
  const files: Record<string, string> = {
    [pkgAt('x', dir)]: JSON.stringify(
      doc({
        package: 'x',
        title: 'Package X',
        waitingOn: { who: 'qa', what: 'smoke test' },
      }),
    ),
  }
  fakeRepo(on, files, { ...generic, config: JSON.stringify({ packagesDir: './work/packages/', ownerLabels: { qa: 'QA team' } }) })
  await start($)
  await $.tool.call({ tool: 'Write', file_path: pkgAt('x', dir), content: files[pkgAt('x', dir)] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Package X/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Waiting on: QA team — smoke test/ })).toBeDefined()
  await ui.unmount()
  files[pkgAt('x', dir)] = JSON.stringify(doc({ package: 'x', title: 'Package X', waitingOn: { who: 'user', what: 'sign-off' } }))
  await $.command.run({ command: 'progress', args: 'refresh' } as never)
  const band = await $.ui.mount({ ...BAND, plugin: 'session-progress', surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /WAITING ON YOU/ })).toBeDefined()
  await band.unmount()
})

test('a broken config file keeps the defaults and says so on the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  fakeRepo(on, { [pkgAt('a')]: JSON.stringify(doc({ package: 'a' })) }, { ...generic, config: '{ broken' })
  await start($)
  const band = await $.ui.mount({ ...BAND, plugin: 'session-progress', surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /⚠ \.claude\/session-progress\.json:/ })).toBeDefined()
  await band.unmount()
})

test('a repository that does not use the plugin gets no records and no band', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/README.md': 'x' }
  fakeRepo(on, files, generic)
  await start($)
  expect(Object.keys(files).filter((f) => f.includes('/.git/session-progress/'))).toEqual([])
  const band = await $.ui.mount({ ...BAND, plugin: 'session-progress', surface: 'terminal' } as never)
  expect(await band.find({ type: 'Text', text: /progress/ })).toBeUndefined()
  await band.unmount()
})

test('schemaAliases: a file with an older schema name is read when the project lists it, an error otherwise', async ($, on) => {
  mock.clock(on, { now: NOW })
  const legacy = JSON.stringify({ ...doc({ package: 'old-work', title: 'Old work' }), schema: 'legacy-progress-v1' })
  const files: Record<string, string> = { [pkgAt('old-work')]: legacy }
  fakeRepo(on, files, { ...generic, config: JSON.stringify({ schemaAliases: ['legacy-progress-v1'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Old work/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /schema must be/ })).toBeUndefined()
  await ui.unmount()
  files['/repo/.claude/session-progress.json'] = JSON.stringify({})
  await $.command.run({ command: 'progress', args: 'refresh' } as never)
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' } as never)
  expect(await after.find({ type: 'Text', text: /schema must be "session-progress-v1"/ })).toBeDefined()
  await after.unmount()
})

test('a repository without packages: both panels say how to start; /progress init creates the folder once and starts the session record', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/README.md': 'x' }
  fakeRepo(on, files, generic)
  await start($)
  for (const pane of [PANE, SESSIONS]) {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    expect(await ui.find({ type: 'Text', text: /No work packages in this repository yet \(\.progress\/\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Run \/progress init/ })).toBeDefined()
    await ui.unmount()
  }
  expect(files[sessionFile('self-1')], 'no record before init').toBeUndefined()
  const res = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(res.text).toMatch(/^Created \.progress\/ — commit it with the project\./)
  expect(res.text, 'no CLAUDE.md: nothing is created, the line is given as a tip').toMatch(/\nTip: .*CLAUDE\.md: "Track multi-step work \(3\+ steps\) with session-progress\."$/)
  expect(files['/repo/CLAUDE.md']).toBeUndefined()
  expect(files['/repo/.progress/README.md']).toMatch(/^# Work packages/)
  expect(files[sessionFile('self-1')], 'the session record is written once the folder exists').toBeDefined()
  const ui = await $.ui.mount({ ...SESSIONS, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /Open sessions · 1/ })).toBeDefined()
  await ui.unmount()
  const again = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(again.text).toMatch(/^\.progress\/ already exists; nothing to do\.\nTip: /)
  expect(files['/repo/.progress/README.md']).toMatch(/^# Work packages/)
})

test('/ilerleme kur uses the project folder and answers in Turkish', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = {}
  fakeRepo(on, files, { ...generic, store: { language: 'tr' }, config: JSON.stringify({ packagesDir: 'docs/work' }) })
  await start($)
  const res = (await $.command.run({ command: 'ilerleme', args: 'kur' } as never)) as { text?: string }
  expect(res.text).toMatch(/^docs\/work\/ oluşturuldu/)
  expect(res.text, 'the CLAUDE.md tip').toMatch(/\nİpucu: .*CLAUDE\.md .*"Çok adımlı işleri \(3\+ adım\) session-progress ile takip et\."$/)
  expect(files['/repo/docs/work/README.md']).toBeDefined()
})

test('/progress init adds its line to an EXISTING CLAUDE.md only after the person says yes (appended, once); never creates one', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/CLAUDE.md': '# Project\n\nUse pnpm.' }
  const asked: string[] = []
  fakeRepo(on, files, { ...generic, asked, answer: (q, labels) => (labels.includes('Add the line') ? 'Add the line' : null) })
  await start($)
  const res = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(asked, 'the question shows the exact line and ends in a question mark').toEqual([
    'With this line in CLAUDE.md, Claude tracks multi-step work in this project without being asked: "Track multi-step work (3+ steps) with session-progress." Add it to the end of CLAUDE.md?',
  ])
  expect(res.text).toMatch(/\nAdded to CLAUDE\.md: "Track multi-step work \(3\+ steps\) with session-progress\." — from the next session on/)
  expect(files['/repo/CLAUDE.md']).toBe('# Project\n\nUse pnpm.\n\nTrack multi-step work (3+ steps) with session-progress.\n')
  const again = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(again.text).toBe('.progress/ already exists; nothing to do.\nCLAUDE.md already mentions session-progress; left as it is.')
  expect(files['/repo/CLAUDE.md']?.match(/session-progress/g)?.length, 'added once').toBe(1)
  expect(asked.length, 'a file that already mentions it is not asked about again').toBe(1)
})

test('/progress init: declined or dismissed → CLAUDE.md untouched, the line given as text', async ($, on) => {
  mock.clock(on, { now: NOW })
  const original = '# Project\n'
  const files: Record<string, string> = { '/repo/CLAUDE.md': original }
  let reply: string | null = "Don't add"
  fakeRepo(on, files, { ...generic, answer: () => reply })
  await start($)
  const declined = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(declined.text).toMatch(/\nCLAUDE\.md left as it is\. To add it yourself later: "Track multi-step work \(3\+ steps\) with session-progress\."$/)
  reply = null
  const dismissed = (await $.command.run({ command: 'progress', args: 'init' } as never)) as { text?: string }
  expect(dismissed.text).toMatch(/\nTip: .*CLAUDE\.md/)
  expect(files['/repo/CLAUDE.md']).toBe(original)
})

test('/ilerleme kur: an existing folder still gets the line, in Turkish, in .claude/CLAUDE.md when there is no root one', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { '/repo/.claude/CLAUDE.md': 'Kurallar\n', '/repo/.progress/README.md': '# Work packages' }
  fakeRepo(on, files, { ...generic, store: { language: 'tr' }, answer: (q, labels) => (labels.includes('Satırı ekle') && q.endsWith('eklensin mi?') ? 'Satırı ekle' : null) })
  await start($)
  const res = (await $.command.run({ command: 'ilerleme', args: 'kur' } as never)) as { text?: string }
  expect(res.text).toMatch(/^\.progress\/ zaten var\.\n\.claude\/CLAUDE\.md dosyasına eklendi: "Çok adımlı işleri \(3\+ adım\) session-progress ile takip et\."/)
  expect(files['/repo/.claude/CLAUDE.md']).toBe('Kurallar\n\nÇok adımlı işleri (3+ adım) session-progress ile takip et.\n')
  expect(files['/repo/CLAUDE.md'], 'no root CLAUDE.md is created').toBeUndefined()
})
