# DivyaDrishti design system: "Porcelain and cobalt"

The source of truth is `web/css/app.css` (tokens and components), `web/css/portal.css` (the optometrist portal) and `web/css/about.css` (the story page). This file records the decisions behind them, so later changes stay in one system.

## Direction and feel

- **Who:** a store owner or eye-camp volunteer, phone in hand, patient across the counter, in a bright shop or under a camp tent; and an optometrist at a desk reviewing cases against a deadline.
- **Feel:** an established optics house, not an AI startup. Calm, precise, clinical but warm.
- **Light first:** the field app is used in daylight. Dark mode follows the OS and keeps the same hierarchy.
- **Mode:** the app and portal are *Operate* surfaces: standard controls and layout, and the world shows only through type, palette, density and the signature elements. `about.html` is *Persuade*: the world may carry the page.

## Signature elements (only this product has them)

| Element | Where | Spec |
|---|---|---|
| **Landolt C mark** | header, favicon, welcome, story page | `<path d="M26.2 13.2A10.6 10.6 0 1 0 26.2 18.8" stroke-width="3.2" fill="none"/>` + `<circle cx="16" cy="16" r="3.1"/>` in a 32 grid, `currentColor` (cobalt on light, sky on night) |
| **Placido rings** | night bands (`.band::before`), story page (`.placido`) | `--rings` token: concentric circles at r = 48·k on an 800 grid, white at 0.11 opacity, ring r = 192 at 0.24. Dark-stroke variant on light grounds at 0.075 / 0.16 |
| **Signal** | one dot riding a ring (`.band::after`, `.placido .signal`) | 36–48 s linear `orbit`; removed under reduced motion |
| **Iris** | the voice state pill `#vstate` (`.pill.speaking`, `.listening`, `.hearing`, `.demo`) | 16 px ring with a pupil dot. Speaking = aperture ripple 1.2 s; listening = pupil dilates 1.8 s; hearing = 0.9 s on solid green |

## Palette

Tokens are on `:root` in `app.css`, with dark values under `prefers-color-scheme`. Never hard-code hex in components.

| Role | Light | Dark |
|---|---|---|
| `--paper` ground | `#f5f4f0` | `#0a101c` |
| `--paper-2` recessed (seg tracks, bars) | `#edebe5` | `#0e1524` |
| `--surface` cards | `#ffffff` | `#121a2a` |
| `--ink` / `--ink-2` / `--muted` / `--faint` | `#0e1629` / `#3c4558` / `#626a7d` / `#8a91a1` | `#eceff5` / `#c3c9d5` / `#9098aa` / `#6f788b` |
| `--primary` (button fill) | `#2e4fc4`, hover `#2541a8` | `#4262da` |
| `--accent` (links, focus, selection, marks) | `#2e4fc4`, soft `#eceffb`, line `#c8d2f3` | `#93a8f5` |
| `--night` bands, tab bar | `#0b1433`, gradient to `#15245a` / `#070d24` | same |
| `--sky` (accent on night) | `#a9bbf2` | same |
| Lines | `rgba(17,24,43,.085 / .15 / .26)` | `rgba(255,255,255,.075 / .14 / .24)` |

**Urgency colours are reserved for triage** and always travel with a word (tier chip or lane text). They are never used for decoration.

| Tier | Text | Soft fill | Line | Solid |
|---|---|---|---|---|
| Emergency (red) | `#b3261e` | `#fcefed` | `#f1c9c4` | `#b3261e`, white text, triangle marker |
| Urgent (orange) | `#a2380f` | `#fdf0e8` | `#f5cdb6` | `#e2582c` |
| Soon (amber) | `#8a5300` | `#fcf4e2` | `#edd59f` | `#d8ac22` |
| Routine (green) | `#1b6e45` | `#ebf5ef` | `#c0e0cc` | `#23885a` |

**Charts** were checked with the dataviz validator; all of these pass colour-blind separation on white.
- Urgency ramp: emergency `--lane-red #a3222e`, urgent `--c4 #e2582c`, soon `--lane-amber #d8ac22`, routine `--c2 #5c7fd6`. The same steps are used in dark mode, where the separation also holds.
- Vision-profile set, in order: `--c5` cobalt, `--c6` rose `#c9487f`, `--c3` sky `#5aa9e6`, `--c7` green `#1e8a50`. Dark: `#5a78e0`, `#c65c8e`, `#2f9bd0`, `#2e9a5e`.
- Ranked bars (`hbars`) use one hue, `--c1`, because colour must not encode rank.
- Stacked segments are separated by a 2 px surface stroke.

## Typography

- **Display:** Newsreader, variable with optical sizes. Use it for `h1`, the greeting, page titles, the lens recommendation, the patient name on the summary, and big numbers (`.stat b`, `.tile .n`, `.numbers b`) set with `lining-nums tabular-nums`. Weight 380–450, tracking −0.02 to −0.032 em, line-height 1.0–1.1.
- **UI:** Instrument Sans, variable 400–700, for everything else. Body 16 px on phones and 15.5 px from 900 px up; portal 15 px.
- **Measurements only:** Geist Mono, for cm, D, mm, logMAR, case codes, deadlines and question counters. Never use it as a "technical" costume.
- **Scale:** h2 1.12 rem / 600 / −0.012 em. h3 0.8 rem / 600 in the muted colour; it labels a group and is not a kicker. The question on the interview card is `clamp(1.5rem, 1.25rem + 1.1vw, 2.05rem)` / 600.
- **Indic scripts** (`:lang(hi|mr|ta|te|kn|bn)`) get letter-spacing 0 and line-height 1.42 and fall back to the system Noto or Nirmala faces.
- All fonts are self-hosted in `web/fonts` under SIL OFL, with their licences alongside. The CSP (`default-src 'self'`) forbids remote fonts.

## Depth, shape, spacing

- **Depth:** layered shadows in light mode and a 1 px ring only in dark mode. Use inset rings (`box-shadow: inset 0 0 0 1px`) instead of borders on controls and panels.
  - `--lift: 0 0 0 1px rgba(14,22,41,.055), 0 1px 2px rgba(14,22,41,.05), 0 10px 28px -16px rgba(14,22,41,.16)`
  - `--lift-sm` for raised segments; `--lift-pop` for banners and popovers.
- **Radius scale:**

  | Element | Radius |
  |---|---|
  | Pills | 999 |
  | Controls | 12 (`--r-sm`) |
  | Cards | 20 (`--radius`) |
  | Bands | 28 (`--r-lg`); 24 below 420 px |
  | Nested elements | outer = inner + padding |

- **Spacing:** 4 px base.
  - Card padding: 22 px (18 px below 420 px).
  - Band padding: 26/22 px on phones, 32–44 px on desktop.
  - Card gap: 14 px.
  - Hit targets are at least 44 px; buttons are 48 px.

## Motion

- **Easing:** `--ease: cubic-bezier(.22,1,.36,1)` and `--ease-out: cubic-bezier(.16,1,.3,1)`. UI transitions run 140–220 ms; press is `scale(.975)`.
- **Authored moments:**
  - `focus-in` (blur 12 px to 0) runs once, on the welcome headline and the story-page hero.
  - The primary-button sheen sweeps once on hover.
  - The orbit signal rides its ring.
- **The story page has two moments:** the hero stage straightens from a `--tilt` of 1 to 0 as it rises into view, and the how-it-works visual follows the step being read. Numbers count up once. Nothing fades in on scroll.
- **Screens that re-render often** (home, lists) get no entrance animation.
- **Reduced motion:** a global rule stops all animation and removes the signals and the tilt.

## Component patterns

| Component | Spec |
|---|---|
| `.btn` | 48 px tall, 12 px radius, 0.95 rem / 550, inset ring. `.primary` is cobalt with a sheen. `.ghost` is transparent. `.big` is 58 px, full width, 15 px radius. `.small` is 38 px. |
| `.chip` | 36 px pill with an inset ring. `.on` uses the accent-soft fill and the accent colour. |
| `.seg` | a recessed track (`--paper-2`, 4 px padding, 15 px radius). The chosen item is raised: surface fill, `--lift-sm`, 11 px radius. |
| `.card` | surface fill, 20 px radius, 22 px padding, `--lift`. Cards are never nested more than two deep. |
| `.band` | the night gradient with the rings. Inside it, `.btn.primary` turns white, but `.band .card .btn.primary` stays cobalt. |
| `.home-hero` | the greeting and the start console in one band: two columns at 900 px and up, one column on phones. |
| `.lane` | the triage strip: soft fill, ring, a 12 px dot with a double halo, 1.04 rem / 600. |
| `.tier` | 0.7 rem / 650 pill. Emergency is solid with a triangle; the other tiers are soft with a ring. |
| `.flag` | a tinted card with a full ring. Never a bar down one side. |
| `.pill` (iris) | see Signature elements. |
| `.tabbar` | phones: a floating night bar, 24 px radius, 52 px buttons, the active icon in a sky capsule. 900 px and up: a segmented pill in the header. |
| PIN | the real `#pin1` / `#pin2` inputs plus `.pindots` (six 10 px dots that fill as digits are typed); `.pin.shake` on a wrong PIN. |
| `.meta` / `.eyebrow` | metadata such as place, date and case code, set *after* the heading. Never a kicker above it. |

## Rules (bans)

- No eyebrow or kicker labels above headings.
- No coloured bar down one side of a rounded box.
- No gradient text.
- No decorative glass. Backdrop blur is only for bars that content scrolls under.
- No colour used to encode rank.
- No urgency colour without its word.
- No mono font for non-measurements.
- No invented facts, quotes or figures on the story page. Copy comes from the README, the docs and the language packs.
- Theme the browser surfaces: `::selection`, `caret-color`, scrollbars and focus rings (2 px accent with a 2 px offset).

## Layout

- `main` is 600 px wide on phones; at 900 px and up it is 1180 px (1320 px at 1400 px). Focused screens (`pin-*`, `register`, `check-*`, `calibration`, `phonecheck`, `pair`, `setup-gate`) are capped at 760 px, and PIN screens at 480 px.
- **Breakpoints:** 420, 520, 640 (four stats per row), 900 (multi-column layouts), 1100 (portal case view stacks), 1400.
- **Interview:** a 2 : 1 grid from 900 px with a sticky side card. The test hub uses CSS columns (2, then 3 from 1400 px).

## Constraints that protect behaviour

- **CSP:** no inline scripts; page scripts are external modules. Inline `style` attributes and `data:` SVG backgrounds are allowed.
- **The e2e test** (`tests/e2e/smoke.py`) depends on these: every element `id`, `main[data-screen]`, `.homegrid`, `.stats` ("Screened today"), `.overview`, `.nextgrid .bcard`, `.crow`, `.dhead`, `#planningTab .tiles`, `.kv`, `.findings`, `.inbox [data-share]`, `.inbox .comment`, `.edited`, `.sales`, `.screencard.on`, `.pcheck`, `[data-demo]`, `[data-chk]` and `[data-tab]`. Keep them when restyling.
- **Selector collision:** the bare class `.rec` is shared by `.check.rec` and `.badge.rec`. The recommendation panel is styled as `div.rec`.
- **Offline cache:** `web/sw.js` lists the offline shell. Bump `CACHE` and add new files whenever assets change.

## References that shaped the direction

- **ZEISS Vision Care / Online Vision Screening:** slate ink, a calm pace, the Landolt C.
- **Warby Parker:** cobalt on warm neutrals, an editorial serif.
- **Peek Vision:** the product shown in use, not rendered.
- **One Medical:** warm paper, restraint.
- **Interaction patterns from 21st.dev**, rebuilt in plain CSS and JavaScript:
  - the OTP input with a shake on error
  - the segmented control
  - the number ticker
  - the blur-in headline
  - the shine button
  - orbit rings
  - the bento grid
- **Skipped as gimmicky:** spotlight cards, aurora backgrounds, magnetic buttons and border beams.
