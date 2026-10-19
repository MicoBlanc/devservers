import type { Register } from 'claude-code'

import { HOME, fakeMac } from '../machine'

// How long each made-up server takes to exit once stopped, so they leave one by one on screen.
const EXIT_MS: Record<number, number> = { 100: 600, 101: 600, 102: 600, 110: 1400, 111: 1400, 112: 1400 }
// About as long as top takes on a real Mac.
const TOP_MS = 1800
const GB = 1024 ** 3
const DAY = 86_400_000

// A hook that fails would let the call through to the real Mac: refuse it instead.
function refuse() {
  return { deny: 'devservers-demo could not answer' }
}

/**
 * Answers devservers' calls for the made-up Mac in `../machine`. Run a session with
 * `claude --plugin-dir <this folder>` beside the installed devservers; nothing else is touched.
 */
export const register: Register = on => {
  const mac = fakeMac({ exitAfter: pid => EXIT_MS[pid] ?? 1000 })
  const store = new Map<string, unknown>()
  let isSeeded = false
  const isDevservers = (plugin: string) => plugin === 'devservers'

  on('process.run', async ($, e, next) => {
    if (!isDevservers(next.origin.plugin)) return next(e)
    if (e.argv[0] === '/usr/bin/top') await $.clock.sleep(TOP_MS)
    const stdout = mac.run(e.argv, await $.clock.now())
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  }).catch(refuse)
  on('env.get', ($, e, next) => {
    if (!isDevservers(next.origin.plugin)) return next(e)
    if (e.name === 'HOME') return { value: HOME }
    return e.name === 'USER' ? { value: 'ana' } : next(e)
  }).catch(refuse)
  on('store.get', async ($, e, next) => {
    if (!isDevservers(next.origin.plugin)) return next(e)
    // ana has been using devservers for a couple of weeks.
    if (!isSeeded) store.set('freed', { bytes: 212 * GB, since: (await $.clock.now()) - 15 * DAY })
    isSeeded = true
    return { value: store.get(e.key) }
  }).catch(refuse)
  on('store.set', ($, e, next) => {
    if (!isDevservers(next.origin.plugin)) return next(e)
    store.set(e.key, e.value)
    return { value: undefined }
  }).catch(refuse)
}
