import type { EngineInterface } from 'claude-code'

import type { DevServer, Owner } from '../types'

type Proc = { pid: number; ppid: number; uid: number; startedAt: number; started: string; command: string }
type Server = { top: Proc; root: number; framework: string; ports: number[]; listeners: number[]; chain: Proc[] }

const C_LOCALE = { LC_ALL: 'C', LANG: 'C' }
const PS = ['/bin/ps', '-axo', 'pid=,ppid=,uid=,etime=,lstart=,command=']

// Matched on the process listening on the port, then on the processes that started it, nearest
// first. Next.js 13 and later serve from a child process named `next-server (vX.Y.Z)`.
const FRAMEWORKS: readonly (readonly [string, RegExp])[] = [
  ['Next.js', /^next-server\b|(^|[\s/])next\s+dev\b|\/next\/dist\/bin\/next\s+dev\b/],
  ['Vite', /\/vite\/bin\/vite\.js\b|(^|[\s/])vite(\s|$)/],
  ['Astro', /\/astro\/astro\.js\s+dev\b|(^|[\s/])astro\s+dev\b/],
  ['Nuxt', /\/nuxi\/bin\/nuxi\.mjs\s+dev\b|(^|[\s/])(nuxi|nuxt)\s+dev\b/],
  ['Storybook', /\/storybook\/(bin\/)?index\.c?js\s+dev\b|(^|[\s/])storybook\s+dev\b/],
  ['Angular', /@angular\/cli\/bin\/ng(\.js)?\s+serve\b|(^|[\s/])ng\s+serve\b/],
  ['webpack', /\/webpack\/bin\/webpack\.js\s+serve\b|webpack-dev-server\b/],
  ['Expo', /\/expo\/bin\/cli\s+start\b|(^|[\s/])expo\s+start\b/],
  ['Gatsby', /\/gatsby\/cli\.js\s+develop\b|(^|[\s/])gatsby\s+develop\b/],
  ['Docusaurus', /(^|[\s/])docusaurus\s+start\b/],
  ['Remix', /(^|[\s/])remix\s+(vite:)?dev\b/],
]
// How most people start one of the above, or a server of their own.
const SCRIPT = /(^|[\s/])(pnpm|npm|yarn|bun)(\.c?js)?\s+(run\s+)?(dev|start|serve)\b/
// Where a dev server's own processes end: the Claude session, shell, terminal or app that started it.
const CLAUDE = /(^|\/)claude(\s|$)/
// The shell Claude Code's Bash tool runs each command in; it can outlive the session that started it.
const CLAUDE_SHELL = /\/\.claude\/shell-snapshots\//
const SHELL = /^-\S+$|^(\S*\/)?(zsh|bash|fish|sh)(\s+-[il]+)*$/
const MULTIPLEXER = /(^|\/)(tmux|screen)(:|\s|$)/
const TERMINAL_HOST = /iTermServer|(^|\/)login\s/
const APP = /\/([^/]+)\.app\//
const NEXT_LOG = '.next/dev/logs/next-development.log'
// Turbopack writes these to the Next.js dev log on its own schedule, with nobody using the server.
const HOUSEKEEPING = /filesystem cache|cache database compaction/i
const NPX = /(^|[\s/])(npx|npm exec)\s+(.+)$/
const INTERPRETER = /^(?:\S*\/)?(?:node|bun|deno)\s+(\S+)(.*)$/
const STOP_GRACE_MS = 8000
const POLL_MS = 250
const UNIT: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }

/** ps `etime`, `[[dd-]hh:]mm:ss`, or a dev log's `hh:mm:ss.mmm` (hours past 24), in seconds. */
export function clockSeconds(text: string): number {
  const dash = text.indexOf('-')
  const days = dash < 0 ? 0 : Number(text.slice(0, dash))
  return days * 86400 + text.slice(dash + 1).split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

export function parsePs(stdout: string, now: number): Map<number, Proc> {
  const procs = new Map<number, Proc>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line)
    if (!m) continue
    const [, pid, ppid, uid, etime, started, command] = m
    procs.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      uid: Number(uid),
      startedAt: now - clockSeconds(etime ?? '0') * 1000,
      started: (started ?? '').replace(/\s+/g, ' '),
      command: (command ?? '').trim(),
    })
  }
  return procs
}

/** lsof `-Fpn`: pid -> the NAME of every file it matched. */
export function parseLsof(stdout: string): Map<number, string[]> {
  const names = new Map<number, string[]>()
  let current: string[] | undefined
  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) {
      current = []
      names.set(Number(line.slice(1)), current)
    } else if (line.startsWith('n') && current) current.push(line.slice(1))
  }
  return names
}

/** `top -l 1 -stats pid,mem`: Activity Monitor's Memory column, compressed and swapped pages included. */
export function parseTop(stdout: string): Map<number, number> {
  const bytes = new Map<number, number>()
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+([\d.]+)([BKMG])/.exec(line)
    if (m) bytes.set(Number(m[1]), Number(m[2]) * (UNIT[m[3] ?? 'B'] ?? 1))
  }
  return bytes
}

function portOf(address: string) {
  const port = Number(address.slice(address.lastIndexOf(':') + 1))
  return Number.isInteger(port) && port > 0 ? port : null
}

/**
 * When each Next.js dev log last recorded someone: `tail` of every log (with /dev/null so each
 * gets a header) and `stat` mtimes. Lines carry time since the server started, so the last real
 * line's clock time is the file's mtime less how long after it the last line was written.
 */
export function parseDevLogs(tail: string, stat: string): Map<string, number | null> {
  const mtimes = new Map<string, number>()
  for (const line of stat.split('\n')) {
    const space = line.indexOf(' ')
    if (space > 0) mtimes.set(line.slice(space + 1), Number(line.slice(0, space)) * 1000)
  }
  const blocks = new Map<string, string[]>()
  let lines: string[] | undefined
  for (const line of tail.split('\n')) {
    const header = /^==> (.*) <==$/.exec(line)
    if (header) {
      lines = []
      blocks.set(header[1] ?? '', lines)
    } else if (lines && line.trim()) lines.push(line)
  }
  const used = new Map<string, number | null>()
  for (const [path, body] of blocks) {
    const mtime = mtimes.get(path)
    if (mtime === undefined) continue
    let last: number | undefined
    let lastReal: number | undefined
    for (let i = body.length - 1; i >= 0 && lastReal === undefined; i -= 1) {
      const entry = readLogLine(body[i] ?? '')
      if (!entry) continue
      last ??= entry.seconds
      if (!HOUSEKEEPING.test(entry.message)) lastReal = entry.seconds
    }
    used.set(path, last === undefined || lastReal === undefined ? null : mtime - (last - lastReal) * 1000)
  }
  return used
}

function readLogLine(line: string): { seconds: number; message: string } | null {
  if (!line.startsWith('{')) return null
  try {
    const entry = JSON.parse(line) as { timestamp?: unknown; message?: unknown }
    if (typeof entry.timestamp !== 'string') return null
    return { seconds: clockSeconds(entry.timestamp), message: String(entry.message ?? '') }
  } catch {
    // A line cut by tail or by a crash mid-write.
    return null
  }
}

function childrenOf(procs: Map<number, Proc>) {
  const children = new Map<number, number[]>()
  for (const p of procs.values()) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid])
  return children
}

function subtree(root: number, children: Map<number, number[]>) {
  const out: number[] = []
  const stack = [root]
  while (stack.length) {
    const pid = stack.pop() as number
    out.push(pid)
    stack.push(...(children.get(pid) ?? []))
  }
  return out
}

/** The Claude session, shell, terminal or app a dev server's own processes end at. */
function isBoundary(p: Proc) {
  return p.pid <= 1 || CLAUDE.test(p.command) || SHELL.test(p.command) || MULTIPLEXER.test(p.command) || TERMINAL_HOST.test(p.command) || APP.test(p.command)
}

/** The processes from `pid` up to the boundary that started it, nearest first. */
function chainOf(pid: number, procs: Map<number, Proc>) {
  const chain: Proc[] = []
  for (let p = procs.get(pid); p && !isBoundary(p) && chain.length < 64; p = procs.get(p.ppid)) chain.push(p)
  return chain
}

/** What the listening process is, read off it and the processes that started it; null for anything else. */
function frameworkOf(chain: readonly Proc[]): string | null {
  for (const p of chain) {
    for (const [name, test] of FRAMEWORKS) {
      if (!test.test(p.command)) continue
      const version = name === 'Next.js' ? /next-server \(v([\d.]+)\)/.exec(p.command)?.[1] : undefined
      return version ? `${name} ${version}` : name
    }
  }
  for (const p of chain) {
    const m = SCRIPT.exec(p.command)
    if (m) return `${m[2]} ${m[4] ?? ''}${m[5]}`
  }
  return null
}

function ownerOf(server: Server, procs: Map<number, Proc>): Owner {
  const root = procs.get(server.root) ?? server.top
  let shell: number | null = null
  let multiplexer: string | null = null
  for (let p = procs.get(root.ppid), hops = 0; p && p.pid > 1 && hops < 64; p = procs.get(p.ppid), hops += 1) {
    if (CLAUDE.test(p.command)) return { kind: 'claude', pid: p.pid, since: p.startedAt, where: '' }
    if (shell === null && SHELL.test(p.command)) shell = p.pid
    multiplexer ??= MULTIPLEXER.exec(p.command)?.[2] ?? null
    const app = APP.exec(p.command)?.[1]
    if (app) return shell === null ? { kind: 'app', pid: p.pid, name: app } : { kind: 'terminal', pid: shell, name: multiplexer ?? app }
  }
  if (shell !== null) return { kind: 'terminal', pid: shell, name: multiplexer ?? 'a terminal' }
  return { kind: 'orphan', startedBy: server.chain.some(p => CLAUDE_SHELL.test(p.command)) ? 'claude' : 'unknown' }
}

/**
 * What to type to start a server again, read off its processes nearest first: the package script
 * (`pnpm dev`), an npx, the framework's own command run through npx, else the listener's own line.
 * Claude Code's wrapper shell is skipped: its line holds the session's exports, not the command.
 */
export function startCommand(commands: readonly string[]): { index: number; command: string } {
  const lines = [...commands.entries()].filter(([, command]) => !CLAUDE_SHELL.test(command))
  for (const [index, command] of lines) {
    const m = SCRIPT.exec(command)
    if (m) return { index, command: command.slice(m.index + (m[1]?.length ?? 0)).replace(/^(pnpm|npm|yarn|bun)\.c?js\b/, '$1') }
  }
  for (const [index, command] of lines) {
    const m = NPX.exec(command)
    if (m) return { index, command: `npx ${m[3]}` }
  }
  for (const [index, command] of lines) {
    if (command.startsWith('next-server') || !FRAMEWORKS.some(([, test]) => test.test(command))) continue
    const m = INTERPRETER.exec(command)
    if (!m) return { index, command }
    const script = m[1] ?? ''
    const modules = script.lastIndexOf('/node_modules/')
    if (modules < 0) return { index, command: `${script}${m[2]}` }
    const base = script.slice(script.lastIndexOf('/') + 1).replace(/\.[cm]?js$/, '')
    const inside = script.slice(modules + '/node_modules/'.length).split('/')
    const name = base === 'index' || base === 'cli' ? inside.slice(0, inside[0]?.startsWith('@') ? 2 : 1).join('/') : base
    return { index, command: `npx ${name}${m[2]}` }
  }
  return { index: 0, command: commands[0] ?? '' }
}

/**
 * Every dev server: the user's listening processes that a framework or a package script started,
 * one per process tree. Its root is the highest process that exists only to run it, so stopping
 * one app of a `turbo dev` never takes its siblings down.
 */
function serversOf(procs: Map<number, Proc>, listening: Map<number, string[]>): Server[] {
  const children = childrenOf(procs)
  const found: { proc: Proc; framework: string; chain: Proc[]; ports: number[] }[] = []
  for (const [pid, names] of listening) {
    const proc = procs.get(pid)
    if (!proc) continue
    const chain = chainOf(pid, procs)
    const framework = frameworkOf(chain)
    const ports = names.map(portOf).filter((p): p is number => p !== null)
    if (framework && ports.length) found.push({ proc, framework, chain, ports })
  }
  // A listener started by another listener (a framework's own child) belongs to that one's server.
  const tops = found.filter(f => !f.chain.slice(1).some(a => found.some(o => o.proc.pid === a.pid)))
  const topPids = new Set(tops.map(t => t.proc.pid))
  return tops.map(t => {
    const members = found.filter(f => f === t || f.chain.some(a => a.pid === t.proc.pid))
    const others = new Set([...topPids].filter(pid => pid !== t.proc.pid))
    let root = t.proc
    for (const parent of t.chain.slice(1)) {
      if (parent.uid !== root.uid || subtree(parent.pid, children).some(pid => others.has(pid))) break
      root = parent
    }
    return {
      top: t.proc,
      root: root.pid,
      framework: t.framework,
      ports: [...new Set(members.flatMap(m => m.ports))].sort((a, b) => a - b),
      listeners: members.map(m => m.proc.pid),
      chain: t.chain,
    }
  })
}

async function lsof($: EngineInterface, select: string[]) {
  return parseLsof((await $.process.run(['/usr/sbin/lsof', '-nP', ...select, '-Fpn'], { env: C_LOCALE })).stdout)
}

async function detect($: EngineInterface) {
  const now = await $.clock.now()
  const user = (await $.env.get('USER')) ?? (await $.process.run(['/usr/bin/id', '-un'])).stdout.trim()
  const [ps, listening] = await Promise.all([
    $.process.run(PS, { env: C_LOCALE }),
    lsof($, ['-iTCP', '-sTCP:LISTEN', '-a', '-u', user]),
  ])
  const procs = parsePs(ps.stdout, now)
  return { now, procs, servers: serversOf(procs, listening) }
}

/** Where a folder sits: its git checkout's name and the path inside it, else the folder's own name. */
async function foldersOf($: EngineInterface, dirs: string[]) {
  const roots = (
    await $.process.run(['/bin/sh', '-c', 'for d; do git -C "$d" rev-parse --show-toplevel 2>/dev/null || echo; done', 'devservers', ...dirs])
  ).stdout.split('\n')
  return dirs.map((dir, i) => {
    const root = roots[i] ?? ''
    const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
    return root && dir.startsWith(root) ? base(root) + dir.slice(root.length) : base(dir)
  })
}

/**
 * Every dev server, read in a fraction of a second: everything but memory, which `measure` reads
 * after (top takes two to three seconds). Sorted by port.
 */
export async function scan($: EngineInterface): Promise<DevServer[]> {
  const { procs, servers } = await detect($)
  if (!servers.length) return []
  const children = childrenOf(procs)
  const owners = servers.map(s => ownerOf(s, procs))
  const starts = servers.map(s => startCommand(s.chain.map(p => p.command)))
  const startPids = servers.map((s, i) => s.chain[starts[i]?.index ?? 0]?.pid ?? s.top.pid)
  const sessions = [...new Set(owners.flatMap(o => (o.kind === 'claude' ? [o.pid] : [])))]
  const [connected, cwds] = await Promise.all([
    lsof($, ['-iTCP', '-sTCP:ESTABLISHED', '-a', '-p', servers.flatMap(s => s.listeners).join(',')]),
    lsof($, ['-a', '-p', [...new Set([...servers.map(s => s.top.pid), ...startPids, ...sessions])].join(','), '-d', 'cwd']),
  ])
  const cwdOf = (pid: number) => cwds.get(pid)?.[0]
  const dirs = servers.map(s => cwdOf(s.top.pid) ?? '/')
  const [folders, sessionFolders] = await Promise.all([foldersOf($, dirs), foldersOf($, sessions.map(pid => cwdOf(pid) ?? '/'))])
  const logs = servers.flatMap((s, i) => (s.framework.startsWith('Next.js') ? [`${dirs[i]}/${NEXT_LOG}`] : []))
  const lastLogged = logs.length
    ? await Promise.all([
        $.process.run(['/usr/bin/tail', '-n', '200', ...logs, '/dev/null']),
        $.process.run(['/usr/bin/stat', '-f', '%m %N', ...logs]),
      ]).then(([tail, stat]) => parseDevLogs(tail.stdout, stat.stdout))
    : new Map<string, number | null>()

  return servers
    .map((s, i): DevServer => {
      const owner = owners[i] ?? { kind: 'orphan', startedBy: 'unknown' }
      const clients = s.listeners
        .flatMap(pid => connected.get(pid) ?? [])
        .filter(name => name.includes('->') && s.ports.includes(portOf(name.split('->')[0] ?? '') ?? -1)).length
      return {
        id: `${s.top.pid}@${s.top.started}`,
        pid: s.top.pid,
        started: s.top.started,
        startedAt: s.top.startedAt,
        ports: s.ports,
        framework: s.framework,
        folder: folders[i] ?? '?',
        cwd: dirs[i] ?? '/',
        pids: subtree(s.root, children),
        memoryBytes: null,
        owner: owner.kind === 'claude' ? { ...owner, where: sessionFolders[sessions.indexOf(owner.pid)] ?? '?' } : owner,
        clients,
        lastUsed: clients ? { kind: 'now' } : usedAt(lastLogged.get(`${dirs[i]}/${NEXT_LOG}`)),
        start: { command: starts[i]?.command ?? '', cwd: cwdOf(startPids[i] ?? s.top.pid) ?? dirs[i] ?? '/' },
      }
    })
    .sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0))
}

/** A dev log's verdict: no log at all, a log that records nobody, or when it last did. */
function usedAt(logged: number | null | undefined): DevServer['lastUsed'] {
  if (logged === undefined) return { kind: 'unknown' }
  return logged === null ? { kind: 'never' } : { kind: 'at', at: logged }
}

/** Each server's footprint, by id: one `top` sample, summed over the processes that run it. */
export async function measure($: EngineInterface, servers: readonly DevServer[]): Promise<Map<string, number>> {
  if (!servers.length) return new Map()
  const memory = parseTop((await $.process.run(['/usr/bin/top', '-l', '1', '-stats', 'pid,mem'], { env: C_LOCALE })).stdout)
  return new Map(servers.map(s => [s.id, s.pids.reduce((sum, pid) => sum + (memory.get(pid) ?? 0), 0)]))
}

async function alive($: EngineInterface, pids: number[]) {
  const { stdout } = await $.process.run(['/bin/ps', '-o', 'pid=', '-p', pids.join(',')])
  return new Set(stdout.split(/\s+/).filter(Boolean).map(Number))
}

export type StopOutcome = { id: string; isStopped: true } | { id: string; isStopped: false; reason: string }

/**
 * Stops servers and every process that exists only to run each: SIGTERM to all of them at once,
 * SIGKILL to whatever is left after 8 s. Yields each server once its processes are gone, so a
 * drawing can follow them out one by one; refuses one whose pid is gone or now another process's.
 */
export async function* stopServers($: EngineInterface, targets: readonly Pick<DevServer, 'id' | 'pid' | 'started'>[]): AsyncGenerator<StopOutcome> {
  const { procs, servers } = await detect($)
  const children = childrenOf(procs)
  const pending = new Map<string, number[]>()
  for (const target of targets) {
    const live = servers.find(s => s.top.pid === target.pid && s.top.started === target.started)
    if (live) pending.set(target.id, subtree(live.root, children))
    else yield { id: target.id, isStopped: false, reason: 'it had already stopped' }
  }
  if (!pending.size) return
  await $.process.run(['/bin/kill', '-TERM', ...[...pending.values()].flat().map(String)])
  for (let waited = POLL_MS; pending.size; waited += POLL_MS) {
    await $.clock.sleep(POLL_MS)
    const running = await alive($, [...pending.values()].flat())
    for (const [id, pids] of pending) {
      if (pids.some(pid => running.has(pid))) continue
      pending.delete(id)
      yield { id, isStopped: true }
    }
    if (!pending.size || waited < STOP_GRACE_MS) continue
    await $.process.run(['/bin/kill', '-KILL', ...[...pending.values()].flat().filter(pid => running.has(pid)).map(String)])
    for (const id of [...pending.keys()]) {
      pending.delete(id)
      yield { id, isStopped: true }
    }
  }
}

/** macOS is the one system whose ps, lsof and top output this reads. */
export async function isSupported($: EngineInterface) {
  return (await $.process.run(['/usr/bin/uname', '-s'])).stdout.trim() === 'Darwin'
}
