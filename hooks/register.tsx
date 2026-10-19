import type { Register } from 'claude-code'

import { PANE, changeView, prepare, refresh, stopAll, viewOf } from './actions'
import { idleOrphans, restartLine, summary, table } from './format'
import { drawPane } from './pane'
import { isSupported } from './scan'

const UNSUPPORTED = 'devservers reads the macOS versions of ps, lsof and top, so it runs on macOS for now.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devservers',
      description: 'The dev servers on this Mac: who started them, memory, last use, and Stop',
      argumentHint: '[list | stop <port> | stop orphans]',
    })
    return next(e)
  })

  on('command.run', { command: 'devservers' }, async ($, e) => {
    if (!(await isSupported($))) return { text: UNSUPPORTED }
    await prepare($)
    const [verb = '', target = ''] = e.args.trim().split(/\s+/)
    if (verb === 'list') return { text: table(await refresh($), await $.clock.now()) }
    if (verb === 'stop') {
      const servers = await refresh($)
      const wanted = Number(target)
      const targets = target === 'orphans' ? idleOrphans(servers) : servers.filter(s => s.ports.includes(wanted) || s.pid === wanted)
      if (!targets.length) return { text: target === 'orphans' ? 'No idle orphans to stop.' : `No dev server on ${target || '(no port given)'}.` }
      const { text, restart } = await stopAll($, targets, 'command')
      return { text: restart ? `${text} To start it again: ${restartLine(restart, (await viewOf($)).home)}` : text }
    }
    // The pane opens before anything is read: its rows land a moment later, and memory after them.
    await changeView($, v => ({ ...v, confirm: null, note: null, openId: null, freedHere: 0 }))
    await $.ui.open({ id: PANE, title: 'Dev servers', focus: true, closeOnEscape: true })
    return { text: summary(await refresh($)) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Clearing what was half done is housekeeping: the pane closes whatever happens to it.
    await changeView($, v => ({ ...v, confirm: null, note: null, openId: null })).catch(() => undefined)
    return next(e)
  })
}
