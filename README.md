# Squawk

Comment on any preview deployment. Pin a spot on the page, attach a screenshot, discuss, resolve.
Built for teams that put unfinished builds online for review, and for the coding agents that
built them.

- **One script tag** on any page: `<script src="https://squawk.example.com/squawk.js" data-site="my-branch" defer></script>`
- **Pins stick to DOM elements** with a selector bundle and fall back to page coordinates plus the screenshot.
- **Exact screenshots** through a small Chrome extension; approximate DOM rendering without it.
- **Team sign-in** through any OIDC provider, restricted to your email domain. No per-site accounts.
- **Agents** read, answer and resolve squawks through a CLI with revocable tokens.
- **Self-hosted**: one Docker image, Postgres, a volume for screenshots.

In pilot jargon a _squawk_ is a defect a crew writes up for maintenance. That is what a comment here is.

## Packages

| Package              | What it is                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `packages/server`    | Hono API, OIDC and device-code login, Postgres via Drizzle, serves the inbox and the overlay |
| `packages/overlay`   | `squawk.js`, the framework-free overlay embedded on reviewed pages                           |
| `packages/inbox`     | React web UI: sites, squawks, tokens, device approval                                        |
| `packages/cli`       | `squawk` command for scripts and agents, published as `@studypilot/squawk-cli`               |
| `packages/extension` | Chrome extension that supplies pixel-exact screenshots to the overlay                        |
| `packages/shared`    | The API contract (zod schemas) every package builds against                                  |
| `skills/squawk`      | Claude Code skill that teaches an agent the review workflow                                  |

## Run it

See `docs/deploy.md` for the Docker image, environment variables and the OIDC setup.
Local development: `pnpm install`, `docker compose -f deploy/docker-compose.yml up -d db`, then
`pnpm --filter @squawk/server dev`, `pnpm --filter @squawk/inbox dev` and
`pnpm --filter @squawk/overlay dev`.

## Design

`docs/plans/001-mvp.md` is the design document the first version was built from. `brand/` holds
the Squawk mark as master SVGs, with the stroke widths per size.

## License

MIT
