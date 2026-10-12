# Squawk for coding agents

This is the workflow an agent follows to work through reviewer comments ("squawks") on a preview
build. It is the same workflow as the Claude Code skill in
[`skills/squawk/SKILL.md`](../skills/squawk/SKILL.md); agents without skill support can take this
page as instructions. Setting Squawk up is a different job, described in [AGENTS.md](../AGENTS.md).

## The model

Reviewers click an element on a preview and leave a comment. Each comment thread is a _squawk_,
numbered per site: `feature/settings#3`. The site key is normally the branch name, so the agent on
a branch finds its squawks with `squawk site-key`. A squawk carries everything needed to act on it:
the text, a screenshot, the page, the URL, the viewport, the build ref the reviewer saw (`meta.ref`)
and an anchor with selectors for the pinned element (`testId`, `css`, `xpath`, a text quote) and
its box on the screenshot (`elementBox`, in viewport pixels).

## Prerequisites

- `squawk --version` works (installation: [AGENTS.md](../AGENTS.md#cli)).
- `squawk whoami` shows the user. The agent uses the user's `squawk login` or `SQUAWK_SERVER` plus
  `SQUAWK_TOKEN` from the environment. It never creates tokens itself and never prints or commits
  one.
- Exit codes: `0` ok, `1` error, `2` not logged in or token rejected (stop and ask the user),
  `3` `watch` timed out.

## Working through squawks once

1. **Site key.** `squawk site-key` in the repository. If the user named another site, or
   `squawk sites` shows no squawks for the branch, ask which site is meant.
2. **List.** `squawk list --site KEY --json`, plus `--all` when `nextCursor` is not null. Handle
   the open squawks one at a time, oldest first.
3. **Claim.** `squawk work 'KEY#N'`. Reviewers now see in the overlay and the inbox that an agent
   is on it.
4. **Read.** `squawk show 'KEY#N' --json` for the thread, page, `meta` and `anchor`;
   `squawk screenshot 'KEY#N' --out /tmp/squawk-N.png` and look at the image. The text alone is
   often ambiguous. To find the element on the image, multiply `anchor.elementBox` by
   `screenshot.devicePixelRatio`.
5. **Find the code.** Search for the `testId` first, then distinctive parts of the CSS selector,
   then the quoted text in components and translation files. Compare `meta.ref` with the history:
   if the reviewer saw an older build, the issue may already be fixed.
6. **Fix and verify** the way the project normally does, and commit.
7. **Answer.** `squawk resolve 'KEY#N' --comment "What was wrong, what changed (abc1234)."` when
   the fix is verified. `--comment` is posted first; the squawk is only resolved if that worked.
   When the request is unclear, or the right answer is "won't fix", reply instead and leave it
   open: `squawk reply 'KEY#N' "One concrete question?"`.

Quote references in the shell: `'feature/settings#3'` (`#` starts a comment in some shells).
`#N` together with `--site KEY` works everywhere a reference is expected.

## Waiting for squawks: `squawk watch`

When the user wants the agent to stay on a preview and handle squawks as they come in, the agent
loops on `watch` instead of polling `list`:

```bash
squawk watch --site KEY --json --out /tmp/squawk > /tmp/squawk-next.json
```

`watch` polls the site every 10 seconds (`--interval`) and returns as soon as at least one open
squawk needs attention: its newest comment was not written by the caller as an agent. That is a
new squawk, or a human answered in an existing thread. It then fetches all such squawks with their
threads, saves the screenshots to `--out` as `<site>-<n>.png`, prints one JSON document
`{ site, checkedAt, me, items: [ { ...squawk with comments, screenshotPath } ] }` and exits.

- **Exit 0:** `items` holds every squawk that needs attention right now. Handle all of them (steps
  4 to 7 above), then start `watch` again.
- **Exit 3:** nothing arrived within `--timeout` (default 540 seconds). Start `watch` again right
  away.
- **Exit 2:** not logged in. Stop and ask the user.

In Claude Code, run `watch` with the Bash tool in the background (`run_in_background: true`,
timeout at least 600000 ms); its exit wakes the agent.

`watch` claims every squawk it returns, so reviewers see the "working" chip immediately.
`--no-claim` turns that off. A squawk the agent does not handle in this round (out of scope, needs
the user first) is released right away with `squawk work 'KEY#N' --done`.

Rules for the loop:

- A squawk the agent only asked a question on stays open, but `watch` does not return it again
  until a human answers. Asking is safe and does not loop.
- Several squawks about the same spot are fixed in one change and answered individually.
- Exit 0 always means work to do. Never restart `watch` without handling its result.
- Before stopping, release every claimed squawk that got no reply or resolve.

## Authorship

The server records who wrote what, and every client shows it:

- **Through a CLI login** (`squawk login`), the agent writes on the user's behalf. Replies,
  resolves and claims are stored with the user and the CLI token. The overlay and the inbox show
  them as **"Agent · for Moritz"**, the CLI as `Agent for Moritz`. Never as the user.
- **Through an agent token** (`SQUAWK_TOKEN` created on the inbox's Tokens page), the agent writes
  as itself, shown with the token's name, e.g. `Claude feature/settings (agent)` in the CLI.
- **The overlay and the inbox** write as the user.

## Work claims

A claim says "an agent is on this". It is set by `squawk work` and by `watch`, and only agent
tokens and CLI logins can set it. Reviewers see a "working" chip with the duration in the overlay
list, at the pin and in the inbox. A reply, resolve or reopen by the same agent clears it;
`squawk work 'KEY#N' --done` clears it explicitly, and anyone can clear it from the inbox. A claim
by another agent is replaced.

## Drafts

Reviewers can collect squawks as a review: **Add to review** creates a draft, **Submit review (N)**
publishes all of them at once. Drafts are visible only to their author. Agents, `list`, `watch`
and other users never see them, so an agent always gets a finished review in one `watch` round
instead of half-written comments.

## Unread

Unread state is per user. A squawk is unread for a user when there is activity they have not seen:
a new squawk, or a reply by someone else. Replies by the user's own agent count as unread for the
user, so "the agent answered" shows up as a dot in the overlay and in the inbox. Opening the
thread marks it read; `u` in the overlay marks it unread again. `squawk list` shows `•` before
unread squawks for CLI logins; for agent tokens nothing is ever unread.

## What reviewers see

The reviewer on the preview sees the agent's work without leaving the page: the "working" chip
while the agent is on a squawk, the reply with its commit SHA as an unread dot, and the squawk
moving to Resolved. To send it back, they reopen it and write what is still wrong: that comment
wakes `watch` again, because a human wrote last. A reopen without a comment does not.

## Cheat sheet

```bash
squawk whoami                                      # who am I, which server
squawk site-key                                    # site key from the git branch
squawk sites                                       # all sites with open/resolved counts
squawk list --site KEY --json                      # open squawks (add --all to page through)
squawk list --site KEY --status all                # including resolved
squawk show 'KEY#N' --json                         # thread, page, anchor, meta
squawk screenshot 'KEY#N' --out /tmp/squawk-N.png  # then look at the PNG
squawk reply 'KEY#N' "Fixed: ... (abc1234)"        # reply; or --file PATH, or - for stdin
squawk resolve 'KEY#N' --comment "Fixed: ... (abc1234)"  # reply and resolve in one go
squawk reopen 'KEY#N'                              # undo a resolve
squawk work 'KEY#N' ['KEY#M' ...]                  # claim
squawk work 'KEY#N' --done                         # release without replying
squawk watch --site KEY --json --out /tmp/squawk   # wait, claim, return; 0 = items, 3 = timeout
```
