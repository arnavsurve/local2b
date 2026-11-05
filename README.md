# local2b

Run heavy repo work on remote sandboxes instead of your laptop: typechecks, test suites, installs, dev servers. `l2b` is a small CLI for coding agents and humans, built on [e2b](https://e2b.dev).

    l2b run --repo my-org/my-repo --branch feature/x -- yarn test

That starts a box, checks out the branch with dependencies installed, runs the command, destroys the box, and hands you the exit code.

## Why not just the e2b CLI?

l2b uses the e2b SDK. It adds the parts you would otherwise script yourself:

- **Your credentials, never baked in.** Your `gh` token and any Doppler or env secrets are pushed to the box's tmpfs on each call. Images and snapshots never contain them.
- **Fast starts.** Bake a repo once. A box is then a branch switch plus an incremental install, about a minute instead of a clone and full install.
- **Cleanup you can't forget.** `run` always destroys its box, and idle boxes expire server-side.
- **Built for agents.** A skill says when to use it, commands default to the repo checkout, and every `run` ends with `command exited <code>`.

Limits: e2b is the only provider, you pay for the compute, and you re-bake when a repo drifts far from its snapshot.

## Quick start

You need [Bun](https://bun.sh), an `E2B_API_KEY`, and `gh` (or `GH_TOKEN`). Doppler is optional.

    bun install
    mkdir -p ~/.config/l2b && cp config.example.json ~/.config/l2b/config.json
    bun src/cli.ts install      # puts l2b on your PATH, links the agent skill
    l2b image build             # once
    l2b bake my-org/my-repo     # once per repo
    l2b run --repo my-org/my-repo --branch main -- yarn test

## Commands

- `run [--repo o/r] [--branch b] [--keep] -- <cmd...>`: one-shot. Create a box, run the command, destroy the box. Exit code passes through.
- `up <name> [--repo o/r] [--branch b] [--full] [--doppler p/c] [--image ref]`: create a box and check out a branch.
- `exec <name> [--cwd dir] -- <cmd...>`: run a command in a box. Defaults to the repo checkout.
- `shell <name>`: interactive terminal (needs a TTY).
- `down <name>`, `pause <name>`, `ls`: lifecycle.
- `url <name> <port>`: public URL for a port.
- `creds <name> [--repo o/r]`: re-push credentials.
- `bake <o/r> [--install cmd] [--warm cmd] [--branch b] [--if-older-than 12h]`: build the repo snapshot.
- `image build`: build the base image.
- `install`: put `l2b` on PATH and link the agent skill.

Use `run` for one-off work. Use `up`, `exec` and `down` when several commands need the same checkout, or you want a dev server behind a `url`.

## How it works

An **image** holds tooling only: Node, git, gh, Docker and whatever else you configure. `l2b image build` makes it once. A **snapshot** is a per-repo disk capture on top of that image, made by `l2b bake`: a shallow mirror, a checkout, installed dependencies, and any codegen from `warm`. A **box** is a sandbox started from the snapshot. `up` pushes credentials, switches the checkout to your branch, and runs `install` incrementally.

Boxes expire 15 minutes after the last l2b activity, and a heartbeat holds that off while a command runs. Push a branch to keep work.

## Credentials

Nothing secret goes into an image or snapshot. At call time, l2b resolves a git host token and your configured secrets locally and writes them to `/dev/shm/l2b.env` in the box (tmpfs, mode 600). Every `exec` sources that file. Bake deletes it before snapshotting, and snapshots are filesystem-only.

Anything the box runs can read those secrets, and a paused box keeps them in memory. Use a scoped `GH_TOKEN` rather than your full `gh` login if that matters to you.

Secret sources are `doppler` (`--doppler project/config` or `secrets` in config) or `env` (local variable names). Provider API keys use the same mechanism through a value reference such as `{ "from": "doppler", "project": "p", "config": "dev", "name": "E2B_API_KEY" }`.

## Config

`$L2B_CONFIG`, else `~/.config/l2b/config.json`. Every key has a default. See `config.example.json`.

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `"e2b"` | Sandbox provider |
| `image` | provider default | Base image override |
| `secrets` | `[]` | Sources pushed into every box: `{ "type": "doppler", "project", "config" }` or `{ "type": "env", "names": [...] }` |
| `gitHost` | `{ "type": "github" }` | See Git hosts |
| `idle.minutes` | `15` | Idle time before a box expires |
| `idle.action` | `"kill"` | `kill` discards the box; `pause` keeps disk and memory |
| `cloneDepth` | `50` | Commits kept in a baked mirror |
| `staleSnapshotHours` | `72` | `up` and `run` hint to re-bake past this age |
| `repos.<o/r>.baseBranch` | repo default | Branch the snapshot is baked from |
| `repos.<o/r>.install` | none | Runs on every `up`. Keep it incremental |
| `repos.<o/r>.warm` | none | Runs at bake only (codegen, builds). Output ships in the snapshot |
| `repos.<o/r>.env` | `{}` | Plain, non-secret variables set in every box for this repo |
| `repos.<o/r>.gitHost` | global | Per-repo override |
| `e2b.apiKey` | env `E2B_API_KEY` | Value reference: `env` or `doppler` |
| `e2b.cpuCount`, `e2b.memoryMB` | `4`, `8192` | Box size at image build |
| `e2b.features` | all | Image tooling: `node`, `gh`, `doppler`, `docker`, `postgres`, `redis`, `ripgrep`, `tmux`. `[]` for a lean image |
| `e2b.nodeMajor` | `24` | Node version for the `node` feature |
| `e2b.npmGlobals`, `e2b.aptPackages` | `[]` | Extra packages in the image |
| `e2b.imageCommands` | `[]` | Shell commands run as the box user at image build, for toolchains |

Image settings apply on the next `l2b image build`. `baseBranch` and `warm` apply on the next `l2b bake`.

## Git hosts

GitHub is the default and uses `GH_TOKEN` or `gh auth token`. GitLab (`{ "type": "gitlab", "baseUrl": "https://gitlab.com" }`) uses `GITLAB_TOKEN` or `glab auth token`. Bitbucket, Gitea and other https hosts use `generic`:

    { "type": "generic", "baseUrl": "https://bitbucket.org", "username": "x-token-auth",
      "token": { "from": "env", "name": "BITBUCKET_TOKEN" } }

## Keeping snapshots fresh

A stale snapshot makes `up` slower. `bake --if-older-than` skips the work when the snapshot is recent, so a scheduled job can call it often:

    0 3 * * * l2b bake my-org/my-repo --if-older-than 20h

l2b records bake times in `$XDG_STATE_HOME/l2b/bakes.json`. A snapshot baked elsewhere has no known age.

## Adding a provider

Implement `Provider` and `Box` from `src/providers/types.ts`, register it in `src/providers/index.ts`, and add its config block to `src/config.ts`. The e2b provider in `src/providers/e2b/` is the reference.

## Development

    bun run typecheck
    bun test

## License

MIT
