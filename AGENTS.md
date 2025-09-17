# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts` boots the Hono server and orchestrates start-up sync tasks.
- Application logic lives in `src/routes` with HTTP handlers and co-located `*.test.ts` suites.
- Domain helpers sit in `src/lib`, while Drizzle schema and bootstrap code are in `src/db`.
- `src/test-utils/db.ts` offers in-memory PGlite helpers; reuse them for deterministic specs.
- Database migrations live in `drizzle/`; transpiled assets land in `dist/` after builds.

## Build, Test, and Development Commands
- `npm run dev` — start watch mode via `tsx`, hot-reloading TypeScript changes.
- `npm run build` — compile to `dist/` using `tsc`; run before deploying.
- `npm start` — execute `dist/index.js`; ensure a fresh build exists first.
- `npm test` — run the Vitest suite scoped to `src/routes/**/*.test.ts`.
- `npm run test:coverage` — enable V8 coverage (90% lines/functions/statements, 100% branches).

## Coding Style & Naming Conventions
- TypeScript with ES modules; prefer named exports and async, side-effect-light route handlers.
- Use 2-space indentation, `camelCase` for values, `PascalCase` for types, `UPPER_CASE` for env keys.
- Mirror implementation filenames (`resource.ts`) with tests (`resource.test.ts`) and keep modules focused.
- Run `npm run build` locally to surface type regressions—no standalone linter is configured yet.

## Testing Guidelines
- Vitest loads `vitest.setup.ts`; share fixtures via `src/test-utils/db.ts` for isolated state.
- Seed new models through Drizzle helpers to keep tests deterministic and idempotent.
- Place additional suites under `src/routes/...` so coverage picks them up automatically.
- Use explicit expectation counts when asserting rejections and prefer scenario-driven `describe` blocks.

## Commit & Pull Request Guidelines
- Follow the existing history: concise, imperative subjects (`use real in-memory db for tests`, `test: fix schedule overlap`).
- Keep commits scoped to a single concern and mention the touched module or domain in the subject or scope.
- Reference related issues in the body and highlight required env or migration changes.
- PRs should include purpose, local test results, API/schema notes, and screenshots when behavior shifts are visible.
