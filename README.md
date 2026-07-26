# LightWatch — SPA conversion

This is the multi-page app converted into a single-page app, per the
requested structure: one `index.html`, `css/` and `js/` reorganized
into `base/components/layouts/themes/views` and
`views/services/utils/components`, real `pushState`/`popstate`
routing, and no `<a href="page.html">` or
`window.location = "page.html"` navigation anywhere — every
transition is `window.LWRouter.navigate('viewName')`.

## Before this will run

1. **Copy your `images/` and `icons/` folders** into this project's
   root (next to `index.html`). Only code files were given to me for
   this conversion, so `images/.gitkeep` and `icons/.gitkeep` are
   placeholders — swap them for your real assets. All paths were
   already rewritten from `../images/...` / `../icons/...` to
   `./images/...` / `./icons/...` to match `index.html` now living at
   the project root instead of under `/pages/`.
2. **Server/hosting fallback for deep links.** Real `pushState` paths
  (`/home`, `/location`, `/reports`, `/account`, `/login`, `/signup`,
  `/verification`) need whatever serves this app to respond to those
  paths with `index.html` too — the standard requirement for any
  pushState SPA (e.g. a static host's "rewrite all routes to
  index.html" option). Opening `index.html` directly still works for
  the default view; a fresh deep link to e.g. `/location` won't resolve
   without that fallback. Capacitor's own local-file serving already
   behaves this way, so this mainly matters if you also serve it over
   plain HTTP somewhere.
3. **`manifest.json`** is referenced at `/manifest.json` (root-scoped,
   unchanged) — make sure it's still deployed at the root the way it
   was before.

## What changed structurally

- **One document.** Every page (`index.html`/login, `signup.html`,
  `verification.html`, `home.html`, `location.html`, `reports.html`,
  `account.html`) is now a `<section id="view-...">` inside either
  `#authShell` (login/signup/verification — no topbar/sidebar/bottom
  nav) or `#appShell` (home/location/reports/account — shares one
  topbar/sidebar/bottom-nav instance instead of duplicating that
  markup four times).
- **`js/app.js`** is the router: it decides which shell + view to
  show, gates protected views behind a session check, drives
  `history.pushState`/`popstate`, and calls each view module's
  `mount()` once (first visit) and `show()`/`hide()` on every visit
  after that, so polling intervals pause while a view isn't on screen
  instead of running forever in the background.
- **Every other view file** (`views/*.js`) is wrapped (IIFE, or an
  explicit `mount()`) purely to avoid two files colliding in the same
  global scope now that they all coexist in one document — internal
  logic is otherwise unchanged. Each file's header comment says
  exactly what changed and why.
- **`services/`, `utils/`** are mostly new, thin, shared helpers
  (`LWCache`, `LWHelpers`, `LWApi`, `LWStorage`, validators,
  constants) consolidating patterns that used to be copy-pasted
  slightly differently across files. `location.js`/`reports.js` were
  rewired onto them as the reference example; most other files kept
  their original inline versions of the same pattern rather than risk
  a blind rewrite of behavior-critical code.

## Bugs found and fixed along the way

- Three different "Log out" buttons (Home's compact profile card,
  Areas'/Home's sidebar) were wrapped in `<a href="../index.html">`
  instead of calling `signOut()` — meaning clicking them left the
  session in `localStorage`/`sessionStorage` completely intact. All
  sign-out buttons now uniformly use `data-action="signout"` (the
  pattern `account.html`'s copy already had correctly).
  `reports.html`'s copy had neither the link nor the handler and was
  simply dead.
- `analytics.js` and `app-startup.js` were two near-duplicate copies
  of the same service-worker/back-button bootstrap, both loaded on
  every page (one mislabeled — its own header comment said
  "APP-STARTUP.JS"). Consolidated into one file
  (`components/analytics.js`), based on the more complete version.

## Known follow-ups (flagged, not silently glossed over)

- **`service-worker.js`** wasn't part of the files I was given. Its
  push-notification `notificationclick` handler almost certainly does
  `clients.openWindow('/pages/home.html?...')` for the case where the
  app was fully closed — that page no longer exists. It needs to open
  `/home?...` instead (the router reads that on cold boot). The
  in-app (foreground/backgrounded) click path was already updated in
  `services/push.js` — see the comment at the top of that file.
- **Chat's deep-link params** (`chatId`/`chatScope`/`chatLocation`,
  used to jump straight to a message from a push notification) are
  only read once, at cold boot. If the app is already running and a
  notification is tapped, the router navigates correctly but
  `views/chat.js` won't re-read the new query string — flagged in
  that file's header comment.
- **`views/profile.js`** (topbar/sidebar/light-status hero card) is
  shared chrome, not a per-view module — it's initialized once, the
  first time any authenticated view mounts, and its two polling
  intervals (10s / 15s) keep running for as long as the app shell is
  up rather than pausing when e.g. Reports is on screen instead of
  Home. Flagged in the file as an easy follow-up
  (`document.visibilityState` gating) rather than something this pass
  attempted blind.
- **`views/dashboard.js`** was preserved (per "don't remove
  functionality") but — as in the original app — isn't wired into
  `index.html` at all, because it was never `<script>`-included by
  any of the pages I was given either. It also reads a stale
  `localStorage` key and targets an element ID that doesn't exist
  anywhere current. Flag it if this was actually meant to be live
  somewhere and I'll wire it in properly.
- **CSS**: `home.css` (4826 lines in the original) turned out to be a
  de facto shared stylesheet — `reports.html` loaded it too, for
  instance — not a home-only file despite its name. I split out the
  two cleanly-delimited sections (chat, light-status) into their own
  view CSS files and extracted the truly generic pieces (toast,
  modals, loader, theme tokens) into `components/`/`themes/`, but left
  the deeply interleaved remainder in `views/home.css` rather than do
  a blind manual re-split that could silently drop a rule or a
  media-query pairing. Everything still loads globally in the SPA
  regardless of which file it's physically in, so nothing is broken —
  it's a organization/maintainability item, not a functional one.
- **Please click through the whole app once** before shipping this —
  especially sign-in → sign-up → verification → home → location →
  reports → account → sign-out, and the chat widget, given how much
  of this pass was mechanical restructuring across ~19,000 lines. I
  ran a Python HTML-parse check and `node --check` on every JS file
  (both clean), but that only catches syntax errors, not behavioral
  ones.
