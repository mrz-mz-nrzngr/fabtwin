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

Dark only, no toggle. Reason: MES consoles run in dim control rooms and the 3D scene needs a dark ground for status lamps to read as light sources. A light theme would mean re-lighting the scene for no user benefit, so none is shipped (R-21).

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
| `--accent` | `#ff5c93` | The one accent: hot lots, the selected object, the primary action. Rose, because hot lots are tagged red-pink on real fab floors and it must not collide with any status colour. Text on it is `#1a0a12`, 6.6:1. Accent on panel is 6.0:1. |

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
