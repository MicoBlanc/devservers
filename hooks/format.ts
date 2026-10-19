import type { DevServer, Lifetime, Owner } from '../types'

const GB = 1024 ** 3
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RANK: Record<Owner['kind'], number> = { orphan: 0, claude: 1, terminal: 2, app: 3 }

export const size = (bytes: number) =>
  bytes <= 0 ? '0 GB' : bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
export const total = (servers: readonly DevServer[]) => servers.reduce((sum, s) => sum + (s.memoryBytes ?? 0), 0)
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export const port = (s: DevServer) => (s.ports[0] ? `:${s.ports[0]}` : 'no port')
// What Free stops: an orphan someone has open in a browser stays, a press on its own row stops it.
export const isIdleOrphan = (s: DevServer) => s.owner.kind === 'orphan' && !s.clients
export const idleOrphans = (servers: readonly DevServer[]) => servers.filter(isIdleOrphan)

export function span(ms: number) {
  const s = ms / 1000
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min`
  if (s < 172800) return `${Math.round(s / 3600)} h`
  return `${Math.round(s / 86400)} days`
}

/** The last-used column: in use now, how long ago its dev log saw someone, or how long it has been up. */
export function usage(s: DevServer, now: number): { text: string; tone: 'strong' | 'plain' | 'quiet' } {
  const used = s.lastUsed
  if (used.kind === 'now') return { text: 'in use now', tone: 'strong' }
  if (used.kind === 'at') return { text: now - used.at < 90_000 ? 'just now' : `${span(now - used.at)} ago`, tone: 'plain' }
  if (used.kind === 'never') return { text: 'not opened', tone: 'quiet' }
  return { text: `up ${span(now - s.startedAt)}`, tone: 'quiet' }
}

export function ownerTitle(o: Owner, now: number) {
  if (o.kind === 'orphan') return 'Orphaned · what started them is gone'
  if (o.kind === 'claude') return `Claude session in ${o.where} · open ${span(now - o.since)}`
  return o.kind === 'terminal' ? `Started in ${o.name}` : `Started by ${o.name}`
}

export function startedLine(s: DevServer, now: number) {
  const by = s.owner.kind === 'orphan' && s.owner.startedBy === 'claude' ? ' by a Claude session that has since ended' : ''
  return `Started ${span(now - s.startedAt)} ago${by}`
}

/** The line Copy start command puts on the clipboard: `cd ~/code/shop && pnpm dev`. */
export function restartLine(s: DevServer, home: string) {
  const shown = home && s.start.cwd.startsWith(`${home}/`) ? `~${s.start.cwd.slice(home.length)}` : s.start.cwd
  const where = /^[\w@%+=:,./~-]+$/.test(shown) ? shown : `'${s.start.cwd.replace(/'/g, `'\\''`)}'`
  return `cd ${where} && ${s.start.command}`
}

export function lifetimeLine(lifetime: Lifetime, now: number) {
  const since = new Date(lifetime.since)
  const today = new Date(now)
  const when = since.toDateString() === today.toDateString() ? 'today' : `since ${MONTHS[since.getMonth()]} ${since.getDate()}`
  return `${size(lifetime.bytes)} freed ${when}`
}

export function summary(servers: readonly DevServer[]) {
  if (!servers.length) return 'No dev servers are running.'
  const orphans = idleOrphans(servers)
  return `${count(servers.length, 'dev server holds', 'dev servers hold')} ${size(total(servers))}. ${count(orphans.length, 'orphan holds', 'orphans hold')} ${size(total(orphans))}.`
}

/** The servers by what started them: orphans first, then Claude sessions oldest first, then terminals and apps. */
export function groupsOf(servers: readonly DevServer[]): [string, DevServer[]][] {
  const groups = new Map<string, DevServer[]>()
  for (const s of servers) {
    const key = s.owner.kind === 'orphan' ? 'orphan' : `${s.owner.kind}:${s.owner.pid}`
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  const since = (o: Owner | undefined) => (o?.kind === 'claude' ? o.since : 0)
  return [...groups.entries()].sort(([keyA, [a]], [keyB, [b]]) => {
    const kinds = RANK[a?.owner.kind ?? 'app'] - RANK[b?.owner.kind ?? 'app']
    return kinds || since(a?.owner) - since(b?.owner) || keyA.localeCompare(keyB)
  })
}

export function table(servers: readonly DevServer[], now: number) {
  const rows = groupsOf(servers).flatMap(([, group]) =>
    group.map(s => [port(s), s.folder, s.framework, s.memoryBytes === null ? '?' : size(s.memoryBytes), usage(s, now).text, s.owner.kind === 'orphan' ? 'orphaned' : ownerTitle(s.owner, now)]),
  )
  const widths = rows.reduce((w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), [] as number[])
  return [summary(servers), '', ...rows.map(row => row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  '))].join('\n')
}
