# FabTwin design direction

Design Read: an operations console for a fab shift lead (and for a technical reviewer judging the engineering behind it), in a dim-control-room instrument style. Dial ENERGY 2 / RHYTHM 2 / MOTION 1.

This file is the direction. The antislop filter (core plus the UI skill, including its App and Dashboard section) is applied on top of it. Every decision below has its one-line reason.

## What the screen is for

The shift lead makes one decision over and over: which thing needs me right now, and what do I change. So the layout is built around that, not around a sidebar plus stat cards plus chart plus table.

- Centre: the fab itself (3D, or a 2D map on phones). It is where state is read at a glance.
- Left: the attention queue. Active alarms, lots about to break a queue-time limit, and the five bays with their dispatch rule. Reason: these are the only things that can force a decision, so they sit next to the world they refer to.
- Right: context for whatever is selected (tool or lot) with the actions that apply to it. Reason: actions live next to the evidence for them.
- Bottom: the instruments (equipment table, lot search and genealogy, WIP by step, utilization Gantt, SPC, alarm log). Reason: these are for diagnosis, used after the attention queue points somewhere.
- Top: shift clock, time controls, the three objectives, live score. Reason: the shift is a race against a clock and a target.

## Theme

Dark only, no toggle, and no light theme is planned. Two reasons.

1. **The control room.** MES consoles are watched in dim rooms for a whole shift, and a bright page there is glare, not clarity.
2. **The 3D lighting.** The status lamps and floor pads in the scene are lights and glows, and they read as lights only against a dark ground. The scene has one key light, a dim hemisphere fill and a shadow map rendered once. A light theme would mean a second lighting set-up, a second set of colours for the five status states that still pass contrast on white, and a second round of checking, for no benefit to the shift lead.

The cost is that people who need a light page (bright rooms, some visual conditions) have no option inside the app. Their browser's forced-colours and zoom still work, text meets contrast on the dark panels (the ratios are in the palette table), and the keyboard focus ring is visible. That is listed under Known limitations in the README.

## Palette

| Token | Value | Use and reason |
|---|---|---|
| `--bg` | `#0d1115` | Page. Cool graphite, not black, so the 3D horizon does not glow against it. |
| `--panel` | `#141a20` | Panels. One step up from the page, separated by lines, not shadows. |
| `--raised` | `#1b232b` | Inputs, selected rows, popovers. |
| `--line` | `#2a3540` | 1px dividers. |
| `--ink` | `#e7edf2` | Body text. 14.9:1 on panel. |
| `--muted` | `#9bacb9` | Secondary text. 7.5:1 on panel. |
| `--steel` | `#7fa6c4` | Second core color: links, axis lines, chart neutrals. Steel is the colour of the metal the fab is made of. 6.8:1 on panel. |
| `--accent` | `#ff5c93` | The one accent: hot lots, the selected object, the primary action. Rose, because it has to stand apart from all five status colours and from the steel neutrals, and hot lots need one colour that nothing else uses. Text on it is `#1a0a12`, 6.6:1. Accent on panel is 6.0:1. |

E10 status colours are a separate data-encoding system, not decoration. Each is always paired with a text label and a distinct glyph shape, so colour is never the only channel.

| State | Colour | Glyph |
|---|---|---|
| Productive | `#3ecf8e` green | filled circle |
| Standby | `#5aa9e6` blue | ring |
| Engineering | `#a78bfa` violet | diamond |
| Scheduled down | `#f0b429` amber | square |
| Unscheduled down | `#f0524f` red | triangle |

## Type

IBM Plex Sans for the interface and IBM Plex Mono for lot ids, tool ids, clock readouts and chart numerals. Reason: Plex comes from instrument and engineering documentation, its digits stay distinct at 11 to 12 px, and mono is used only where columns of identifiers must align and compare, which is data, not styling. No uppercase tracking labels; section labels are sentence case, 12 px, medium weight.

## Shape, depth, motion

- Radius: 2 px on controls and panels, 4 px on dialogs. No pills. Reason: instrument panels are square-cut, and radius carries hierarchy only between dialog and control.
- Depth: panels are flat with 1 px lines. Shadow is allowed only on the dialog and the toast stack (they float above the working surface). Reason: elevation should mean "this is above the work".
- Glass and glow: none in the 2D UI. The only glow is the 3D status lamps, because they are physical lights. Focus uses a 2 px rose outline with offset.
- Motion: colour changes on state (150 ms), the dock and dialogs fade in once. Nothing loops. The simulation itself moves, and that is the point of the page.

## Identity motif

The FOUP, the front-opening pod that carries 25 wafers. It is the mark in the top bar, the marker for lots on the 2D map and in the 3D scene, and the subject of the empty-state illustrations (drawn as isometric SVG, with tool and wafer drawings in the same style). Reason: it is the object the whole system exists to move, so the identity comes from the domain and not from a stock shape.

## Icons and illustration

No icon library. State is shown with the five glyph shapes above. Actions are text buttons. Illustrations are original isometric SVG of fab objects (FOUP, process tool, wafer) in `src/art/`. No downloaded images, no image services.

## Honesty

Every number is simulated and the interface says so: a persistent "Portfolio project, simulated fab" strip, a note beside the KPIs, and the same on the briefing and report. No testimonials, customer logos, or invented metrics. Empty states say why they are empty and what fills them.

## Responsive behaviour

Phones (under 768 px) get a 2D floor map instead of the WebGL scene, with a bottom tab bar (Floor, Alerts, Lots, Charts) and 44 px minimum targets. Desktops can switch between 3D and the 2D map.

## Copy

Plain statements, sentence case, no em dashes, no buzzwords. Buttons say what they do: "Start shift", "Send to PM now", "Assign repair crew".

## Keyboard

The 3D floor is a single focus stop. Tab reaches it, the arrow keys move the selection to the nearest tool in that direction (sideways drift counts double, so "right" follows the row), N and P walk the tools in reading order, Enter flies the camera there, and 0 to 5 return to the overview or a bay. The selection is spoken through a polite live region, and a Keyboard help button lists every key. Reason: a canvas is invisible to a keyboard, so the tools need a pointer-free way to be chosen, and a pure function (`src/scene/nav.ts`) decides the next tool so it is tested without a canvas.

## Live mode

Live mode shows what a feed reports and says so. The console keeps one layout for simulated and live data: tool states, alarms, Gantt and genealogy come from the events, KPIs, WIP and SPC are computed from them, and FOUP motion is drawn by the live twin from lot events. The vehicles in live mode are synthesised because no feed carries vehicle positions, and the interface names them as such. Reason: showing a drawn vehicle as if it were a measured one would be the one lie this product cannot afford.

## Integrations page

One row per input and output, with a tier mark (a distinct glyph per tier, never colour alone), the protocol, a summary, what the tier does and does not prove, the recorded-run pointer and the setup steps with copyable commands. The page renders `src/integrations/catalog.ts`, and a test checks the tiers and the commands against `package.json` and `docs/integration-runs.md`, so the page cannot promise more than a recorded run shows. Not-proven items are listed as such instead of being hidden.

