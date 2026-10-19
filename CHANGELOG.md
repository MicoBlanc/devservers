# Changelog

## 0.2.0

- The pane opens at once: rows land in a fraction of a second, and memory fills in when macOS has measured it, instead of a blank wait of about three seconds.
- One bar across the top shows all the memory dev servers hold, the orphaned part in yellow, with one action: **Free**, which stops the orphans nobody has open after one more press.
- Rows are quiet: Enter on one shows when and how it started, with **Stop and free**, **Open in browser** and **Copy start command** (`cd ~/code/shop && pnpm dev`, read off the processes that started it).
- Stops are sent to every server at once and followed: each bar drains as its processes exit, the header counts what came back, and the stopped rows fold away.
- An orphan that Claude Code started says so, when the shell it ran in outlived the session.
- The total freed on this Mac is kept between sessions and shown at the bottom.
- Laid out for the sidebar the pane docks into (45 to 60 columns), with more room used when there is.
- Where a framework keeps no log, a row says how long the server has been up instead of "unknown".
- `/devservers stop <port>` says how to start the server again.
- `demo/`: a second mod that answers devservers with a made-up Mac, for recordings and for trying the pane.

## 0.1.0

- `/devservers` pane: every dev server on the Mac, grouped by what started it (an open Claude session, a terminal, an app, or nothing: orphaned), with memory, last use and a Stop button that asks once.
- `/devservers list`, `/devservers stop <port>`, `/devservers stop orphans`.
- Recognises Next.js, Vite, Astro, Nuxt, Storybook, Angular, webpack, Expo, Gatsby, Docusaurus and Remix, plus any `dev`, `start` or `serve` package script.
- Last use from the Next.js 16 dev log; "in use now" while a client is connected.
- Stopping one app of a monorepo's `turbo dev` leaves the others running.
- macOS only.
