# Contributing to FabTwin

Thanks for looking. FabTwin is a portfolio project, but it is built like something you could fork, so contributions that keep it honest and tested are welcome.

## Setup

```bash
npm ci
npm run dev        # http://localhost:3000
npm test           # vitest, runs the engine without a browser
npm run lint
npm run typecheck
npm run build
```

Node 22 or newer.

## Ground rules

1. **The engine stays pure.** Everything under `src/sim/` is plain TypeScript with no DOM, no React, no `Math.random` and no `Date.now`. All randomness goes through `src/sim/rng.ts`, which is counter-based: a draw is a function of `(seed, keys)`. That is what keeps a shift reproducible and keeps two diverging runs comparable. A change that makes `determinism.test.ts` fail is a bug, not a test to loosen.
2. **Behaviour changes need a test.** Routing, dispatch ordering, E10 transitions, queue-time detection and determinism each have a test file in `src/sim/`. Add a case next to the rule you touch.
3. **The event schema is a contract.** `src/events/types.ts`, `src/events/validate.ts` and `docs/fabtwin-event.schema.json` change together, and `events.test.ts` checks that they agree. A breaking change bumps `SCHEMA_VERSION`. Adding an optional field does not.
4. **Say what is simulated.** Every number on screen is simulated, and the UI must keep saying so. Do not add invented customers, logos, testimonials or "real-time" claims.
5. **Read `DESIGN.md` before touching the UI.** No icon libraries, no downloaded images, one accent colour, status colours always paired with a label and a glyph shape, 44 px targets on phones.
6. **Model assumptions live in the README.** If you change a number that shapes the result (process times, MTBF, queue-time limits, scoring), update the assumptions table and rerun `npm run calibrate` to see where autopilot lands against the objectives.

## Pull requests

Keep them small and describe the behaviour change, not the diff. CI runs lint, typecheck, tests and the production build, and all four must pass.
