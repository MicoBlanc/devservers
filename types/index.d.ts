/** What keeps a dev server alive. An orphan's Claude session or terminal is gone. */
export type Owner =
  /** `startedBy` is `claude` when the shell Claude Code ran it in outlived the session. */
  | { kind: 'orphan'; startedBy: 'claude' | 'unknown' }
  | { kind: 'claude'; pid: number; since: number; where: string }
  | { kind: 'terminal'; pid: number; name: string }
  | { kind: 'app'; pid: number; name: string }

export type DevServer = {
  /** `pid@started`: a pid the OS hands to another process later reads as another server. */
  id: string
  pid: number
  /** ps `lstart`, checked again right before a stop. */
  started: string
  startedAt: number
  ports: number[]
  /** `Next.js 16.3.8`, `Vite`, or the package script that started it (`pnpm dev`). */
  framework: string
  /** The git checkout's name and the path inside it, else the folder's own name. */
  folder: string
  cwd: string
  /** Every process that exists only to run it. */
  pids: number[]
  /** Footprint of those processes, compressed and swapped pages included; null until measured. */
  memoryBytes: number | null
  owner: Owner
  /** Connections a browser tab or a tool holds on its ports right now. */
  clients: number
  /**
   * When someone last used it: `now` while a client is connected; for Next.js, the last page view,
   * browser message or server log its dev log records (`never` if none); otherwise `unknown`.
   */
  lastUsed: { kind: 'now' } | { kind: 'at'; at: number } | { kind: 'never' } | { kind: 'unknown' }
  /** What to type, and where, to start it again: `pnpm dev` in `/Users/ana/code/shop`. */
  start: { command: string; cwd: string }
}

/** A stop in progress, or the last one: every server it set out to stop and what came of each. */
export type Freeing = {
  ids: string[]
  exited: string[]
  refused: string[]
  targetBytes: number
  freedBytes: number
}

/** What devservers has freed on this Mac since it first stopped something. */
export type Lifetime = { bytes: number; since: number }

export type View = {
  servers: DevServer[] | null
  /** ps and lsof are being read: the rows are about to change. */
  isScanning: boolean
  /** top is being read: the memory figures are about to land. */
  isMeasuring: boolean
  /** The row showing its details and actions. */
  openId: string | null
  /** `orphans` while Free waits for its second press. */
  confirm: 'orphans' | null
  freeing: Freeing | null
  /** What stops have freed since the pane opened: drawn as empty track, so the top bar keeps its scale. */
  freedHere: number
  /** The server whose start command was just copied, for the button's "Copied". */
  copiedId: string | null
  /** The outcome of the last action, and the server to start again after a stop of one. */
  note: { text: string; restart: DevServer | null } | null
  lifetime: Lifetime | null
  /** $HOME, to write paths as `~/...`. */
  home: string
}

declare module 'claude-code' {
  interface PluginState {
    devservers: { view: View }
  }
}
