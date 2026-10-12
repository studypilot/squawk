# Setting up Squawk: instructions for coding agents

You were asked something like "Set up https://github.com/studypilot/squawk for me and integrate it
into my site." This file tells you how. Work through it top to bottom. Every command here matches
the code in this repository; when something does not work as written, stop and tell the user
instead of improvising around it.

## Read this first

Squawk is a comment layer for preview deployments. Reviewers pin comments ("squawks") with a
screenshot onto a preview build through a script tag; coding agents read, answer and resolve them
through the `squawk` CLI. One server (Docker image plus Postgres) holds everything.

You are done when all of this is true:

1. A Squawk server is reachable over HTTPS and users of the allowed email domain can sign in.
2. The overlay script is embedded in the user's preview builds, and only in those.
3. The `squawk` CLI is installed and logged in as the user (`squawk whoami` works).
4. The Squawk skill (or its instructions) is installed for the user's agent.
5. You have verified a round trip: a squawk left on a preview reaches `squawk watch`, gets a reply,
   gets resolved, and the reviewer sees the reply as unread.

## Ask before you act

Resolve these with the user before changing anything. Ask in one message, offer the defaults in
brackets, and do not guess the answers you cannot read from the repository.

**Server**

1. Is there already a Squawk server to use? If yes: its URL. Skip to [Embed the overlay](#embed-the-overlay).
2. If self-hosting:
   - Hostname, e.g. `squawk.example.com`. It needs its own hostname; Squawk does not run under a
     path prefix.
   - Where it runs: a Docker host or VPS with Docker Compose [default], Kubernetes, or other.
   - Does the host already run a reverse proxy with TLS? If not, use the Caddy override below.
   - CPU architecture of the host (`uname -m`). The published image is currently `linux/arm64`
     only; on `x86_64` you build the image on the host (see step 4 below).
   - Identity provider: Google Workspace [default] or another OpenID Connect provider (issuer URL).
   - Email domains that may sign in, e.g. `example.com`. Everyone with an address in these domains
     gets access; there is no other access control.
   - Preview origins to trust, e.g. `https://*.preview.example.com`. Overlays on these origins sign
     in without a consent card.

**Integration**

3. Which repository and framework (plain HTML, Vite, Next.js, other)?
4. How are previews deployed (Vercel, Netlify, Cloudflare Pages, own CI) and what identifies a
   build: branch name, pull request number, commit SHA? The default site key is the branch name.
5. May the script be gated by an environment variable so that production builds never contain it?
   [yes; strongly recommended]
6. Does the site send a Content-Security-Policy or `Cross-Origin-Opener-Policy` header?

**Agent tooling**

7. Which agent will work on squawks: Claude Code (install the skill by symlink) or another agent
   (add `docs/agents.md` to its instructions)?

## Self-host with Docker Compose

Requirements: Docker with Compose 2.23.1 or newer, a DNS record for the hostname pointing at the
host, ports 80 and 443 reachable if you use Caddy.

There are three compose files in `deploy/`:

| File                       | Use                                                                           |
| -------------------------- | ----------------------------------------------------------------------------- |
| `docker-compose.yml`       | Local trial and development; builds the image from source, Postgres on 5544   |
| `docker-compose.prod.yml`  | Servers: prebuilt image, no published database, restart always, named volumes |
| `docker-compose.caddy.yml` | Optional override for `prod`: Caddy in front with automatic HTTPS             |

1. **Get the files.** Either clone the repository, or download just these into one directory on
   the host:

   ```bash
   mkdir -p ~/squawk && cd ~/squawk
   base=https://raw.githubusercontent.com/studypilot/squawk/main/deploy
   curl -fsSLO "$base/docker-compose.prod.yml"
   curl -fsSLO "$base/docker-compose.caddy.yml"
   curl -fsSL "$base/.env.example" -o .env
   chmod 600 .env
   ```

   With a clone, the files are in `deploy/` and `.env` is `deploy/.env`.

2. **Fill in `.env`.** Generate the secrets on the host and write them straight into the file. Do
   not print them into the chat and never commit `.env`.

   ```bash
   sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 48)|" .env
   echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
   rm .env.bak
   ```

   Then set:

   - `PUBLIC_URL=https://squawk.example.com` (no trailing slash)
   - `OIDC_ALLOWED_EMAIL_DOMAINS=example.com`
   - `SQUAWK_TRUSTED_ORIGINS=https://*.preview.example.com` (or leave empty)
   - `SQUAWK_DOMAIN=squawk.example.com` when you use Caddy

   Leave `NODE_ENV` and `SQUAWK_DEV_USER` unset. `POSTGRES_PASSWORD` is only applied when the
   database volume is created; changing it later needs `ALTER USER` in Postgres.

3. **Sign-in.** Ask the user to create the OAuth client; it needs their admin console.
   - **Google:** Google Cloud console, **APIs & Services → Credentials → Create credentials →
     OAuth client ID**, type **Web application**, authorized redirect URI
     `https://squawk.example.com/auth/callback`. Put the client id and secret into
     `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. For a Workspace domain also set
     `OIDC_HOSTED_DOMAIN=example.com`.
   - **Other OIDC providers:** set `OIDC_ISSUER` to the issuer URL, register the same redirect URI
     `<PUBLIC_URL>/auth/callback`, request scopes `openid email profile`. The provider must return
     `email` and `email_verified: true`.

   The user pastes the secret into `.env` on the host themselves, or gives it to you to write there.
   Either way it goes into `.env` only.

4. **Image.** `docker-compose.prod.yml` uses `ghcr.io/studypilot/squawk:latest`, which follows the
   `main` branch. To control upgrades, pin a tag instead: `ghcr.io/studypilot/squawk:<commit sha>`
   or `:prod-<date>.<time>`. On an `x86_64` host, build the image from a clone and point the
   compose file at it:

   ```bash
   git clone https://github.com/studypilot/squawk ~/squawk-src
   docker build -f ~/squawk-src/deploy/Dockerfile -t squawk:local ~/squawk-src
   sed -i.bak 's|image: ghcr.io/studypilot/squawk:latest|image: squawk:local|' docker-compose.prod.yml
rm docker-compose.prod.yml.bak
   ```

5. **Start.**
   - With Caddy (no reverse proxy on the host yet):

      ```bash
      docker compose -f docker-compose.prod.yml -f docker-compose.caddy.yml up -d
      ```

      Caddy obtains a certificate for `SQUAWK_DOMAIN` from Let's Encrypt and allows request bodies
      up to 10 MB (screenshot uploads are up to about 8.5 MB).

   - Behind an existing reverse proxy on the same host:

      ```bash
      docker compose -f docker-compose.prod.yml up -d
      ```

      Squawk listens on `127.0.0.1:3000`. Proxy the hostname's root path to it, terminate TLS
      there, and allow request bodies of at least 9 MB.

6. **Verify.**

   ```bash
   docker compose -f docker-compose.prod.yml ps          # server healthy
   curl -fsS https://squawk.example.com/healthz          # {"ok":true}
   curl -fsS -o /dev/null -w '%{http_code}\n' https://squawk.example.com/squawk.js   # 200
   ```

   Then ask the user to open `https://squawk.example.com` and sign in. If sign-in fails, read
   `docker compose -f docker-compose.prod.yml logs server`; the server logs JSON lines and refuses
   to start with a readable message when the configuration is invalid.

Backups (Postgres and the `squawk-data` volume) are described in [docs/deploy.md](docs/deploy.md#backups).
Tell the user about them; do not set up a backup job unless asked.

## Kubernetes

There is no Helm chart in this repository. Write plain manifests:

- A `Deployment` with **one replica** and strategy `Recreate`: device-login rate limits live in
  memory, and the screenshot volume is usually `ReadWriteOnce`.
- Image `ghcr.io/studypilot/squawk:<tag>`, container port 3000, runs as uid 1000 (set
  `fsGroup: 1000` so the volume is writable).
- Environment from a `Secret`: `DATABASE_URL`, `PUBLIC_URL`, `SESSION_SECRET`, `OIDC_*`,
  `SQUAWK_TRUSTED_ORIGINS`.
- A `PersistentVolumeClaim` mounted at `/data`.
- Readiness and liveness probes: `httpGet` on `/healthz`, port 3000.
- Postgres 16 or newer from the cluster's usual source (an operator or a managed database).
- An `Ingress` for the hostname with TLS and a body size of at least 9 MB (for ingress-nginx:
  `nginx.ingress.kubernetes.io/proxy-body-size: 10m`).

Migrations run when the server starts; there is no separate job.

## Embed the overlay

The overlay is one script served by the Squawk server. Attributes:

- `data-site`: the site key. Use the branch name (or whatever identifies the preview, as agreed
  with the user). Allowed characters: `A-Z a-z 0-9 . _ : / @ -`; replace anything else with `-`,
  exactly like `squawk site-key` does.
- `data-ref`: the commit SHA or build id, stored with every squawk.

Common build variables for branch and commit: Vercel `VERCEL_GIT_COMMIT_REF` /
`VERCEL_GIT_COMMIT_SHA`, Netlify `BRANCH` / `COMMIT_REF`, Cloudflare Pages `CF_PAGES_BRANCH` /
`CF_PAGES_COMMIT_SHA`, GitHub Actions `GITHUB_HEAD_REF` (pull requests) or `GITHUB_REF_NAME` /
`GITHUB_SHA`. Check the hosting provider's documentation for the exact names.

**Plain HTML**, templated by the build:

```html
<script
   src="https://squawk.example.com/squawk.js"
   data-site="feature/settings"
   data-ref="3f6dd62"
   defer
></script>
```

**Vite (React, Vue, Svelte)**, in the client entry (`src/main.tsx` or similar). Only builds with
`VITE_SQUAWK_URL` set load the overlay:

```ts
const squawkUrl = import.meta.env.VITE_SQUAWK_URL
if (squawkUrl) {
   const script = document.createElement("script")
   script.src = `${squawkUrl}/squawk.js`
   script.dataset.site = import.meta.env.VITE_SQUAWK_SITE ?? location.hostname
   script.dataset.ref = import.meta.env.VITE_SQUAWK_REF ?? ""
   script.defer = true
   document.head.append(script)
}
```

Set `VITE_SQUAWK_URL`, `VITE_SQUAWK_SITE` and `VITE_SQUAWK_REF` in the preview environment only.

**Next.js (App Router)**, in `app/layout.tsx`:

```tsx
import Script from "next/script"

const squawkUrl = process.env.NEXT_PUBLIC_SQUAWK_URL

export default function RootLayout({ children }: { children: React.ReactNode }) {
   return (
      <html lang="en">
         <body>
            {children}
            {squawkUrl && (
               <Script
                  src={`${squawkUrl}/squawk.js`}
                  data-site={process.env.NEXT_PUBLIC_SQUAWK_SITE}
                  data-ref={process.env.NEXT_PUBLIC_SQUAWK_REF}
                  strategy="afterInteractive"
               />
            )}
         </body>
      </html>
   )
}
```

**Single-page apps.** The overlay follows `history.pushState`, `replaceState`, `popstate` and
`hashchange` by itself and uses path, query and hash as the page key. Only if the app needs a
different page key (for example to drop ids from the path), call `window.Squawk.setPage(key)` on
every route change; after the first call the overlay stops deriving the key from the URL. Calls
made before the script has loaded go into a queue:

```js
window.Squawk = window.Squawk || { q: [] }
window.Squawk.q.push(["setPage", "/projects/:id"])
```

Once loaded, call `window.Squawk.setPage(...)` directly. Full API: [docs/integrate.md](docs/integrate.md).

**Content Security Policy.** If the site sends a CSP, add the Squawk origin (here
`https://squawk.example.com`) to the preview's policy:

- `script-src https://squawk.example.com`
- `connect-src https://squawk.example.com`
- `img-src https://squawk.example.com blob: data:`
- `style-src https://squawk.example.com 'unsafe-inline'` (the overlay injects a `<style>` element
  into its shadow root and loads its font CSS from the server)
- `font-src https://squawk.example.com`

Sign-in opens a popup on the Squawk server that posts the token back to the page.
`Cross-Origin-Opener-Policy: same-origin` on the preview breaks that link; use
`same-origin-allow-popups` or no COOP on previews. Without the popup, the overlay falls back to a
code the user confirms on `<PUBLIC_URL>/device`.

**Trusted origins.** Put the preview origins into `SQUAWK_TRUSTED_ORIGINS` on the server (format
`scheme://host[:port]`, `*` matches part of one host label or any port, e.g.
`https://*.preview.example.com,http://localhost:*`). Other origins show an "Allow" card in the popup
first.

**Exact screenshots** need the Chrome extension: download `squawk-extension-<version>.zip` from
the latest release, unzip, `chrome://extensions` → Developer mode → Load unpacked. Tell reviewers;
it is optional.

## CLI

Node 22 or newer. Install either way:

```bash
# From GitHub Packages; needs a GitHub token with read:packages in ~/.npmrc
# (//npm.pkg.github.com/:_authToken=...)
echo "@studypilot:registry=https://npm.pkg.github.com" >> ~/.npmrc
npm i -g @studypilot/squawk-cli

# Or without a token, from the tarball on a GitHub release
npm i -g https://github.com/studypilot/squawk/releases/download/v<version>/studypilot-squawk-cli-<version>.tgz
```

Pick `<version>` from `gh release view --repo studypilot/squawk` or the releases page.

Log in. The user confirms a code in the browser:

```bash
squawk login --server https://squawk.example.com
squawk whoami
```

The token is stored in `~/.config/squawk/config.json` (mode 0600) for 30 days. Exit codes of every
command: `0` ok, `1` error, `2` not logged in or token rejected, `3` `watch` timed out.

On machines where nobody can confirm a browser login (CI, remote agents), the user creates an agent
token in the inbox (**Tokens**) or with `squawk token create --name "..." --site KEY`, and you set
`SQUAWK_SERVER` and `SQUAWK_TOKEN` in that environment. Writes through an agent token show the token
name instead of the user.

## Skill / instructions for the agent

- **Claude Code**, for all projects of the user:

   ```bash
   git clone https://github.com/studypilot/squawk ~/squawk-src   # if not cloned yet
   mkdir -p ~/.claude/skills
   ln -s ~/squawk-src/skills/squawk ~/.claude/skills/squawk
   ```

   Or for one project only: copy `skills/squawk/SKILL.md` to `.claude/skills/squawk/SKILL.md` in
   that repository and commit it.

- **Other agents:** add the content of [docs/agents.md](docs/agents.md) to the agent's instructions
  file (for example `AGENTS.md` in the user's repository).

## Verify the round trip

Do this with the user on a real preview build:

1. The user opens the preview, clicks **Sign in** in the overlay, presses `c`, clicks an element and
   sends a squawk with **Send now**.
2. In the user's repository on the preview's branch:

   ```bash
   squawk site-key                       # must match data-site of the preview
   squawk list --site "$(squawk site-key)"
   squawk watch --site "$(squawk site-key)" --json --out /tmp/squawk --timeout 60
   ```

   `watch` must exit 0 and return the squawk with a `screenshotPath`. The overlay shows it as
   "working".

3. Reply and resolve:

   ```bash
   squawk resolve 'KEY#N' --comment "Round trip test, resolving."
   ```

4. The user reloads the preview: the squawk shows an unread dot, the reply reads "Agent · for
   <their name>", and the squawk is resolved. The inbox shows the same.

If the site key differs between preview and checkout, fix the embedding, not the CLI call.

## Rules

- Never create tokens for yourself (`squawk token create`, the inbox tokens page) unless the user
  asks you to. Use the user's `squawk login`.
- Secrets (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `OIDC_CLIENT_SECRET`, tokens) go into `.env` or
  a Kubernetes `Secret` only. Never into the chat, the repository, CI logs or commit messages.
- `SQUAWK_DEV_USER` turns off authentication. Use it only on the user's own machine with the port
  bound to `127.0.0.1`; never on a server others can reach.
- Do not downgrade TLS: `PUBLIC_URL` is `https://` for every server that is not `localhost`, and
  do not disable certificate checks to make something work.
- Do not ship the overlay in production builds unless the user explicitly wants that.
- If a step fails, report the exact error to the user. Do not work around authentication or
  access control.
