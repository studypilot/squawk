# Contributing

Thanks for helping. Squawk is small on purpose: one server, three clients, one shared contract.
Changes that keep it that way are the easiest to merge. For anything bigger than a fix, open an
issue first and describe the problem before the solution.

## Setup

Requirements: Node 22 or newer, pnpm (the version in `package.json` via `corepack enable`),
Docker for Postgres.

```bash
pnpm install
docker compose -f deploy/docker-compose.yml up -d db     # Postgres on 127.0.0.1:5544
```

Run the server with a development user, so you do not need an OIDC provider. The server reads its
configuration from the environment only:

```bash
export DATABASE_URL=postgres://squawk:squawk@127.0.0.1:5544/squawk
export PUBLIC_URL=http://localhost:5173
export SESSION_SECRET=$(openssl rand -base64 48)
export SQUAWK_DEV_USER=you@example.com
export DATA_DIR=$PWD/data
pnpm --filter @squawk/server dev        # http://localhost:3000, restarts on change
```

In two more terminals:

```bash
pnpm --filter @squawk/inbox dev         # http://localhost:5173, proxies /api and /auth to :3000
pnpm --filter @squawk/overlay dev       # http://localhost:5174, a demo page with the overlay
```

`PUBLIC_URL` is the inbox dev server because cookie-authenticated writes must come from the
`PUBLIC_URL` origin. On the overlay demo page, sign in with **Use a code instead** and confirm the
code in the inbox at `http://localhost:5173/device`; the popup sign-in needs the inbox served from
the server origin, which is what the Docker image does.

The CLI against the dev server, with its own config directory so your real login stays untouched:

```bash
export XDG_CONFIG_HOME=/tmp/squawk-dev-config
pnpm --filter @studypilot/squawk-cli dev login --server http://localhost:3000
```

The extension: `pnpm --filter @squawk/extension build`, then load `packages/extension/dist`
unpacked in `chrome://extensions`.

To run the whole thing as the image does, see [Trying it locally](docs/deploy.md#trying-it-locally).

## Gates

CI runs these on every pull request. Run them before you push:

```bash
pnpm format:check     # prettier; `pnpm format` fixes
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker build -f deploy/Dockerfile -t squawk:ci .
```

## Conventions

- **The contract comes first.** Request and response shapes live in `packages/shared/src/api.ts`
  as zod schemas. Change them there, then in the server, then in the clients.
- **Database changes** go through Drizzle: edit `packages/server/src/db/schema.ts`, run
  `pnpm --filter @squawk/server db:generate`, and commit the generated migration in
  `packages/server/drizzle`. Migrations must work on a database with data in it.
- **TypeScript** everywhere, strict. Prettier: 3 spaces, no semicolons, double quotes, width 100.
  Full words for names, guard clauses over nesting.
- **Tests** sit next to the code (`*.spec.ts`, `*.test.tsx` in the inbox). Server tests run
  against an in-process Postgres (PGlite), so they need no database.
- **The overlay has no framework and no runtime dependencies beyond the two it has.** Keep it
  small; it loads on every preview page.
- **The CLI has no runtime dependencies**; everything is bundled into one file.
- **English** in code, UI and docs.
- **Commits** follow Conventional Commits with the package as scope:
  `feat(overlay): …`, `fix(server): …`, `docs: …`.

## Pull requests

- Target `main`. Keep one topic per pull request.
- Describe what changes for reviewers, agents or operators, and how you verified it. Screenshots
  for UI changes.
- Update the docs in the same pull request when behaviour changes: `README.md`, `docs/`, the CLI
  README, and `skills/squawk/SKILL.md` together with `docs/agents.md` when the agent workflow
  changes.

Releases are cut by the maintainers: every push to `main` publishes the image, and a `v*` tag
publishes the CLI and the extension.

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
