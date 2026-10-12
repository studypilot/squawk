---
name: squawk
description: Work through reviewer comments ("squawks") left on a preview or test build with the Squawk CLI. Use when the user mentions squawks, review comments on the preview or test build, asks what the reviewer noted or what someone commented on the sandbox, after pushing a dev bundle or preview deployment that reviewers will look at, or when asked to work through reviewer feedback. Lists open squawks for the branch's site key, looks at each screenshot, maps the pinned element to code, fixes it, replies with the commit and resolves only verified fixes.
---

# Squawk: work through reviewer comments

Reviewers click a spot on a preview build and leave a comment with a screenshot. Each comment
thread is a _squawk_, numbered per site (`feat/login#3`). The `squawk` CLI reads and answers them.

## Prerequisites

- `squawk --version` works. If not: `npm i -g @studypilot/squawk-cli` (registry line
  `@studypilot:registry=https://npm.pkg.github.com` in `~/.npmrc`).
- Authentication comes from `SQUAWK_SERVER` / `SQUAWK_TOKEN` or a stored `squawk login`. Check with
  `squawk whoami`. Exit code 2 means not logged in: ask the user to run `squawk login` or provide
  `SQUAWK_TOKEN`. Never create tokens yourself and never print or commit a token.

## Workflow

1. **Site key.** Run `squawk site-key` in the repo (the branch name, which preview builds use by
   default). If the user named a different site, or `squawk sites` shows the branch has no
   squawks, ask which site is meant.
2. **List.** `squawk list --site <key> --json` (add `--all` if `nextCursor` is not null). Work
   through the open squawks one at a time, oldest first.
3. **Read each squawk.**
   - `squawk show '<key>#<n>' --json` for page, `meta.url`, `meta.ref` (commit the reviewer saw),
     viewport, anchor and the full thread.
   - `squawk screenshot '<key>#<n>' --out /tmp/squawk-<n>.png`, then open the PNG with the Read
     tool. Always look at the screenshot; the text alone is often ambiguous. The pinned element is
     at `anchor.elementBox` (viewport pixels; multiply by `screenshot.devicePixelRatio` for image
     pixels).
4. **Find the code.** Map `page` (route) and `anchor.selectors` to source: search for
   `testId` (`data-testid`, `data-test`, `id`) first, then distinctive parts of `css`, then
   `text.exact` in components and translation files. Check that `meta.ref` matches what you expect;
   if the reviewer saw an older build, the issue may already be fixed.
5. **Fix and verify.** Implement the change and verify it the way the project normally does
   (tests, typecheck, running the page). Commit following the repo's conventions.
6. **Reply.** `squawk reply '<key>#<n>' "<one short paragraph: what was wrong, what changed> (<short SHA>)"`.
7. **Resolve** only after the fix is verified: `squawk resolve '<key>#<n>'`, or combine the reply:
   `squawk resolve '<key>#<n>' --comment "..."`.
8. **Unclear request?** Reply with one concrete question and leave the squawk open.

Finish with a summary for the user: which squawks you resolved (with SHAs), which you asked about,
and which you skipped and why.

## Waiting for squawks (agents)

When the user wants you to stay on a preview and handle squawks as they come in, loop on
`squawk watch` instead of polling `list` yourself:

1. Start `squawk watch --site KEY --json --out /tmp/squawk` in the background. In Claude Code:
   the Bash tool with `run_in_background: true` and a timeout of at least `600000` ms; the
   command finishing wakes you up. `watch` gives up by itself after 540 s.
2. **Exit 3** means nothing arrived. Start the same `watch` again right away.
3. **Exit 0** means stdout is one JSON document whose `items` hold _all_ squawks that need
   attention right now, each a full `show` object plus `screenshotPath`. Handle all of them in this
   round: look at every screenshot (Read `screenshotPath`), find the code, fix, verify, commit,
   then `reply` or `resolve` each one (steps 4 to 8 of the workflow above). Only then start
   `watch` again.
4. **Exit 2** means not logged in: stop and ask the user, as everywhere else.

Rules for the loop:

- A squawk you only asked a question on stays open. `watch` does not return it again until a
  human answers (it looks at who wrote last), so asking is safe and does not loop.
- Several squawks about the same spot: fix them together in one change, then answer each one
  individually.
- Never run `watch` in a tight loop without handling its result; exit 0 always means work to do.
- Your replies through a CLI login show up in the inbox and overlay as "Agent for <Name>", not as
  the user, so reviewers can tell your answers from the user's own. Agent tokens
  (`SQUAWK_TOKEN`) show the token name instead.

## Rules

- Never resolve a squawk without a verified fix. A question or a "won't fix" proposal is a reply,
  not a resolve; leave the decision to the human.
- Keep replies short and concrete: what changed, where, which commit. No pleasantries.
- Always look at the screenshot before changing code.
- Token only from `SQUAWK_TOKEN` or the stored login. Never run `squawk token create`.
- Quote references in the shell: `'feat/login#3'` (`#` is special in zsh).
- If the CLI exits with 2, stop and ask the user to log in; do not retry in a loop.

## Cheat sheet

```bash
squawk whoami                                      # who am I, which server
squawk site-key                                    # site key from the git branch
squawk sites                                       # all sites with open/resolved counts
squawk list --site KEY --json                      # open squawks (add --all to page through)
squawk list --site KEY --status all                # including resolved
squawk show 'KEY#N' --json                         # thread, page, anchor, meta
squawk screenshot 'KEY#N' --out /tmp/squawk-N.png  # then Read the PNG
squawk reply 'KEY#N' "Fixed: ... (abc1234)"        # reply; or --file PATH, or - for stdin
squawk resolve 'KEY#N' --comment "Fixed: ... (abc1234)"  # reply and resolve in one go
squawk reopen 'KEY#N'                              # undo a resolve
squawk watch --site KEY --json --out /tmp/squawk   # wait for squawks; 0 = items, 3 = timeout
```

`#N` with `--site KEY` works everywhere a reference is expected: `squawk show '#3' --site KEY`.
Exit codes: 0 ok, 1 error, 2 not logged in, 3 `watch` timed out (start it again).
