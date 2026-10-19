import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { HOME, fakeMac } from '../demo/machine'
import { startCommand } from '../hooks/scan'

const SURFACES = ['terminal', 'desktop'] as const
const NOW = 1_792_281_600_000
const HOUR = 3_600_000
const DAY = 24 * HOUR
const GB = 1024 ** 3
const PANE = {
  plugin: 'devservers',
  component: 'Pane',
  requestId: 'devservers',
  props: { title: 'Dev servers', isFocused: true, bodyColumns: 110, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const SHOP = '102@Wed Oct 15 16:00:00 2026'
const STUDIO = '112@Tue Oct 14 18:00:00 2026'
// What the engine stamps on a command typed into the composer of a 120-column terminal.
const typed = (args = '') => ({ command: 'devservers', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

type Options = { system?: string; exitAfter?: (pid: number) => number; topMs?: number; store?: Record<string, unknown> }

async function start($: Engine, on: On, { system, exitAfter, topMs = 0, store }: Options = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME, USER: 'ana' })
  mock.store(on, store)
  const mac = fakeMac({ system, exitAfter })
  const world = { mac, toasts: [] as string[], copied: [] as string[], paneOpens: 0 }
  const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async (_, e) => {
    // top takes seconds on a real Mac; a test that cares says how long.
    if (topMs && e.argv[0] === '/usr/bin/top') await clock.sleep(topMs)
    return reply(mac.run(e.argv, clock.now()))
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    world.paneOpens += 1
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: world.paneOpens ? [{ id: 'devservers', title: 'Dev servers', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.focus', () => ({}))
  on('ui.copy', (_, e) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: HOME, surface: 'terminal', isInteractive: true })
  return { clock, world }
}

const textsOf = async (pane: { findAll: (query: { type: string }) => Promise<{ text: string }[]> }) => (await pane.findAll({ type: 'Text' })).map(found => found.text)

test('/devservers groups every dev server by what started it, and leaves other listeners out', async ($, on) => {
  const { clock } = await start($, on)
  const { text } = await $.command.run(typed())
  expect(text).toBe('5 dev servers hold 10.6 GB. 2 orphans hold 6.2 GB.')

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    await clock.settle()
    const texts = await textsOf(pane)
    expect(texts).toContain('10.6 GB in 5 dev servers')
    expect(texts).toContain('6.2 GB orphaned')
    expect(texts).toContain('Orphaned · what started them is gone')
    expect(texts).toContain('Claude session in blog · open 3 days')
    expect(texts).toContain('Started in Terminal')
    expect(texts).toContain('Next.js 15.0.3')
    expect(texts).toContain('mono/apps/web')
    // The last real line came 40 h before the cache write that set the log's mtime an hour ago.
    expect(texts).toContain('41 h ago')
    expect(texts).toContain('30 min ago')
    expect(texts).toContain('in use now')
    // Astro and Vite keep no log: how long they have been up stands in.
    expect(texts).toContain('up 3 days')
    expect(texts).toContain('up 5 h')
    expect(texts.some(t => t.includes(':5432') || t.includes(':44950'))).toBe(false)
    expect((await pane.find({ key: 'free' }))?.text).toBe('Free 6.2 GB')
    await pane.unmount()
  }
})

test('the pane opens before anything is read, and memory fills in when top answers', async ($, on) => {
  const { clock, world } = await start($, on, { topMs: 2000 })
  const run = $.command.run(typed())
  await clock.settle()
  expect(world.paneOpens).toBe(1)

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(await textsOf(pane)).toContain('5 dev servers · measuring memory')
  expect((await pane.find({ key: 'free' }))?.text).toBe('Free 2 orphans')
  await clock.advance(2000)
  expect((await run).text).toBe('5 dev servers hold 10.6 GB. 2 orphans hold 6.2 GB.')
  expect(await textsOf(pane)).toContain('10.6 GB in 5 dev servers')
  expect((await pane.find({ key: 'free' }))?.text).toBe('Free 6.2 GB')
  await pane.unmount()
})

test('Free asks once, stops every idle orphan together, and counts what comes back as each exits', async ($, on) => {
  const since = NOW - 8 * DAY + 12 * HOUR
  const { clock, world } = await start($, on, {
    exitAfter: pid => (pid >= 110 && pid < 120 ? 1000 : 0),
    store: { freed: { bytes: 200 * GB, since } },
  })
  await $.command.run(typed())
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(await textsOf(pane)).toContain('200.0 GB freed since Oct 10')

  await pane.press({ key: 'free' })
  await clock.settle()
  expect(world.mac.kills).toEqual([])
  expect(await pane.find({ key: 'free-confirm' })).toBeDefined()
  await pane.press({ key: 'free-confirm' })
  await clock.settle()
  expect(world.mac.kills).toEqual([['-TERM', '100', '101', '102', '110', '111', '112']])
  expect(await textsOf(pane)).toContain('Freed 0 GB of 6.2 GB')

  // shop is gone at the first look; studio takes a second.
  await clock.advance(250)
  let texts = await textsOf(pane)
  expect(texts).toContain('Freed 4.2 GB of 6.2 GB')
  expect(texts).toContain('freed')
  expect(texts).toContain('stopping…')

  await clock.advance(750)
  // The drained rows hold a moment, then fold away.
  await clock.advance(1200)
  texts = await textsOf(pane)
  expect(texts).toContain('Stopped 2 servers and freed 6.2 GB.')
  expect(texts).toContain('4.4 GB in 3 dev servers')
  expect(texts).not.toContain('shop')
  expect(texts).toContain('206.2 GB freed since Oct 10')
  expect(world.toasts).toEqual([])
  await pane.unmount()

  // The total is kept on this Mac, for the next session too.
  await $.command.run(typed())
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()
  expect(await textsOf(again)).toContain('206.2 GB freed since Oct 10')
  await again.unmount()
})

test('opening a row says how it started; Stop frees that one and leaves the way back', async ($, on) => {
  const { clock, world } = await start($, on)
  await $.command.run(typed())
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clock.settle()

  await pane.press({ key: `row:${SHOP}` })
  let texts = await textsOf(pane)
  expect(texts).toContain('Started 2 days ago')
  expect(texts).toContain('cd ~/code/shop && pnpm dev')

  await pane.press({ key: `row:${STUDIO}` })
  texts = await textsOf(pane)
  expect(texts).toContain('Started 3 days ago by a Claude session that has since ended')
  expect(texts).toContain('cd ~/code/studio && pnpm dev')
  expect(texts).not.toContain('cd ~/code/shop && pnpm dev')

  await pane.press({ key: `copy:${STUDIO}` })
  expect(world.copied).toEqual(['cd ~/code/studio && pnpm dev'])
  expect((await pane.find({ key: `copy:${STUDIO}` }))?.text).toBe('Copied')
  await clock.advance(2000)
  expect((await pane.find({ key: `copy:${STUDIO}` }))?.text).toBe('Copy start command')

  await pane.press({ key: `open:${STUDIO}` })
  expect(world.mac.opened).toEqual(['http://localhost:4321'])
  await clock.advance(1500)

  expect((await pane.find({ key: `stop:${STUDIO}` }))?.text).toBe('Stop and free 2.1 GB')
  await pane.press({ key: `stop:${STUDIO}` })
  await clock.advance(250 + 1200)
  expect(world.mac.kills).toEqual([['-TERM', '110', '111', '112']])
  texts = await textsOf(pane)
  expect(texts).toContain('Stopped studio (:4321) and freed 2.1 GB.')
  expect(texts).toContain('8.6 GB in 4 dev servers')
  await pane.press({ key: 'copy:last' })
  expect(world.copied).toEqual(['cd ~/code/studio && pnpm dev', 'cd ~/code/studio && pnpm dev'])
  expect((await pane.find({ key: 'copy:last' }))?.text).toBe('Copied')
  await clock.advance(2000)
  await pane.unmount()
})

test('stopping one app of a turbo dev leaves the other running', async ($, on) => {
  const { clock, world } = await start($, on)
  const run = $.command.run(typed('stop 3001'))
  await clock.advance(2000)
  expect((await run).text).toBe('Stopped mono/apps/web (:3001) and freed 2.0 GB. To start it again: cd ~/code/mono/apps/web && pnpm run dev')
  expect(world.mac.kills).toEqual([['-TERM', '305', '306', '307']])
  expect(world.toasts).toEqual([])
})

test('Keep backs out without stopping anything', async ($, on) => {
  const { clock, world } = await start($, on)
  await $.command.run(typed())
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await clock.settle()
  await pane.press({ key: 'free' })
  await clock.settle()
  await pane.press({ key: 'free-keep' })
  expect(await pane.find({ key: 'free-confirm' })).toBeUndefined()
  expect(world.mac.kills).toEqual([])
  await pane.unmount()
})

test('/devservers list prints the same table as text', async ($, on) => {
  const { world } = await start($, on)
  const { text } = await $.command.run(typed('list'))
  expect((text ?? '').split('\n')[0]).toBe('5 dev servers hold 10.6 GB. 2 orphans hold 6.2 GB.')
  expect(text).toMatch(/:5173 +blog +Vite +1\.5 GB +in use now +Claude session in blog/)
  expect(text).toMatch(/:4321 +studio +Astro +2\.1 GB +up 3 days +orphaned/)
  expect(world.paneOpens).toBe(0)
})

test('off macOS it says so and opens nothing', async ($, on) => {
  const { world } = await start($, on, { system: 'Linux' })
  const { text } = await $.command.run(typed())
  expect(text).toContain('runs on macOS for now')
  expect(world.paneOpens).toBe(0)
})

test('the start command is read off the processes that run a server', async () => {
  const next = 'node /Users/ana/code/web/node_modules/.bin/../next/dist/bin/next dev'
  expect(startCommand(['next-server (v16.3.8) ', `${next} -p 3660`, 'node /Users/ana/.local/bin/pnpm dev -p 3660'])).toEqual({ index: 2, command: 'pnpm dev -p 3660' })
  expect(startCommand(['next-server (v16.3.8) ', `${next} --webpack --port 3650`, 'npm exec next dev --webpack --port 3650'])).toEqual({
    index: 2,
    command: 'npx next dev --webpack --port 3650',
  })
  expect(startCommand(['node /Users/ana/code/app/node_modules/vite/bin/vite.js --port 5173'])).toEqual({ index: 0, command: 'npx vite --port 5173' })
  expect(startCommand(['node /Users/ana/code/ui/node_modules/storybook/bin/index.cjs dev -p 6006'])).toEqual({ index: 0, command: 'npx storybook dev -p 6006' })
  expect(startCommand(['node /opt/homebrew/lib/node_modules/pnpm/bin/pnpm.cjs run dev'])).toEqual({ index: 0, command: 'pnpm run dev' })
  // Claude Code's wrapper shell holds the session's exports, never the command to type.
  expect(startCommand([next, "/bin/zsh -c source /Users/ana/.claude/shell-snapshots/s.sh && export A=1 && eval 'cd web && pnpm dev'"])).toEqual({
    index: 0,
    command: 'npx next dev',
  })
})
