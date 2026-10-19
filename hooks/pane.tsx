import type { EngineInterface, RenderInput } from 'claude-code'

import type { DevServer } from '../types'
import { PANE, changeView, copyStart, openInBrowser, refresh, stopAll, viewOf } from './actions'
import { count, groupsOf, idleOrphans, isIdleOrphan, lifetimeLine, ownerTitle, port, restartLine, size, startedLine, total, usage } from './format'

const PORT = 6
const SIZE = 7
// The pane is often a sidebar beside the conversation, 45 to 60 columns: that is the layout drawn
// first. With room, the columns breathe, the bars lengthen and the framework gets a column.
const ROOMY = 70
const FRAMEWORK_FROM = 76
const FRAMEWORK = 15
// The desktop and the phone draw bars as pictures, in colors that read on light and dark alike.
const SVG_INK = 'rgba(128,128,128,0.9)'
const SVG_YELLOW = '#E3A008'
const SVG_TRACK = 'rgba(128,128,128,0.22)'

type Part = { bytes: number; tone: 'ink' | 'yellow' | 'track' }
type Layout = { gap: number; bar: number; used: number; framework: number }

// Narrow, the last-used column keeps a second space before it so `4.2 GB  41 h ago` never runs together.
const layoutFor = (columns: number): Layout =>
  columns >= ROOMY ? { gap: 2, bar: 10, used: 12, framework: columns >= FRAMEWORK_FROM ? FRAMEWORK : 0 } : { gap: 1, bar: 5, used: 10, framework: 0 }

function svgBar(parts: readonly Part[], height: number) {
  const scale = parts.reduce((sum, p) => sum + p.bytes, 0) || 1
  let x = 0
  const shapes = parts.map(p => {
    const width = (p.bytes / scale) * 1000
    const shape = p.tone === 'track' ? '' : `<rect x="${x.toFixed(1)}" width="${width.toFixed(1)}" height="${height}" fill="${p.tone === 'yellow' ? SVG_YELLOW : SVG_INK}"/>`
    x += width
    return shape
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" viewBox="0 0 1000 ${height}" preserveAspectRatio="none"><rect width="1000" height="${height}" fill="${SVG_TRACK}"/>${shapes.join('')}</svg>`
}

/**
 * One bar of `parts` across `width` cells: heavy line where memory is held (yellow where it is
 * orphaned), light dim line where it is not, or was and has been freed.
 */
function meter($: EngineInterface, e: RenderInput<'Pane'>, parts: readonly Part[], width: number, alt: string) {
  if (e.surface !== 'terminal') {
    const { Svg } = $.ui.resolve(e)
    return <Svg source={svgBar(parts, 8)} alt={alt} height={8} />
  }
  const { Text } = $.ui.resolve(e)
  const scale = parts.reduce((sum, p) => sum + p.bytes, 0)
  let drawn = 0
  let held = 0
  const runs = parts.map(p => {
    held += p.bytes
    const end = scale ? Math.round((held / scale) * width) : 0
    const cells = end - drawn
    drawn = end
    return { cells, tone: p.tone }
  })
  return (
    <Text wrap="truncate">
      {runs.map(run =>
        run.cells > 0 ? (
          <Text color={run.tone === 'yellow' ? 'warning' : undefined} dimColor={run.tone === 'track'}>
            {(run.tone === 'track' ? '─' : '━').repeat(run.cells)}
          </Text>
        ) : null,
      )}
      {drawn < width ? <Text dimColor>{'─'.repeat(width - drawn)}</Text> : null}
    </Text>
  )
}

/** A row's bar: its share of the largest server's memory, to the half cell. */
function rowMeter($: EngineInterface, e: RenderInput<'Pane'>, s: DevServer, largest: number, width: number, tone: 'ink' | 'yellow' | 'gone') {
  const bytes = tone === 'gone' ? 0 : (s.memoryBytes ?? 0)
  if (e.surface !== 'terminal') {
    const { Svg } = $.ui.resolve(e)
    const parts: Part[] = [{ bytes, tone: tone === 'yellow' ? 'yellow' : 'ink' }, { bytes: largest - bytes, tone: 'track' }]
    return <Svg source={svgBar(parts, 6)} alt={s.memoryBytes === null ? 'memory not measured yet' : size(s.memoryBytes)} height={6} />
  }
  const { Text } = $.ui.resolve(e)
  const halves = Math.round(Math.min(1, bytes / largest) * width * 2)
  const fill = '━'.repeat(Math.floor(halves / 2)) + (halves % 2 ? '╸' : '')
  return (
    <Text wrap="truncate">
      <Text color={tone === 'yellow' ? 'warning' : undefined}>{fill}</Text>
      <Text dimColor>{'─'.repeat(width - fill.length)}</Text>
    </Text>
  )
}

export async function drawPane($: EngineInterface, e: RenderInput<'Pane'>) {
  const v = await viewOf($)
  const now = await $.clock.now()
  const { Box, Text, Button } = $.ui.resolve(e)
  const width = Math.max(40, e.props.bodyColumns)
  const L = layoutFor(width)

  if (!v.servers) return <Text dimColor>{v.isScanning ? 'Looking for dev servers…' : 'Run /devservers to look.'}</Text>

  const servers = v.servers
  const f = v.freeing
  const exited = new Set(f?.exited ?? [])
  const pending = f ? f.ids.filter(id => !exited.has(id) && !f.refused.includes(id)) : []
  const live = servers.filter(s => !exited.has(s.id))
  const orphans = idleOrphans(live).filter(s => !pending.includes(s.id))
  const isMeasured = servers.every(s => s.memoryBytes !== null)
  const largest = Math.max(1, ...servers.map(s => s.memoryBytes ?? 0))
  const orphanBytes = total(idleOrphans(live))
  // Orphans first, so freeing them slides the rest left and leaves empty track where they were.
  const parts: Part[] = isMeasured
    ? [
        { bytes: orphanBytes, tone: 'yellow' },
        { bytes: total(live.filter(s => !isIdleOrphan(s))), tone: 'ink' },
        { bytes: (f?.freedBytes ?? 0) + v.freedHere, tone: 'track' },
      ]
    : [{ bytes: 1, tone: 'track' }]

  const title = f && pending.length
    ? `Freed ${size(f.freedBytes)} of ${size(f.targetBytes)}`
    : !servers.length
      ? 'No dev servers are running'
      : isMeasured
        ? `${size(total(live))} in ${count(live.length, 'dev server', 'dev servers')}`
        : `${count(live.length, 'dev server', 'dev servers')} · measuring memory`

  const askToFree = async () => {
    await changeView($, x => ({ ...x, confirm: 'orphans' as const, note: null, openId: null }))
    // Enter then confirms. A surface that moves no ring (the test kit) leaves it where it was.
    await $.ui.focus({ requestId: PANE, key: 'free-confirm' }).catch(() => undefined)
  }
  const startOver = async () => {
    await changeView($, x => ({ ...x, note: null, freedHere: 0 }))
    await refresh($)
  }
  // The confirm buttons go as the stop starts: the ring moves to Refresh rather than onto a row being stopped.
  const freeAll = () => {
    void stopAll($, orphans, 'pane')
    void $.ui.focus({ requestId: PANE, key: 'refresh' }).catch(() => undefined)
  }
  const toggle = (s: DevServer) => changeView($, x => ({ ...x, openId: x.openId === s.id ? null : s.id, note: null, confirm: null }))

  const refreshButton = (
    <Button key="refresh" hotkey="r" dimColor onPress={() => void startOver()}>
      {v.isScanning || v.isMeasuring ? 'Looking…' : 'Refresh'}
    </Button>
  )
  // Under the bar: what the yellow is and the one action, or the question that action asks.
  const [said, actions] = pending.length
    ? [<Text dimColor>{`Stopping ${count(pending.length, 'server', 'servers')}…`}</Text>, refreshButton]
    : v.confirm === 'orphans' && orphans.length
      ? [
          <Text>{`Stop ${count(orphans.length, 'idle orphan', 'idle orphans')}?`}</Text>,
          <Box flexDirection="row" columnGap={1}>
            <Button key="free-confirm" variant="primary" onPress={freeAll}>
              Stop them
            </Button>
            <Button key="free-keep" onPress={() => void changeView($, x => ({ ...x, confirm: null }))}>
              Keep
            </Button>
          </Box>,
        ]
      : [
          orphans.length ? (
            isMeasured ? (
              <Text>
                <Text color="warning">━ </Text>
                <Text dimColor>{`${size(orphanBytes)} orphaned`}</Text>
              </Text>
            ) : null
          ) : servers.length ? (
            <Text dimColor>No orphans</Text>
          ) : null,
          <Box flexDirection="row" columnGap={1}>
            {orphans.length ? (
              <Button key="free" variant="primary" hotkey="o" autoFocus onPress={() => void askToFree()}>
                {isMeasured ? `Free ${size(total(orphans))}` : `Free ${count(orphans.length, 'orphan', 'orphans')}`}
              </Button>
            ) : null}
            {refreshButton}
          </Box>,
        ]

  const header = (
    <Box key="header" flexDirection="column">
      <Text weight="semibold" size="title" wrap="truncate-end">
        {title}
      </Text>
      {servers.length ? meter($, e, parts, width, title) : null}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} flexWrap="wrap">
        <Box flexShrink={1}>{said ?? <Text> </Text>}</Box>
        {actions}
      </Box>
    </Box>
  )

  const restart = v.note?.restart
  const note = v.note ? (
    <Box key="note" flexDirection="row" columnGap={2} flexWrap="wrap">
      <Text>{v.note.text}</Text>
      {restart ? (
        <Button key="copy:last" dimColor onPress={press => void copyStart($, restart, press.surface)}>
          {v.copiedId === restart.id ? 'Copied' : 'Copy start command'}
        </Button>
      ) : null}
    </Box>
  ) : null

  const detail = (s: DevServer, isStopping: boolean) => (
    <Box key={`detail:${s.id}`} flexDirection="column" paddingLeft={PORT + L.gap} paddingBottom={1}>
      <Text dimColor>{startedLine(s, now)}</Text>
      <Text dimColor wrap="truncate-middle">
        {restartLine(s, v.home)}
      </Text>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {isStopping ? (
          <Text dimColor>Stopping…</Text>
        ) : (
          <Button key={`stop:${s.id}`} onPress={() => void stopAll($, [s], 'pane')}>
            {s.memoryBytes ? `Stop and free ${size(s.memoryBytes)}` : 'Stop'}
          </Button>
        )}
        {s.ports[0] ? (
          <Button key={`open:${s.id}`} dimColor onPress={() => void openInBrowser($, s)}>
            Open in browser
          </Button>
        ) : null}
        <Button key={`copy:${s.id}`} dimColor onPress={press => void copyStart($, s, press.surface)}>
          {v.copiedId === s.id ? 'Copied' : 'Copy start command'}
        </Button>
      </Box>
    </Box>
  )

  const row = (s: DevServer) => {
    const isGone = exited.has(s.id)
    const isStopping = pending.includes(s.id)
    const used = usage(s, now)
    return (
      <Box key={`line:${s.id}`} flexDirection="column">
        <Box flexDirection="row" columnGap={L.gap}>
          <Box width={PORT} flexShrink={0}>
            <Text dimColor={isGone}>{port(s)}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={6}>
            <Button key={`row:${s.id}`} plain dimColor={isGone} onPress={() => void toggle(s)}>
              <Text wrap="truncate-end">{s.folder}</Text>
            </Button>
          </Box>
          {L.framework ? (
            <Box width={L.framework} flexShrink={0}>
              <Text dimColor hover={{ dimColor: false }} wrap="truncate-end">
                {s.framework}
              </Text>
            </Box>
          ) : null}
          <Box width={L.bar} flexShrink={0}>
            {rowMeter($, e, s, largest, L.bar, isGone ? 'gone' : isIdleOrphan(s) ? 'yellow' : 'ink')}
          </Box>
          <Box width={SIZE} flexShrink={0} justifyContent="flex-end">
            <Text dimColor={isGone || s.memoryBytes === null}>{s.memoryBytes === null ? '…' : size(s.memoryBytes)}</Text>
          </Box>
          <Box width={L.used} flexShrink={0} marginLeft={2 - L.gap}>
            <Text
              weight={used.tone === 'strong' && !isGone ? 'semibold' : undefined}
              dimColor={isStopping || (used.tone === 'quiet' && !isGone)}
              hover={{ dimColor: false }}
              wrap="truncate-end"
            >
              {isGone ? 'freed' : isStopping ? 'stopping…' : used.text}
            </Text>
          </Box>
        </Box>
        {v.openId === s.id && !isGone ? detail(s, isStopping) : null}
      </Box>
    )
  }

  const groups = groupsOf(servers).map(([key, group]) => (
    <Box key={`group:${key}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Box flexShrink={1}>
          <Text weight="semibold" wrap="truncate-end">
            {group[0] ? ownerTitle(group[0].owner, now) : ''}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>{isMeasured ? size(total(group.filter(s => !exited.has(s.id)))) : ''}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={2}>
        {group.map(row)}
      </Box>
    </Box>
  ))

  const footer = (
    <Box key="footer" flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
      {e.surface === 'terminal' ? <Text dimColor>tab next · enter open · o free · r refresh</Text> : null}
      {v.lifetime ? <Text dimColor>{lifetimeLine(v.lifetime, now)}</Text> : null}
    </Box>
  )

  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      {note}
      {groups}
      {footer}
    </Box>
  )
}
