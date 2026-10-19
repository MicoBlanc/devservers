import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { DevServer, Freeing, Lifetime, View } from '../types'
import { count, port, restartLine, size, total } from './format'
import { measure, scan, stopServers } from './scan'

export const PANE = 'devservers'
const LIFETIME = 'freed'
// How long stopped rows stay drained on screen before they fold away.
const HOLD_MS = 1200
const COPIED_MS = 2000

const view = atom({ plugin: 'devservers', key: 'view' } as const, {
  servers: null,
  isScanning: false,
  isMeasuring: false,
  openId: null,
  confirm: null,
  freeing: null,
  freedHere: 0,
  copiedId: null,
  note: null,
  lifetime: null,
  home: '',
})

// The pane and the commands reach the view through these two, so its reads and writes stay in this file.
export function viewOf($: EngineInterface) {
  return read($, view)
}

export function changeView($: EngineInterface, change: (v: View) => View) {
  return update($, view, change)
}

const isLifetime = (value: unknown): value is Lifetime =>
  typeof value === 'object' && value !== null && typeof (value as Lifetime).bytes === 'number' && typeof (value as Lifetime).since === 'number'

/** Reads what the view needs from outside the session: $HOME, and the total freed on this Mac. */
export async function prepare($: EngineInterface) {
  const [home, stored] = await Promise.all([$.env.get('HOME'), $.store.get(LIFETIME)])
  await update($, view, v => ({ ...v, home: home ?? '', lifetime: isLifetime(stored) ? stored : null }))
}

/**
 * Reads the servers again without emptying the screen: rows land in a fraction of a second with
 * the memory figures they had, and top's new figures replace them in place a few seconds later.
 * Without `remeasure`, top runs only for servers that have no figure yet.
 */
export async function refresh($: EngineInterface, { remeasure = true } = {}): Promise<DevServer[]> {
  await update($, view, v => ({ ...v, isScanning: true }))
  const known = new Map(((await read($, view)).servers ?? []).map(s => [s.id, s.memoryBytes]))
  const fresh = (await scan($)).map(s => ({ ...s, memoryBytes: known.get(s.id) ?? null }))
  const needsTop = fresh.some(s => remeasure || s.memoryBytes === null)
  await update($, view, v => ({ ...v, servers: fresh, isScanning: false, isMeasuring: needsTop }))
  if (!needsTop) return fresh
  const memory = await measure($, fresh)
  await update($, view, v => ({ ...v, isMeasuring: false, servers: v.servers?.map(s => ({ ...s, memoryBytes: memory.get(s.id) ?? s.memoryBytes })) ?? null }))
  return fresh.map(s => ({ ...s, memoryBytes: memory.get(s.id) ?? s.memoryBytes }))
}

// Takes one stop's servers out of the progress the header shows; another stop may still be running.
const settle = (f: Freeing | null, ids: readonly string[], targetBytes: number, freedBytes: number): Freeing | null => {
  const rest = f?.ids.filter(id => !ids.includes(id)) ?? []
  if (!f || !rest.length) return null
  const keep = (list: string[]) => list.filter(id => !ids.includes(id))
  return { ids: rest, exited: keep(f.exited), refused: keep(f.refused), targetBytes: f.targetBytes - targetBytes, freedBytes: f.freedBytes - freedBytes }
}

/**
 * Stops `targets` together and follows them out: each row drains as its processes exit and the
 * header counts what came back. The drained rows hold for a moment, then fold away. Resolves the
 * note that says what happened, and the server to start again when it was one. A stop pressed in
 * the pane says so in a toast too when the pane was closed before it finished.
 */
export async function stopAll($: EngineInterface, targets: readonly DevServer[], from: 'pane' | 'command'): Promise<{ text: string; restart: DevServer | null }> {
  const ids = targets.map(s => s.id)
  await update($, view, v => {
    const f = v.freeing ?? { ids: [], exited: [], refused: [], targetBytes: 0, freedBytes: 0 }
    return { ...v, confirm: null, note: null, freeing: { ...f, ids: [...f.ids, ...ids], targetBytes: f.targetBytes + total(targets) } }
  })
  const stopped: DevServer[] = []
  let reason = ''
  for await (const outcome of stopServers($, targets)) {
    const server = targets.find(s => s.id === outcome.id)
    if (!server) continue
    if (outcome.isStopped) stopped.push(server)
    else reason = outcome.reason
    await update($, view, v => {
      if (!v.freeing) return v
      return outcome.isStopped
        ? { ...v, freeing: { ...v.freeing, exited: [...v.freeing.exited, server.id], freedBytes: v.freeing.freedBytes + (server.memoryBytes ?? 0) } }
        : { ...v, freeing: { ...v.freeing, refused: [...v.freeing.refused, server.id] } }
    })
  }

  const freed = total(stopped)
  if (freed > 0) {
    const now = await $.clock.now()
    const before = (await read($, view)).lifetime
    const lifetime = { bytes: (before?.bytes ?? 0) + freed, since: before?.since ?? now }
    await $.store.set(LIFETIME, lifetime)
    await update($, view, v => ({ ...v, lifetime }))
  }
  const one = targets.length === 1 ? targets[0] : undefined
  const gained = freed > 0 ? ` and freed ${size(freed)}` : ''
  const text = one
    ? stopped.length
      ? `Stopped ${one.folder} (${port(one)})${gained}.`
      : `Didn't stop ${one.folder}: ${reason}.`
    : `Stopped ${count(stopped.length, 'server', 'servers')}${gained}.${stopped.length < targets.length ? ` ${targets.length - stopped.length} had already stopped.` : ''}`
  const note = { text, restart: one && stopped.length ? one : null }

  await $.clock.sleep(HOLD_MS)
  const gone = stopped.map(s => s.id)
  await update($, view, v => ({
    ...v,
    note,
    openId: gone.includes(v.openId ?? '') ? null : v.openId,
    servers: v.servers?.filter(s => !gone.includes(s.id)) ?? null,
    freeing: settle(v.freeing, ids, total(targets), freed),
    freedHere: v.freedHere + freed,
  }))
  if (from === 'pane' && !(await $.ui.panes()).some(pane => pane.id === PANE)) $.ui.toast(text, { timeoutMs: 6000 })
  await refresh($, { remeasure: false })
  return note
}

/** Puts the line that starts `server` again on the clipboard, and says Copied for a moment. */
export async function copyStart($: EngineInterface, server: DevServer, surface: RenderSurface) {
  const { home } = await read($, view)
  const copied = await $.ui.copy({ text: restartLine(server, home), surface })
  if (!copied.isCopied) {
    await update($, view, v => ({ ...v, note: { text: `Couldn't copy here. To start it again: ${restartLine(server, home)}`, restart: null } }))
    return
  }
  await update($, view, v => ({ ...v, copiedId: server.id }))
  await $.clock.sleep(COPIED_MS)
  await update($, view, v => (v.copiedId === server.id ? { ...v, copiedId: null } : v))
}

/** Opens the server in the browser; the row then reads "in use now". */
export async function openInBrowser($: EngineInterface, server: DevServer) {
  if (!server.ports[0]) return
  await $.process.run(['/usr/bin/open', `http://localhost:${server.ports[0]}`])
  await $.clock.sleep(1500)
  await refresh($, { remeasure: false })
}
