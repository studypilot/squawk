# squawk CLI

Command-line client for [Squawk](../../README.md), the self-hosted comment layer for preview
deployments. Reviewers pin comments ("squawks") with a screenshot onto a test build; this CLI lets
humans and coding agents list them, read the thread and screenshot, reply, and resolve them.

## Install

The package is published to GitHub Packages. Point the `@studypilot` scope at it once, then
install globally (Node 22 or newer):

```bash
echo "@studypilot:registry=https://npm.pkg.github.com" >> ~/.npmrc
npm i -g @studypilot/squawk-cli
squawk --version
```

GitHub Packages needs a token with `read:packages` in `~/.npmrc`
(`//npm.pkg.github.com/:_authToken=...`). The package has no runtime dependencies; everything is
bundled into `dist/main.js`.

## Log in

```bash
squawk login --server https://squawk.studypilot.app
```

The CLI prints a code and a link and opens the browser. Confirm the code there; the CLI stores the
server and a 30-day token in `~/.config/squawk/config.json` (mode 0600, respects
`XDG_CONFIG_HOME`). `squawk logout` removes the token again.

Agents do not log in. Give them a token through the environment instead:

```bash
export SQUAWK_SERVER=https://squawk.studypilot.app
export SQUAWK_TOKEN=sqk_...
```

## Commands

Global options: `--server <url>` (overrides everything else) and `--json` (prints the raw API
response instead of text). References (`REF`) are a squawk uuid, `<site>#<n>`, or `#<n>` / `<n>`
together with `--site`. Quote `<site>#<n>` in zsh: `'feat/login#3'`.

| Command                                                                           | Example                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `login [--server URL]`                                                            | `squawk login --server https://squawk.studypilot.app`                                |
| `logout`                                                                          | `squawk logout`                                                                      |
| `whoami`                                                                          | `squawk whoami`                                                                      |
| `sites`                                                                           | `squawk sites`                                                                       |
| `list --site KEY [--status open\|resolved\|all] [--page KEY] [--limit N] [--all]` | `squawk list --site feat/login --status all --all`                                   |
| `show REF [--site KEY]`                                                           | `squawk show 'feat/login#3'`                                                         |
| `screenshot REF [--site KEY] [--out PATH]`                                        | `squawk screenshot '#3' --site feat/login --out /tmp/3.png`                          |
| `reply REF (TEXT \| --file PATH \| -)`                                            | `squawk reply 'feat/login#3' "Fixed in a1b2c3d."`                                    |
| `resolve REF [--comment TEXT]`                                                    | `squawk resolve 'feat/login#3' --comment "Fixed in a1b2c3d."`                        |
| `reopen REF`                                                                      | `squawk reopen 'feat/login#3'`                                                       |
| `token create --name NAME [--site KEY] [--expires-days N]`                        | `squawk token create --name "Claude feat/login" --site feat/login --expires-days 14` |
| `token list`                                                                      | `squawk token list`                                                                  |
| `token revoke ID`                                                                 | `squawk token revoke 6f1c...`                                                        |
| `site-key`                                                                        | `squawk site-key`                                                                    |

Notes:

- `list` shows open squawks by default, 50 per page. `--all` follows the cursors and prints every
  page; with `--json` it prints one combined `{ items, nextCursor: null }`.
- `show` prints page, URL, ref, viewport, anchor (test id, CSS selector, text), the first comment
  and all replies.
- `screenshot` saves to `./squawk-<site>-<n>.png` by default and prints the absolute path.
- `reply` takes the text as an argument, from `--file PATH`, or from stdin with `-`:
  `git log -1 --format=%B | squawk reply 'feat/login#3' -`.
- `resolve --comment` posts the comment first and only resolves if that succeeded.
- `token create` prints the secret exactly once. Only humans can create and revoke tokens; agent
  tokens cannot.
- `site-key` prints the current git branch as a site key (characters outside
  `A-Z a-z 0-9 . _ : / @ -` become `-`), so a build that embeds Squawk with the branch name and an
  agent working on that branch agree on the key.

## Environment

| Variable          | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `SQUAWK_SERVER`   | Server URL. Wins over the config file, loses to `--server`. |
| `SQUAWK_TOKEN`    | Bearer token. Wins over the stored login.                   |
| `XDG_CONFIG_HOME` | Config directory, default `~/.config`.                      |

The stored token is only sent to the server it was issued by. Passing a different `--server`
without `SQUAWK_TOKEN` runs unauthenticated.

## Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Success                                               |
| 1    | Error (message on stderr)                             |
| 2    | Not logged in, or the server rejected the token (401) |

## Scripting with `--json`

`--json` prints the API objects unchanged, so the shapes match `@squawk/shared`.

```bash
# Numbers and first lines of all open squawks
squawk list --site feat/login --all --json | jq -r '.items[] | "#\(.number) \(.body | split("\n")[0])"'

# Count open squawks per page
squawk list --site feat/login --all --json | jq '.items | group_by(.page) | map({page: .[0].page, count: length})'

# Anchor selectors of one squawk
squawk show 'feat/login#3' --json | jq '.anchor.selectors'

# Download every screenshot of the open squawks
for number in $(squawk list --site feat/login --all --json | jq -r '.items[] | select(.screenshot) | .number'); do
   squawk screenshot "#$number" --site feat/login
done
```

## Development

```bash
pnpm --filter @studypilot/squawk-cli test
pnpm --filter @studypilot/squawk-cli build   # dist/main.js, single file
node packages/cli/dist/main.js --help
```
