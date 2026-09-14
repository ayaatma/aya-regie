---
name: feedback-visual-check-with-headless-chrome
description: "Check the design in a real browser before reporting UI work done: `npm run shots` in app/ drives the installed Chrome headless through every tab, both colour schemes, on the fixture path. Written 2026-09-13 after the Chrome extension failed to connect twice and the régisseur asked for the design to be tested on Claude's side."
metadata:
  type: feedback
---

**Always look at the rendered screens before saying UI work is done**, and do it with
`npm run shots` in `app/` (`app/scripts/shoot.cjs`, `puppeteer-core` against the Chrome already
installed at `C:/Program Files/Google/Chrome/Application/chrome.exe`, `CHROME_PATH` to override).
It starts its own Vite on port 5181 with the Supabase variables emptied, so the app opens on the
fixtures and needs no login, opens the **`balanced+phases` fixture** (montage, démontage,
catering, twenty orgas placed where they said, three bénévoles placed by hand, an act with
balances the day before, a changeover, a car trip, a member who is also the first orga: built by
`withPhases` in `tools/src/plan-fixtures.ts`, written by `npm run fixture -- --all`), clicks
through the tabs, and writes PNGs into `app/shots/` (gitignored), `dark-*` and `light-*`, one
browser context per scheme so the first pass's clicks never leak into the second through
localStorage. Read them with the Read tool. Steps can be named: `npm run shots -- artistes
montage`. Add to `withPhases` whatever state a new screen needs to show something: a fixture
beats a click path through Réglages, which would test Réglages.

**Why:** the régisseur said on 2026-09-13 "il est important que tu puisses tester le design du
mieux possible de ton côté". The Chrome extension was not connected in two sessions running, and
the static-markup tests cannot see a 260 px textarea, a summary column that does not line up, or
a fold that swallowed its content. The first run of the harness found all three, plus a real bug
(two fold toggles in one tick, the second overwriting the first: `setOpen` now reads the previous
state).

**How to apply:** after any change to a screen or to `styles.css`, run the harness, read the shots
that concern the change (both schemes), fix what looks wrong, run again. Extend `shoot.cjs` with a
step when a new screen appears. The harness asserts nothing; it takes pictures. Prefer it to the
extension even when the extension works: it is reproducible, it runs on the fixtures rather than
on the real base, and it costs one command.
