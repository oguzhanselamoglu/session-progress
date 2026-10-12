// Every text the plugin shows, in each language it speaks. Pure data and small formatters; no `$`.
import type { PhaseStatus } from '../types'

export type Lang = 'en' | 'tr'

export type Dict = {
  /** Command names this language registers (the other language's still answer when typed). */
  cmd: { progress: string; sessions: string }
  /** Sub-commands of the progress command, in this language. */
  sub: { refresh: string; bind: string; unbind: string; name: string; language: string; init: string }
  /** This language's own name, as the switch command reports it. */
  languageName: string
  status: Record<PhaseStatus, string>
  you: string
  dur: { lessThanMinute: string; d: string; h: string; m: string }
  ago: { now: string; m: (n: number) => string; h: (n: number) => string; d: (n: number) => string }
  phases: string
  /** Percentage in the language's order (`46%` / `%46`). */
  pct: (n: number) => string
  // validation
  v: {
    notObject: string
    schema: (got: string) => string
    missing: (field: string) => string
    badDate: (field: string) => string
    phasesEmpty: string
    notObj: (at: string) => string
    duplicateId: (at: string, id: string) => string
    badStatus: (at: string, got: string) => string
    badOwner: (at: string) => string
    badDates: (at: string) => string
    noteText: (at: string) => string
    refsList: (at: string) => string
    metricsMap: (at: string) => string
    auditsList: string
    auditFields: (i: number) => string
    auditFindings: (i: number) => string
    auditClosedBy: (i: number) => string
    auditAt: (i: number) => string
    waitingOn: string
    json: (msg: string) => string
    unreadable: (msg: string) => string
  }
  // notifications
  n: {
    phaseDone: (pkg: string, phase: string) => string
    waiting: (pkg: string, what: string) => string
    /** Another session started waiting on the person (`where`: its name and checkout). */
    elsewhere: (where: string, what: string) => string
  }
  /** A dialog open on the person in a session (from its record). */
  dec: { permission: (tool: string) => string; question: string; plan: string }
  auditLine: (round: number, by: string, verdict: string) => string
  // discovery / records
  noRepo: string
  scanFailed: (msg: string) => string
  recordWriteFailed: (msg: string) => string
  recordSetupFailed: (msg: string) => string
  commandFailed: (msg: string) => string
  // commands
  c: {
    progressDescription: string
    progressHint: string
    sessionsDescription: string
    noRecord: string
    bindUsage: string
    bound: (pkg: string) => string
    boundMissing: (pkg: string) => string
    unbound: string
    named: (name: string) => string
    nameCleared: string
    paneOpened: string
    paneNotPlaced: string
    sessionsOpened: string
    sessionsNotPlaced: string
    paneTitle: string
    sessionsTitle: string
    languageNow: string
    languageUsage: string
    languageFailed: (why: string) => string
    initDone: (dir: string) => string
    initExists: (dir: string) => string
    /** The folder was there, but the CLAUDE.md line was added now. */
    initExistsShort: (dir: string) => string
    /** The line `/progress init` adds to an existing CLAUDE.md (in the language in use). */
    claudeLine: string
    claudeAdded: (file: string, line: string) => string
    claudePresent: (file: string) => string
    claudeTip: (line: string) => string
    claudeFailed: (file: string, why: string) => string
    initNoRepo: string
    initFailed: (why: string) => string
  }
  // band
  b: {
    now: string
    waitingYou: string
    updated: (ago: string) => string
    elsewhere: (n: number) => string
    done: (title: string) => string
    nextBinds: string
    bindsOnFirstWrite: string
    notFound: (pkg: string) => string
    notBound: string
    bindHint: string
  }
  // /progress pane
  p: {
    reading: string
    notBoundHere: string
    phasesDone: (done: number, total: number, percent: number) => string
    waitingYou: (what: string) => string
    waiting: (who: string, what: string) => string
    stale: (ago: string) => string
    audits: string
    none: string
    others: string
    completed: string
    footer: (read: string) => string
    noFolder: (dir: string) => string
    noFolderHint: string
  }
  // /sessions pane
  s: {
    open: (n: number) => string
    waitingYou: (n: number) => string
    unbound: (n: number) => string
    statusWaiting: string
    statusBusy: string
    statusIdle: string
    waitingFor: (what: string) => string
    now: (title: string) => string
    next: (title: string) => string
    completed: string
    notFound: (pkg: string) => string
    noPackage: string
    thisSession: string
    sessionId: (id: string) => string
    orphans: (n: number) => string
    orphansHint: string
    closed: (n: number) => string
    read: (at: string) => string
    hint: string
  }
}

const en: Dict = {
  cmd: { progress: 'progress', sessions: 'sessions' },
  sub: { refresh: 'refresh', bind: 'bind', unbind: 'unbind', name: 'name', language: 'language', init: 'init' },
  languageName: 'English',
  status: {
    done: 'done',
    skipped: 'skipped',
    active: 'in progress',
    'waiting-user': 'waiting on you',
    'waiting-external': 'waiting elsewhere',
    blocked: 'blocked',
    pending: 'up next',
  },
  you: 'YOU',
  dur: { lessThanMinute: '<1m', d: 'd', h: 'h', m: 'm' },
  ago: { now: 'just now', m: (n) => `${n}m ago`, h: (n) => `${n}h ago`, d: (n) => `${n}d ago` },
  phases: 'phases',
  pct: (n) => `${n}%`,
  v: {
    notObject: 'root is not an object',
    schema: (got) => `schema must be "session-progress-v1" (${got})`,
    missing: (f) => `${f} is missing`,
    badDate: (f) => `${f} is not a valid date`,
    phasesEmpty: 'phases is empty or not a list',
    notObj: (at) => `${at} is not an object`,
    duplicateId: (at, id) => `${at}.id is repeated (${id})`,
    badStatus: (at, got) => `${at}.status is not valid (${got})`,
    badOwner: (at) => `${at}.owner must be non-empty text`,
    badDates: (at) => `${at} has an invalid date field`,
    noteText: (at) => `${at}.note must be text`,
    refsList: (at) => `${at}.refs must be a list of texts`,
    metricsMap: (at) => `${at}.metrics must be {name: text|number}`,
    auditsList: 'audits is not a list',
    auditFields: (i) => `audits[${i}] needs round/by/verdict`,
    auditFindings: (i) => `audits[${i}].findings must be text`,
    auditClosedBy: (i) => `audits[${i}].closedBy must be a list of texts`,
    auditAt: (i) => `audits[${i}].at is not a valid date`,
    waitingOn: 'waitingOn must be {who, what}',
    json: (msg) => `JSON could not be read: ${msg}`,
    unreadable: (msg) => `could not be read: ${msg}`,
  },
  n: {
    phaseDone: (pkg, phase) => `✓ ${pkg}: ${phase} done`,
    waiting: (pkg, what) => `⏸ ${pkg}: waiting on you — ${what}`,
    elsewhere: (where, what) => `⏸ ${where}: waiting on you — ${what}`,
  },
  dec: { permission: (tool) => `permission: ${tool}`, question: 'a question', plan: 'plan approval' },
  auditLine: (round, by, verdict) => `round ${round} · ${by} · ${verdict}`,
  noRepo: 'no git repository found (looking up from the session folder)',
  scanFailed: (msg) => `scan failed: ${msg}`,
  recordWriteFailed: (msg) => `session-progress: session record could not be written — ${msg}`,
  recordSetupFailed: (msg) => `session-progress: session record could not be set up — ${msg}`,
  commandFailed: (msg) => `session-progress: command could not be registered — ${msg}`,
  c: {
    progressDescription: "This session's work package progress. Sub-commands: init · refresh · bind <package> · unbind · name <session name> · language en|tr",
    progressHint: '[init | refresh | bind <package> | unbind | name <name> | language en|tr]',
    sessionsDescription: 'Work package progress of every open session, one by one.',
    noRecord: 'The session record could not be set up; binding and naming do not work in this session (the band and the panel do).',
    bindUsage: 'Usage: /progress bind <package>',
    bound: (pkg) => `This session is bound to "${pkg}".`,
    boundMissing: (pkg) => `This session is bound to "${pkg}" (no progress.json found yet).`,
    unbound: "This session's package binding was removed; it binds again on the next progress.json write.",
    named: (name) => `Session name: ${name}`,
    nameCleared: 'Session name removed.',
    paneOpened: 'Progress panel opened.',
    paneNotPlaced: 'The progress panel could not be placed; the band is above the prompt.',
    sessionsOpened: 'Sessions panel opened.',
    sessionsNotPlaced: 'The sessions panel could not be placed.',
    paneTitle: 'Progress',
    sessionsTitle: 'Sessions',
    languageNow: 'Language: English. Commands: /progress, /sessions.',
    languageUsage: 'Usage: /progress language en|tr  (en English · tr Türkçe). Kept for all your sessions.',
    languageFailed: (why) => `The language could not be changed: ${why}`,
    initDone: (dir) => `Created ${dir}/ — commit it with the project. Now ask Claude to track a multi-step task, e.g. "plan this and track it with session-progress".`,
    initExists: (dir) => `${dir}/ already exists; nothing to do.`,
    initExistsShort: (dir) => `${dir}/ already exists.`,
    claudeLine: 'Track multi-step work (3+ steps) with session-progress.',
    claudeAdded: (file, line) => `Added to ${file}: "${line}" — from the next session on, Claude tracks multi-step work without being asked.`,
    claudePresent: (file) => `${file} already mentions session-progress; left as it is.`,
    claudeTip: (line) => `Tip: to have work tracked without asking, add this line to the project's CLAUDE.md: "${line}"`,
    claudeFailed: (file, why) => `${file} could not be updated (${why}); add the line by hand.`,
    initNoRepo: 'Not in a git repository; session-progress works per repository.',
    initFailed: (why) => `The packages folder could not be created: ${why}`,
  },
  b: {
    now: 'Now',
    waitingYou: '⏸ WAITING ON YOU',
    updated: (ago) => `⚠ updated ${ago}`,
    elsewhere: (n) => `+${n} waiting on you in other sessions (/sessions)`,
    done: (title) => `✓ ${title} done`,
    nextBinds: 'binds to a new package on its first progress.json write',
    bindsOnFirstWrite: 'binds on the first progress.json write',
    notFound: (pkg) => `bound package not found: ${pkg}`,
    notBound: 'this session is not bound to a package',
    bindHint: '/progress bind <package>',
  },
  p: {
    reading: 'Reading…',
    notBoundHere: '  · not bound to this session',
    phasesDone: (done, total, percent) => `${done}/${total} phases  ${percent}%`,
    waitingYou: (what) => `⏸ Waiting on you: ${what}`,
    waiting: (who, what) => `⧗ Waiting on: ${who} — ${what}`,
    stale: (ago) => `⚠ Last update ${ago} — the phase may be stale`,
    audits: 'Review rounds',
    none: 'No active package.',
    others: 'Other active packages',
    completed: 'Completed',
    footer: (read) => `Read ${read}  ·  /progress refresh  ·  /sessions`,
    noFolder: (dir) => `No work packages in this repository yet (${dir}/).`,
    noFolderHint: 'Run /progress init, then ask Claude to track a multi-step task with session-progress.',
  },
  s: {
    open: (n) => `Open sessions · ${n}`,
    waitingYou: (n) => `   ⏸ ${n} waiting on you`,
    unbound: (n) => `   ○ ${n} not bound`,
    statusWaiting: '⏸ WAITING ON YOU',
    statusBusy: '● working',
    statusIdle: '○ idle',
    waitingFor: (what) => `Waiting: ${what}`,
    now: (title) => `Now: ${title}`,
    next: (title) => `Next: ${title}`,
    completed: '✓ completed',
    notFound: (pkg) => `bound package not found: ${pkg}`,
    noPackage: 'no bound package',
    thisSession: ' (this)',
    sessionId: (id) => `session ${id}`,
    orphans: (n) => `Unowned packages · ${n}`,
    orphansHint: '  (not bound to an open session)',
    closed: (n) => `${n} closed sessions hidden  ·  `,
    read: (at) => `Read ${at}`,
    hint: '/progress bind <package>  ·  /progress name <name>',
  },
}

const tr: Dict = {
  cmd: { progress: 'ilerleme', sessions: 'oturumlar' },
  sub: { refresh: 'yenile', bind: 'bağla', unbind: 'çöz', name: 'ad', language: 'dil', init: 'kur' },
  languageName: 'Türkçe',
  status: {
    done: 'tamamlandı',
    skipped: 'atlandı',
    active: 'sürüyor',
    'waiting-user': 'sende bekliyor',
    'waiting-external': 'dışarıda bekliyor',
    blocked: 'bloklu',
    pending: 'sırada',
  },
  you: 'SEN',
  dur: { lessThanMinute: '<1dk', d: 'g', h: 'sa', m: 'dk' },
  ago: { now: 'az önce', m: (n) => `${n}dk önce`, h: (n) => `${n}sa önce`, d: (n) => `${n}g önce` },
  phases: 'aşama',
  pct: (n) => `%${n}`,
  v: {
    notObject: 'kök bir nesne değil',
    schema: (got) => `schema "session-progress-v1" olmalı (${got})`,
    missing: (f) => `${f} eksik`,
    badDate: (f) => `${f} geçerli bir tarih değil`,
    phasesEmpty: 'phases boş ya da dizi değil',
    notObj: (at) => `${at} nesne değil`,
    duplicateId: (at, id) => `${at}.id tekrar ediyor (${id})`,
    badStatus: (at, got) => `${at}.status geçersiz (${got})`,
    badOwner: (at) => `${at}.owner boş olmayan metin olmalı`,
    badDates: (at) => `${at} tarih alanı geçersiz`,
    noteText: (at) => `${at}.note metin olmalı`,
    refsList: (at) => `${at}.refs metin dizisi olmalı`,
    metricsMap: (at) => `${at}.metrics {ad: metin|sayı} olmalı`,
    auditsList: 'audits dizi değil',
    auditFields: (i) => `audits[${i}] round/by/verdict eksik`,
    auditFindings: (i) => `audits[${i}].findings metin olmalı`,
    auditClosedBy: (i) => `audits[${i}].closedBy metin dizisi olmalı`,
    auditAt: (i) => `audits[${i}].at geçerli bir tarih değil`,
    waitingOn: 'waitingOn {who, what} geçersiz',
    json: (msg) => `JSON okunamadı: ${msg}`,
    unreadable: (msg) => `okunamadı: ${msg}`,
  },
  n: {
    phaseDone: (pkg, phase) => `✓ ${pkg}: ${phase} tamamlandı`,
    waiting: (pkg, what) => `⏸ ${pkg}: sende bekliyor — ${what}`,
    elsewhere: (where, what) => `⏸ ${where}: sende bekliyor — ${what}`,
  },
  dec: { permission: (tool) => `izin: ${tool}`, question: 'soru', plan: 'plan onayı' },
  auditLine: (round, by, verdict) => `${round}. tur · ${by} · ${verdict}`,
  noRepo: 'git deposu bulunamadı (oturum dizininden yukarı)',
  scanFailed: (msg) => `tarama başarısız: ${msg}`,
  recordWriteFailed: (msg) => `session-progress: oturum kaydı yazılamadı — ${msg}`,
  recordSetupFailed: (msg) => `session-progress: oturum kaydı kurulamadı — ${msg}`,
  commandFailed: (msg) => `session-progress: komut kaydedilemedi — ${msg}`,
  c: {
    progressDescription: 'Bu oturumun iş paketi ilerlemesi. Alt komutlar: kur · yenile · bağla <paket> · çöz · ad <oturum adı> · dil en|tr',
    progressHint: '[kur | yenile | bağla <paket> | çöz | ad <ad> | dil en|tr]',
    sessionsDescription: 'Açık oturumların iş paketi ilerlemesi, ayrı ayrı.',
    noRecord: 'Oturum kaydı kurulamadı; bağlama ve oturum adı bu oturumda çalışmıyor (şerit ve /ilerleme çalışır).',
    bindUsage: 'Kullanım: /ilerleme bağla <paket>',
    bound: (pkg) => `Bu oturum "${pkg}" paketine bağlandı.`,
    boundMissing: (pkg) => `Bu oturum "${pkg}" paketine bağlandı (henüz progress.json bulunamadı).`,
    unbound: 'Bu oturumun paket bağlantısı kaldırıldı; ilk progress.json yazımında yeniden bağlanır.',
    named: (name) => `Oturum adı: ${name}`,
    nameCleared: 'Oturum adı kaldırıldı.',
    paneOpened: 'İlerleme paneli açıldı.',
    paneNotPlaced: 'İlerleme paneli yerleşemedi; şerit prompt üstünde.',
    sessionsOpened: 'Oturumlar paneli açıldı.',
    sessionsNotPlaced: 'Oturumlar paneli yerleşemedi.',
    paneTitle: 'İlerleme',
    sessionsTitle: 'Oturumlar',
    languageNow: 'Dil: Türkçe. Komutlar: /ilerleme, /oturumlar.',
    languageUsage: 'Kullanım: /ilerleme dil en|tr  (en English · tr Türkçe). Tüm oturumlarında geçerli olur.',
    languageFailed: (why) => `Dil değiştirilemedi: ${why}`,
    initDone: (dir) => `${dir}/ oluşturuldu — projeyle birlikte commit'le. Şimdi Claude'dan çok adımlı bir işi takip etmesini iste, örn. "bunu planla ve session-progress ile takip et".`,
    initExists: (dir) => `${dir}/ zaten var; yapılacak bir şey yok.`,
    initExistsShort: (dir) => `${dir}/ zaten var.`,
    claudeLine: 'Çok adımlı işleri (3+ adım) session-progress ile takip et.',
    claudeAdded: (file, line) => `${file} dosyasına eklendi: "${line}" — bir sonraki oturumdan itibaren Claude çok adımlı işleri sen istemeden takip eder.`,
    claudePresent: (file) => `${file} zaten session-progress'ten söz ediyor; dokunulmadı.`,
    claudeTip: (line) => `İpucu: işlerin sen istemeden takip edilmesi için projenin CLAUDE.md dosyasına şu satırı ekle: "${line}"`,
    claudeFailed: (file, why) => `${file} güncellenemedi (${why}); satırı elle ekle.`,
    initNoRepo: 'Bir git deposunda değilsin; session-progress depo bazında çalışır.',
    initFailed: (why) => `Paket klasörü oluşturulamadı: ${why}`,
  },
  b: {
    now: 'Şu an',
    waitingYou: '⏸ SENDE BEKLİYOR',
    updated: (ago) => `⚠ ${ago} güncellendi`,
    elsewhere: (n) => `+${n} iş başka oturumda sende bekliyor (/oturumlar)`,
    done: (title) => `✓ ${title} tamamlandı`,
    nextBinds: 'yeni pakete ilk progress.json yazımında bağlanır',
    bindsOnFirstWrite: 'ilk progress.json yazımında bağlanır',
    notFound: (pkg) => `bağlı paket bulunamadı: ${pkg}`,
    notBound: 'bu oturum bir pakete bağlı değil',
    bindHint: '/ilerleme bağla <paket>',
  },
  p: {
    reading: 'Okunuyor…',
    notBoundHere: '  · bu oturuma bağlı değil',
    phasesDone: (done, total, percent) => `${done}/${total} aşama  %${percent}`,
    waitingYou: (what) => `⏸ Sende bekliyor: ${what}`,
    waiting: (who, what) => `⧗ Bekleniyor: ${who} — ${what}`,
    stale: (ago) => `⚠ Son güncelleme ${ago} — aşama bayat olabilir`,
    audits: 'Denetim turları',
    none: 'Aktif paket yok.',
    others: 'Diğer aktif paketler',
    completed: 'Tamamlananlar',
    footer: (read) => `Okundu ${read}  ·  /ilerleme yenile  ·  /oturumlar`,
    noFolder: (dir) => `Bu depoda henüz iş paketi yok (${dir}/).`,
    noFolderHint: '/ilerleme kur yaz, sonra Claude\'dan çok adımlı bir işi session-progress ile takip etmesini iste.',
  },
  s: {
    open: (n) => `Açık oturumlar · ${n}`,
    waitingYou: (n) => `   ⏸ ${n} sende bekliyor`,
    unbound: (n) => `   ○ ${n} bağlı değil`,
    statusWaiting: '⏸ SENDE BEKLİYOR',
    statusBusy: '● çalışıyor',
    statusIdle: '○ boşta',
    waitingFor: (what) => `Bekliyor: ${what}`,
    now: (title) => `Şu an: ${title}`,
    next: (title) => `Sıradaki: ${title}`,
    completed: '✓ tamamlandı',
    notFound: (pkg) => `bağlı paket bulunamadı: ${pkg}`,
    noPackage: 'bağlı paket yok',
    thisSession: ' (bu)',
    sessionId: (id) => `oturum ${id}`,
    orphans: (n) => `Sahipsiz paketler · ${n}`,
    orphansHint: '  (açık bir oturuma bağlı değil)',
    closed: (n) => `${n} kapalı oturum gizli  ·  `,
    read: (at) => `Okundu ${at}`,
    hint: '/ilerleme bağla <paket>  ·  /ilerleme ad <ad>',
  },
}

export const DICTS: Record<Lang, Dict> = { en, tr }

/** Sub-command aliases in every language → one canonical action. */
export const SUB_ALIASES: Record<string, 'refresh' | 'bind' | 'unbind' | 'name' | 'language' | 'init'> = {
  init: 'init',
  kur: 'init',
  başlat: 'init',
  baslat: 'init',
  language: 'language',
  lang: 'language',
  dil: 'language',
  refresh: 'refresh',
  yenile: 'refresh',
  bind: 'bind',
  bağla: 'bind',
  bagla: 'bind',
  unbind: 'unbind',
  çöz: 'unbind',
  coz: 'unbind',
  name: 'name',
  ad: 'name',
}

export const LANGS: readonly Lang[] = ['en', 'tr']

/** A stored choice → the language to speak: English unless the person chose another one. */
export const resolveLang = (stored: unknown): Lang => (LANGS.includes(stored as Lang) ? (stored as Lang) : 'en')
