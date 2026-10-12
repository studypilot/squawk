# Deploying Squawk

Squawk ships as one Docker image. It needs a Postgres database (16 or newer, 17 recommended) and
a writable directory for screenshots. The server applies database migrations itself on every
start, before it accepts requests.

## Quick start with Docker Compose

```bash
cp deploy/.env.example deploy/.env      # set SESSION_SECRET, PUBLIC_URL, OIDC_*
docker compose -f deploy/docker-compose.yml up --build -d
open http://localhost:3000
```

The compose file starts `postgres:17-alpine` and the server. Postgres is also published on
`127.0.0.1:5544` for local tools (`psql postgres://squawk:squawk@127.0.0.1:5544/squawk`); 5544 avoids
clashing with a Postgres already listening on 5432.

To build the image alone, run from the repository root:

```bash
docker build -f deploy/Dockerfile -t squawk .
```

## Environment variables

| Variable                     | Required  | Default                       | Meaning                                                                                                                                                                                                                                                                         |
| ---------------------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | yes       |                               | Postgres connection string, e.g. `postgres://squawk:secret@db:5432/squawk`.                                                                                                                                                                                                     |
| `PUBLIC_URL`                 | yes       |                               | URL users reach Squawk at, e.g. `https://squawk.example.com`. Used for the OIDC redirect URI and device-login links. Cookies are `Secure` when it starts with `https://`.                                                                                                       |
| `SESSION_SECRET`             | yes       |                               | At least 32 characters. Signs session cookies (HS256). Generate with `openssl rand -base64 48`. Changing it signs everyone out.                                                                                                                                                 |
| `OIDC_ISSUER`                | no        | `https://accounts.google.com` | OpenID Connect issuer; discovery runs on the first sign-in.                                                                                                                                                                                                                     |
| `OIDC_CLIENT_ID`             | no        |                               | OAuth client id. Without client id and secret, browser sign-in is disabled and `/auth/login` answers 503.                                                                                                                                                                       |
| `OIDC_CLIENT_SECRET`         | no        |                               | OAuth client secret. Set both or neither.                                                                                                                                                                                                                                       |
| `OIDC_ALLOWED_EMAIL_DOMAINS` | with OIDC |                               | Comma-separated email domains that may sign in, e.g. `example.com,example.org`. This is the only access control: every signed-in user of these domains can use Squawk.                                                                                                          |
| `OIDC_HOSTED_DOMAIN`         | no        |                               | Google Workspace domain. Sends `hd` with the sign-in request and requires the `hd` claim to match.                                                                                                                                                                              |
| `DATA_DIR`                   | no        | `/data`                       | Screenshot storage. Must be writable by the server (user `node`, uid 1000, in the image).                                                                                                                                                                                       |
| `PORT`                       | no        | `3000`                        | HTTP port inside the container.                                                                                                                                                                                                                                                 |
| `LOG_LEVEL`                  | no        | `info`                        | `debug`, `info`, `warn`, `error` or `silent`. Logs are JSON lines on stdout.                                                                                                                                                                                                    |
| `SQUAWK_DEV_USER`            | no        |                               | Development only: requests without credentials act as this email address. The server refuses to start when this is set together with `NODE_ENV=production` (the image sets `NODE_ENV=production`).                                                                              |
| `SQUAWK_TRUSTED_ORIGINS`     | no        |                               | Comma-separated page origins whose overlay popup sign-in skips the consent card, e.g. `https://*.preview.example.com,http://localhost:*`. Format `scheme://host[:port]`; `*` matches part of one host label (never a dot) or any port. Other origins see an "Allow" card first. |

## Volume

Mount a persistent volume at `/data` (or `DATA_DIR`). Screenshots are stored as
`/data/screenshots/<yyyy>/<mm>/<uuid>.png`; the database holds the relative path. The server runs
as a single replica: rate limits for device logins live in memory and the volume is usually
`ReadWriteOnce`.

## Sign-in with Google

1. In the Google Cloud console, open **APIs & Services → Credentials → Create credentials → OAuth
   client ID**, application type **Web application**.
2. Add the authorized redirect URI `<PUBLIC_URL>/auth/callback`, for example
   `https://squawk.example.com/auth/callback`.
3. Copy the client id and secret into `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`.
4. Set `OIDC_ALLOWED_EMAIL_DOMAINS=example.com` and, for a Google Workspace domain,
   `OIDC_HOSTED_DOMAIN=example.com`.

Any other OpenID Connect provider works the same way: set `OIDC_ISSUER` to its issuer URL and
register the same redirect URI. The provider must return an `email` claim for the scopes
`openid email profile`; addresses marked `email_verified: false` are refused.

Overlays and the CLI never use the browser session directly; they hold a 30-day login token,
listed and revocable on the inbox token page. The overlay gets it through a popup: "Sign in" opens
`<PUBLIC_URL>/connect`, which uses the browser session there (signing in first if needed), asks
for consent on a "Connect this site" card unless the page origin matches `SQUAWK_TRUSTED_ORIGINS`,
and hands the token to the page that opened it. When the browser blocks the popup, or with "Use a
code instead" (embedded web views), the overlay falls back to the device-code flow the CLI uses:
the user confirms a code on `<PUBLIC_URL>/device`.

## Health check

`GET /healthz` answers `{"ok":true}` when the database responds and `DATA_DIR` is writable, and
503 otherwise. The image has a Docker `HEALTHCHECK` on it; use the same path for Kubernetes
readiness and liveness probes.

## Reverse proxy

Terminate TLS in front of Squawk and forward to port 3000. Serve it on its own hostname at the
root path. No forwarded headers are needed: all external URLs derive from `PUBLIC_URL`. Allow
request bodies of at least 9 MB for screenshot uploads.

## Backups

Back up both:

- **Postgres**, e.g. `pg_dump --format=custom "$DATABASE_URL" > squawk.dump`, or your operator's
  continuous backup.
- **The `/data` volume**, e.g. a nightly file copy or volume snapshot.

Screenshots are referenced from the database, so restore both from roughly the same point in time.
A screenshot missing on disk shows up as a 404 for that image; everything else keeps working.
