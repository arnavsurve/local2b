---
name: l2b
description: Offload heavy dev work to a remote sandbox instead of this machine. Reach for it by default when a task in a large repo needs a full typecheck or lint, the full or integration test suite, a fresh dependency install, a dev server or browser QA run, a new worktree or clean checkout, or anything long-running or parallel that would hog local CPU, RAM, or disk. Skip it for reading code, small edits, and quick commands.
---

# l2b: remote dev sandboxes

`l2b` creates a sandbox ("box") with a repo checked out and credentials injected, runs commands in it, and cleans it up. Use it instead of local worktrees for heavy work.

## Use it by default for heavy work

When the task is a typecheck, a test suite, an install, a build, or a dev server in a big repo, start a box straight away. You do not need a local checkout, a `git pull`, or a worktree first: `up` fetches and checks out the branch itself. Do not run `git pull` or `yarn install` in the user's own checkout to set up a run.

To test uncommitted local changes, commit and push a branch first, then `up` with that branch.

## One-off work: `l2b run`

For "run the tests / typecheck / build and tell me the result", use one call:

    l2b run --repo <owner/repo> --branch <branch> -- <command...>

It creates a box, checks out the branch (dependencies installed), runs the command in the checkout, then destroys the box, even if the command fails or you interrupt it. The command's output streams back and its exit code is returned, so a non-zero exit means the command failed. Progress lines go to stderr. Expect about a minute of setup before the command starts.

- Use `-- bash -c '...'` for pipes, `&&` and redirects.
- Pass the trunk branch name the repo really uses; if unsure, check with `git ls-remote --heads origin`.
- Add `--keep` to leave the box up for follow-ups (it prints the box name).

## Multi-step sessions: `up`, `exec`, `down`

Use these when you need several commands against the same checkout (debugging, editing, a dev server).

    l2b up <name> --repo <owner/repo> --branch <branch>   # about a minute; progress prints to stderr
    l2b exec <name> -- <cmd...>                            # runs in the repo checkout by default
    l2b url <name> <port>                                  # public URL for a dev server
    l2b ls                                                 # what is running
    l2b down <name>                                        # stop early

- Pick a short unique `<name>`, e.g. the task slug. If one exists, `exec` into it instead of creating another.
- `up` takes up to a couple of minutes: give the command a generous timeout, or run it in the background. Do not run it twice.
- A `--branch` that does not exist on the remote is created from the default branch.
- The repo is checked out at `/home/user/<repo>`; `exec` runs there unless you pass `--cwd`.

## Getting your work out

Boxes are disposable. Commit and push a branch from inside the box when you are done:

    l2b exec <name> -- git push -u origin <branch>

Anything not pushed is lost when the box expires. Do not try to sync files back to the local machine; clone the pushed branch if you need it locally.

## Cleanup is automatic

`run` always cleans up after itself. Other boxes expire on their own after a period with no `l2b` activity (default 15 minutes), and every `exec` or `shell` holds that off while it runs. You do not need to remember to shut them down. Run `l2b down <name>` when you are finished to stop early and save cost. Background processes (dev servers) only survive while the box is alive: a box with no `l2b` calls against it will eventually expire, so call `l2b exec <name> -- true` to extend it.

## Secrets

Credentials (a GitHub token and any configured secrets) are written to the box's tmpfs and sourced by every `exec`. Never paste secrets into commands or commit them. If a command fails with an auth error after a long idle, run `l2b creds <name>` to refresh them.

## Interactive use

`l2b shell <name>` opens a terminal, but needs a real TTY. Agents should use `exec`.

## Not found?

If `l2b` is not on the PATH, run `bun <path-to-local2b>/src/cli.ts install` once.

## Troubleshooting

- `no sandbox named ...`: it expired or was never created. Run `l2b ls`, then `l2b up` again.
- `up` falls back to a slow shallow clone when no baked snapshot exists for the repo. Ask the user to run `l2b bake <owner/repo>` once.
