---
name: l2b
description: Run heavy dev work (installs, typechecks, test suites, dev servers, long agent tasks) on a remote sandbox instead of the local machine. Use when a task needs lots of CPU, RAM, or disk, when you want a clean isolated checkout of a repo, or when the user mentions l2b, remote sandboxes, or offloading work.
---

# l2b: remote dev sandboxes

`l2b` creates a sandbox ("box") with a repo checked out and credentials injected, runs commands in it, and cleans it up. Use it instead of local worktrees for heavy work.

## Workflow

    l2b up <name> --repo <owner/repo> --branch <branch>   # about a minute; progress prints to stderr
    l2b exec <name> -- <cmd...>                            # runs in the repo checkout by default
    l2b url <name> <port>                                  # public URL for a dev server
    l2b ls                                                 # what is running
    l2b down <name>                                        # stop early

- Pick a short unique `<name>`, e.g. the task slug. Names are unique among live boxes; if one exists, `exec` into it instead of creating another.
- `up` takes up to a couple of minutes: give the command a generous timeout, or run it in the background and wait for it. Do not run it twice.
- A `--branch` that does not exist on the remote is created from the default branch.
- The repo is checked out at `/home/user/<repo>` with dependencies installed. `exec` runs there unless you pass `--cwd`.
- `exec` streams output and returns the remote command's exit code. Put the command after `--`; use `-- bash -c '...'` for pipes and `&&`.

## Getting your work out

Boxes are disposable. Commit and push a branch from inside the box when you are done:

    l2b exec <name> -- git push -u origin <branch>

Anything not pushed is lost when the box expires. Do not try to sync files back to the local machine; clone the pushed branch if you need it locally.

## Cleanup is automatic

Boxes expire on their own after a period with no `l2b` activity (default 15 minutes), and every `exec` or `shell` holds that off while it runs. You do not need to remember to shut them down. Run `l2b down <name>` when you are finished to stop early and save cost. Background processes (dev servers) only survive while the box is alive: a box with no `l2b` calls against it will eventually expire, so call `l2b exec <name> -- true` to extend it.

## Secrets

Credentials (a GitHub token and any configured secrets) are written to the box's tmpfs and sourced by every `exec`. Never paste secrets into commands or commit them. If a command fails with an auth error after a long idle, run `l2b creds <name>` to refresh them.

## Interactive use

`l2b shell <name>` opens a terminal, but needs a real TTY. Agents should use `exec`.

## Not found?

If `l2b` is not on the PATH, run `bun <path-to-local2b>/src/cli.ts install` once.

## Troubleshooting

- `no sandbox named ...`: it expired or was never created. Run `l2b ls`, then `l2b up` again.
- `up` falls back to a slow shallow clone when no baked snapshot exists for the repo. Ask the user to run `l2b bake <owner/repo>` once.
