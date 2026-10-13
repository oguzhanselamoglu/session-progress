/**
 * `session-progress-v1` — one work package's `<packagesDir>/<package>/progress.json`. The agent driving the work is its only writer.
 * A project may accept other `schema` names too (`schemaAliases`).
 */
export type PhaseStatus = 'pending' | 'active' | 'waiting-user' | 'waiting-external' | 'blocked' | 'done' | 'skipped';
/** Who a phase belongs to, or who is being waited on: any label; `user` means the person at the keyboard (highlighted). */
export type Owner = string;

export type Phase = {
  id: string;
  title: string;
  status: PhaseStatus;
  owner?: Owner;
  startedAt?: string;
  finishedAt?: string;
  note?: string;
  refs?: string[];
  metrics?: Record<string, string | number>;
};

export type Audit = {
  round: number;
  by: string;
  verdict: string;
  findings?: string;
  closedBy?: string[];
  at?: string;
};

export type ProgressDoc = {
  schema: string;
  package: string;
  title: string;
  branch?: string;
  worktree?: string;
  updatedAt: string;
  phases: Phase[];
  audits?: Audit[];
  waitingOn?: { who: Owner; what: string } | null;
};

/** A file that was read: a valid document or why it could not be read. `root` = the checkout it is in (main or a worktree). */
export type PackageRead =
  | { ok: true; path: string; root: string; doc: ProgressDoc }
  | { ok: false; path: string; root: string; error: string };

/** `<checkout>/.claude/session-progress.json` — per-project settings, committed with the project. Every field is optional. */
export type ProjectConfig = {
  /** Folder (relative to the checkout root) holding one sub-folder per package. Default `.claude/progress`. */
  packagesDir?: string;
  /** Display names for owner labels (`{"test": "test agent"}`); `user` is always shown as "YOU". */
  ownerLabels?: Record<string, string>;
  /** Other `schema` values read as `session-progress-v1` (files written before a rename, or by an older tool). */
  schemaAliases?: string[];
};

export type Snapshot = {
  /** When it was read (epoch ms). */
  readAt: number;
  /** Checkout root of the session's working directory (to pick the focused package). */
  cwdRoot: string | null;
  reads: PackageRead[];
  /** Discovery error (e.g. the git folder could not be read), apart from package reads. */
  error: string | null;
  /** Readable session records (`<main repo>/.git/session-progress/sessions/*.json`; broken ones are skipped; `decision` always set). */
  sessions: SessionRecord[];
  /** Records counted as closed WITHOUT being read, because their file has not been written for a long time. */
  closedSessions: number;
  /** The packages folder (relative) and whether any checkout has it; `null` outside a git repository. */
  folder: { dir: string; exists: boolean } | null;
  /** Open sessions of OTHER projects (only while the person has them on, `/sessions all`; empty otherwise). */
  foreign: ForeignProject[];
};

/** Another project with open sessions: its records and, for each bound package, its file as read. */
export type ForeignProject = {
  /** Main checkout root (the project's key). */
  root: string;
  /** Its folder name, as shown. */
  name: string;
  /** Its packages folder (relative), from its project file. */
  packagesDir: string;
  /** Its open sessions' records. */
  sessions: SessionRecord[];
  /** The package files its open sessions are bound to. */
  reads: PackageRead[];
};

/** `session-progress-session-v1` — one Claude Code session's record; only that session's plugin writes it. */
export type SessionRecord = {
  schema: 'session-progress-session-v1';
  id: string;
  /** Name given with `/progress name <name>`. */
  label: string | null;
  /** Short piece of the first message (the desktop title is not in the API). */
  snippet: string | null;
  cwd: string;
  /** The session's checkout root (shown in the panel; differs from `cwd` when the session started in a sub-folder). */
  checkout: string | null;
  startedAt: string;
  /** Last heartbeat (session start, turn start/end, every 30 s). */
  lastSeen: string;
  /** Whether a turn is running. */
  busy: boolean;
  /** Written by `session.end` (the plugin API has no delete). */
  ended: boolean;
  /** Bound package (its `progress.json` folder name). */
  package: string | null;
  /** `auto`: the session's own tool call wrote it · `manual`: `/progress bind` (auto-binding never overrides it). */
  bindSource: 'auto' | 'manual' | null;
  /** A dialog open on the person right now (absent in records written by 0.3.x, which read as `null`). */
  decision?: Decision | null;
  /** The checkout's branch, read from git's `HEAD` (`null` when detached or unknown; absent in 0.3.x records). */
  branch?: string | null;
  /** Whether the checkout is a linked worktree, not the main checkout (absent in 0.3.x records). */
  worktree?: boolean;
  /** Subagents this session started: running ones, and the finished ones of the current turn (absent in 0.3.x records). */
  agents?: AgentRun[];
};

/** One subagent a session started. Only the short task label is kept, never the prompt given to it. */
export type AgentRun = {
  /** The tool call that started it. */
  id: string;
  /** The 3–5 word task label the model gave it. */
  description: string;
  status: 'running' | 'done' | 'failed';
  /** The id of an agent running in the background (its end arrives as SubagentStop). */
  agentId?: string;
};

/**
 * What a session's open dialog asks of the person, kept language-neutral (each reader words it in its own language). Only the tool's
 * NAME is kept, never its input (a command or a file's content never reaches the record).
 */
export type Decision = {
  /** `permission`: a permission prompt · `question`: AskUserQuestion · `plan`: a plan to approve (ExitPlanMode). */
  kind: 'permission' | 'question' | 'plan';
  tool: string;
  /** When the dialog opened (ISO): a new dialog has a new time, so it is announced again. */
  since: string;
};

declare module 'claude-code' {
  interface PluginState {
    'session-progress': {
      snapshot: Snapshot | null;
      /** Last seen state for notifications: package → "waitingOn.who|finished phase ids". */
      seen: Record<string, string>;
      /** This session's record (also written to its file; a hot reload continues from here). */
      self: SessionRecord | null;
      /** The language in use (kept across sessions in `$.store`; drawing reads it here so a switch redraws at once). */
      language: 'en' | 'tr';
    };
  }
}
