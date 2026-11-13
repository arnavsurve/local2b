---
name: l2b
description: Offload heavy dev work to a remote sandbox instead of this machine. Reach for it by default when a task in a large repo needs a full typecheck or lint, the full or integration test suite, a fresh dependency install, a dev server or browser QA run, a new worktree or clean checkout, or anything long-running or parallel that would hog local CPU, RAM, or disk. Skip it for reading code, small edits, and quick commands.
---

# l2b: remote dev sandboxes

`l2b` creates a sandbox ("box") with a repo checked out and credentials injected, runs commands in it, and cleans it up. Use it instead of local worktrees for heavy work.

Several sandbox providers may be configured. Do not pass `--provider` unless the user asks; the configured default and the name lookup handle it.

## Use it by default for heavy work

When the task is a typecheck, a test suite, an install, a build, or a dev server in a big repo, start a box straight away. You do not need a local checkout, a `git pull`, or a worktree first: `up` fetches and checks out the branch itself. Do not run `git pull` or `yarn install` in the user's own checkout to set up a run.

To test uncommitted local changes, commit and push a branch first, then `up` with that branch.

Run `l2b` from inside the local checkout when there is one: `--repo` and `--branch` default to its `origin` and current branch. l2b warns when that branch is not pushed or has unpushed commits, because the box fetches from the remote. Push, then run again.

## One-off work: `l2b run`

For "run the tests / typecheck / build and tell me the result", use one call:

    l2b run --repo <owner/repo> --branch <branch> -- <command...>

It creates a box, checks out the branch (running `setup` and `install` from `.l2b.json`), runs the command in the checkout, then destroys the box, even if the command fails or you interrupt it. The command's output streams back and its exit code is returned, so a non-zero exit means the command failed. The last stderr lines say `command exited <code>`, so the result is clear even if you pipe the output. Do not pipe `run` into `tail` and then trust `$?` (it reports `tail`'s status); read that line, or use `set -o pipefail`. Progress lines go to stderr. Expect about a minute of setup before the command starts.

- Use `-- bash -c '...'` for pipes, `&&` and redirects.
- Pass the trunk branch name the repo really uses; if unsure, check with `git ls-remote --heads origin`.
- Add `--keep` to leave the box up for follow-ups (it prints the box name).

## Project setup: `.l2b.json`

l2b does not guess how to set a project up. The nearest `.l2b.json` (the current directory, then each parent) says what to install. Without one, the box has a bare checkout and l2b prints `no .l2b.json found`.

When a project needs a toolchain or a dependency install, write or edit `.l2b.json` instead of installing things inside `run` or `exec` commands. Do not repeat `curl ... | sh` or `apt-get install` in every `run`: put it in `setup` once. A command that exits 127 (`command not found`) means `setup` is missing that tool.

- `l2b init` writes a starter file in the current directory (it fills in `repo` and `baseBranch` in a checkout). Edit it; do not overwrite one that exists.
- `setup`: commands run as the box user, with sudo, in the home directory, before the clone. They run at bake and when no bake exists. Put binaries on the default PATH (link them into `/usr/local/bin`); shell profile changes do not apply.
- `install`: runs in the checkout on every start. It must be safe to run again on an already installed checkout.
- `warm`: runs once at bake, after `install`.
- `env`: plain variables. `secrets`, `clone`, `provider`, `gitHost` and `baseBranch` are also accepted. Unknown keys are an error.
- Ask the user before committing `.l2b.json` to their repo; it can also live untracked in the checkout or a parent directory.
- After changing it, `up` and `run` print `project config changed since the bake`. Ask the user to run `l2b bake` (or run it if they agree).

Go:

    {
      "setup": [
        "curl -fsSL https://go.dev/dl/go1.24.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz",
        "sudo ln -sf /usr/local/go/bin/go /usr/local/go/bin/gofmt /usr/local/bin/"
      ],
      "install": "go mod download"
    }

Python with uv:

    {
      "setup": ["curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh"],
      "install": "uv venv --allow-existing && uv pip install -r requirements.txt"
    }

Rust:

    {
      "setup": [
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal",
        "sudo ln -sf $HOME/.cargo/bin/* /usr/local/bin/"
      ],
      "install": "cargo fetch"
    }

JavaScript: `"install": "bun install --frozen-lockfile"` (or `yarn install --immutable`, `pnpm install --frozen-lockfile`, `npm ci`), with no `setup` when the image already has the runtime.

## Writing files into a box

To write a file, use `l2b put <name> <local-path> <remote-path>` (or `-` to read stdin). Do not use heredocs inside `exec ... bash -c`; nested quotes, backticks and `$()` break. Relative remote paths resolve against the box workdir, parent dirs are created, and the exec bit is kept. Text files only.

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

## Long commands: `--detach`

A plain `exec` blocks until the command ends, so a long job (a full test suite) can hit your tool-call timeout. Start it detached instead:

    l2b exec <name> --detach -- yarn test      # prints a job id immediately
    l2b logs <name> <job>                      # output so far, then "running" or "exited N" on stderr
    l2b logs <name> <job> --follow             # stream until done; exits with the job's exit code
    l2b jobs <name>                            # all jobs and their status

Do not `sleep` and poll by hand. If `--follow` itself would exceed your timeout, call `logs` again. Calling `logs` or `jobs` also keeps the box from expiring.

## Getting your work out

Boxes are disposable. Commit and push a branch from inside the box when you are done:

    l2b exec <name> -- git push -u origin <branch>

Boxes already commit as you: `up` and `run` copy your local `git config --global` name and email (or `gitIdentity` from the l2b config). Never pass `-c user.name`/`-c user.email` or set a placeholder identity; commits from unknown emails block deploys.

Anything not pushed is lost when the box expires. Do not try to sync files back to the local machine; clone the pushed branch if you need it locally.

## Cleanup is automatic

`run` always cleans up after itself. Other boxes expire on their own after a period with no `l2b` activity (default 15 minutes), and every `exec` or `shell` holds that off while it runs. You do not need to remember to shut them down. Run `l2b down <name>` when you are finished to stop early and save cost. Background processes (dev servers) only survive while the box is alive: a box with no `l2b` calls against it will eventually expire, so call `l2b exec <name> -- true` to extend it. During long local work between calls, keep a box alive by running any cheap `l2b exec <name> -- true` before the idle window runs out, or use `l2b run` for one-shot commands so there is no box to keep.

## Secrets

Credentials (a GitHub token and any configured secrets) are written to the box's tmpfs and sourced by every `exec`. Never paste secrets into commands or commit them. If a command fails with an auth error after a long idle, run `l2b creds <name>` to refresh them.

## Interactive use

`l2b shell <name>` opens a terminal, but needs a real TTY. Agents should use `exec`.

## Not found?

If `l2b` is not on the PATH, install it:

    curl -fsSL https://raw.githubusercontent.com/arnavsurve/local2b/main/install.sh | sh

It installs to `~/.local/bin`. If that directory is not on the PATH, call `~/.local/bin/l2b` directly.

## Troubleshooting

- `box "<name>" expired: ...`: the box idled out between `l2b` calls. Run the `l2b up` command the message prints.
- `no sandbox named ...`: l2b has no record of starting that box here, so it was never created or was started elsewhere. Run `l2b ls`, then `l2b up` if it is missing.
- `up` falls back to a slow shallow clone when no baked snapshot exists for the repo. Ask the user to run `l2b bake <owner/repo>` once.
- `command exited 127` or `not found`: the tool is missing in the box. Add it to `setup` in `.l2b.json`.
- `<path>/.l2b.json is for o/x, not o/y`: the nearest `.l2b.json` names another repo. Run from the right directory or pass the right `--repo`.
