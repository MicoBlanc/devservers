/**
 * A made-up Mac, for the tests and for the README's recording: ana's projects, nobody's real
 * folders. `run` answers the commands devservers runs the way macOS does, and processes a kill
 * reaches exit `exitAfter` ms later (at once in the tests).
 */

export const HOME = '/Users/ana'

// pid, ppid, etime, lstart, command (uid 501 throughout).
const PROCESSES: readonly (readonly [number, number, string, string, string])[] = [
  [1, 0, '10-00:00:00', 'Mon Oct  6 08:00:00 2026', '/sbin/launchd'],
  // shop: an orphan whose pnpm hangs off launchd since the session that started it ended.
  [100, 1, '2-04:00:00', 'Wed Oct 15 16:00:00 2026', 'node /Users/ana/.local/bin/pnpm dev'],
  [101, 100, '2-04:00:00', 'Wed Oct 15 16:00:00 2026', 'node /Users/ana/code/shop/node_modules/.bin/../next/dist/bin/next dev'],
  [102, 101, '2-04:00:00', 'Wed Oct 15 16:00:00 2026', 'next-server (v15.0.3) '],
  // studio: an orphan Claude Code started; the shell it ran in outlived the session.
  [110, 1, '3-02:00:00', 'Tue Oct 14 18:00:00 2026', "/bin/zsh -c source /Users/ana/.claude/shell-snapshots/snapshot-zsh-1.sh && eval 'pnpm dev'"],
  [111, 110, '3-02:00:00', 'Tue Oct 14 18:00:00 2026', 'node /Users/ana/.local/bin/pnpm dev'],
  [112, 111, '3-02:00:00', 'Tue Oct 14 18:00:00 2026', 'node /Users/ana/code/studio/node_modules/.bin/../astro/astro.js dev'],
  // blog: a Vite app a Claude session started in an iTerm tab, with a browser tab connected.
  [190, 1, '5-00:00:00', 'Sun Oct 12 20:00:00 2026', '/Applications/iTerm.app/Contents/MacOS/iTerm2'],
  [195, 190, '5-00:00:00', 'Sun Oct 12 20:00:00 2026', '/Users/ana/Library/Application Support/iTerm2/iTermServer-3.7.1 /tmp/iterm.socket'],
  [196, 195, '3-00:00:00', 'Tue Oct 14 20:00:00 2026', '/usr/bin/login -fpl ana /Applications/iTerm.app/Contents/MacOS/ShellLauncher --launch_shell'],
  [197, 196, '3-00:00:00', 'Tue Oct 14 20:00:00 2026', '-zsh'],
  [200, 197, '3-00:00:00', 'Tue Oct 14 20:00:00 2026', 'claude --model opus'],
  [202, 200, '20:00:00', 'Fri Oct 17 00:00:00 2026', "/bin/zsh -c source /Users/ana/.claude/shell-snapshots/snapshot-zsh-2.sh && eval 'pnpm dev'"],
  [203, 202, '20:00:00', 'Fri Oct 17 00:00:00 2026', 'node /Users/ana/.local/bin/pnpm dev'],
  [204, 203, '20:00:00', 'Fri Oct 17 00:00:00 2026', 'node /Users/ana/code/blog/node_modules/.bin/../vite/bin/vite.js'],
  // mono: a monorepo's `turbo dev` in a Terminal tab, two apps under one turbo.
  [300, 1, '1-00:00:00', 'Thu Oct 16 20:00:00 2026', '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
  [301, 300, '1-00:00:00', 'Thu Oct 16 20:00:00 2026', '/usr/bin/login -pf ana'],
  [302, 301, '1-00:00:00', 'Thu Oct 16 20:00:00 2026', '-zsh'],
  [303, 302, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'node /opt/homebrew/bin/pnpm dev'],
  [304, 303, '05:00:00', 'Fri Oct 17 15:00:00 2026', '/Users/ana/code/mono/node_modules/turbo-darwin-arm64/bin/turbo run dev'],
  [305, 304, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'node /opt/homebrew/bin/pnpm run dev'],
  [306, 305, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'node /Users/ana/code/mono/node_modules/.bin/../next/dist/bin/next dev -p 3001'],
  [307, 306, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'next-server (v15.0.3) '],
  [308, 304, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'node /opt/homebrew/bin/pnpm run dev'],
  [309, 308, '05:00:00', 'Fri Oct 17 15:00:00 2026', 'node /Users/ana/code/mono/node_modules/vite/bin/vite.js --port 3002'],
  // Listening, and not dev servers.
  [400, 1, '9-00:00:00', 'Wed Oct  8 20:00:00 2026', '/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16'],
  [410, 1, '9-00:00:00', 'Wed Oct  8 20:00:00 2026', '/Applications/Figma.app/Contents/Helpers/figma_agent.app/Contents/MacOS/figma_agent'],
]
const LISTENING: Record<number, string> = {
  102: '*:3000',
  112: '127.0.0.1:4321',
  204: '127.0.0.1:5173',
  307: '*:3001',
  309: '[::1]:3002',
  400: '127.0.0.1:5432',
  410: '127.0.0.1:44950',
}
// A browser tab on blog; shop's own outgoing connection is no client of its port.
const CONNECTED: readonly (readonly [number, string])[] = [
  [204, '127.0.0.1:5173->127.0.0.1:55555'],
  [102, '127.0.0.1:60000->127.0.0.1:60001'],
]
const CWD: Record<number, string> = {
  100: '/Users/ana/code/shop',
  102: '/Users/ana/code/shop',
  111: '/Users/ana/code/studio',
  112: '/Users/ana/code/studio',
  200: '/Users/ana/code/blog',
  203: '/Users/ana/code/blog',
  204: '/Users/ana/code/blog',
  305: '/Users/ana/code/mono/apps/web',
  307: '/Users/ana/code/mono/apps/web',
  308: '/Users/ana/code/mono/apps/docs',
  309: '/Users/ana/code/mono/apps/docs',
}
const GIT_ROOT: Record<string, string> = {
  '/Users/ana/code/shop': '/Users/ana/code/shop',
  '/Users/ana/code/studio': '/Users/ana/code/studio',
  '/Users/ana/code/blog': '/Users/ana/code/blog',
  '/Users/ana/code/mono/apps/web': '/Users/ana/code/mono',
  '/Users/ana/code/mono/apps/docs': '/Users/ana/code/mono',
}
const MEGABYTES: Record<number, number> = {
  100: 30,
  101: 20,
  102: 4200,
  110: 2,
  111: 30,
  112: 2100,
  200: 500,
  202: 1,
  203: 30,
  204: 1500,
  303: 30,
  304: 40,
  305: 30,
  306: 20,
  307: 2000,
  308: 30,
  309: 900,
  400: 300,
}
export const SHOP_LOG = '/Users/ana/code/shop/.next/dev/logs/next-development.log'
export const WEB_LOG = '/Users/ana/code/mono/apps/web/.next/dev/logs/next-development.log'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const logLine = (timestamp: string, message: string, source = 'Server') => JSON.stringify({ timestamp, source, level: 'LOG', message })

export type FakeMac = {
  /** stdout of one command as macOS would print it; throws for a command devservers never runs. */
  run: (argv: readonly string[], now: number) => string
  /** Every kill's arguments, in order. */
  kills: string[][]
  /** Every URL `open` was handed. */
  opened: string[]
}

export function fakeMac({ system = 'Darwin', exitAfter = () => 0 }: { system?: string; exitAfter?: (pid: number) => number } = {}): FakeMac {
  const exits = new Map<number, number>()
  const kills: string[][] = []
  const opened: string[] = []
  const isLive = (pid: number, now: number) => (exits.get(pid) ?? Infinity) > now
  const lsof = (entries: readonly (readonly [number, string])[]) => entries.map(([pid, name]) => `p${pid}\nn${name}`).join('\n')

  const run = (argv: readonly string[], now: number) => {
    const [bin, ...args] = argv
    const live = <T,>(entries: readonly (readonly [number, T])[]) => entries.filter(([pid]) => isLive(pid, now))
    if (bin === '/usr/bin/uname') return `${system}\n`
    if (bin === '/bin/ps' && args[0] === '-axo')
      return PROCESSES.filter(([pid]) => isLive(pid, now))
        .map(([pid, ppid, etime, lstart, command]) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)}   501 ${etime.padStart(11)} ${lstart} ${command}`)
        .join('\n')
    if (bin === '/bin/ps')
      return (args[args.indexOf('-p') + 1] ?? '')
        .split(',')
        .filter(pid => isLive(Number(pid), now))
        .join('\n')
    if (bin === '/bin/kill') {
      kills.push([...args])
      for (const pid of args.slice(1).map(Number)) exits.set(pid, Math.min(exits.get(pid) ?? Infinity, now + (args[0] === '-KILL' ? 0 : exitAfter(pid))))
      return ''
    }
    if (bin === '/usr/sbin/lsof') {
      const pids = (args[args.indexOf('-p') + 1] ?? '').split(',').map(Number)
      if (args.includes('-sTCP:LISTEN')) return lsof(live(Object.entries(LISTENING).map(([pid, name]) => [Number(pid), name] as const)))
      if (args.includes('-sTCP:ESTABLISHED')) return lsof(live(CONNECTED).filter(([pid]) => pids.includes(pid)))
      return lsof(pids.flatMap(pid => (CWD[pid] ? [[pid, CWD[pid]] as const] : [])))
    }
    if (bin === '/bin/sh') return args.slice(3).map(dir => GIT_ROOT[dir] ?? '').join('\n')
    if (bin === '/usr/bin/top') return ['PID    MEM', ...live(Object.entries(MEGABYTES).map(([pid, mb]) => [Number(pid), mb] as const)).map(([pid, mb]) => `${pid}    ${mb}M`)].join('\n')
    if (bin === '/usr/bin/tail')
      return [
        `==> ${SHOP_LOG} <==`,
        logLine('10:00:00.000', '[INFO] GET /checkout 200 in 41ms'),
        logLine('50:00:00.000', '✓ Finished writing to filesystem cache in 16.4s'),
        '',
        `==> ${WEB_LOG} <==`,
        logLine('04:30:00.000', 'Error', 'Browser'),
        '',
        '==> /dev/null <==',
      ].join('\n')
    // The last line of shop's log, a cache write, came an hour ago; web's, half an hour ago.
    if (bin === '/usr/bin/stat') return `${(now - HOUR) / 1000} ${SHOP_LOG}\n${(now - 30 * MINUTE) / 1000} ${WEB_LOG}\n`
    if (bin === '/usr/bin/open') {
      opened.push(args[0] ?? '')
      return ''
    }
    throw new Error(`unexpected command: ${argv.join(' ')}`)
  }
  return { run, kills, opened }
}
