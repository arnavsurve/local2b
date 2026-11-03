# local2b

Run dev work (worktrees, dev servers, test suites) on remote sandboxes instead of your laptop. `l2b` is a small CLI that local coding agents (pi, Claude Code, Codex, ...) or you can call to spin up compute, run commands in it, and tear it down.

Providers are pluggable; [e2b](https://e2b.dev) is the first one.

## Quick start

    bun install
    cp config.example.json ~/.config/l2b/config.json   # edit to taste
    bun src/cli.ts image build                          # once: build the base image
    bun src/cli.ts bake my-org/my-repo                  # once per repo: mirror + warm install
    bun src/cli.ts up task1 --repo my-org/my-repo --branch feature/x
    bun src/cli.ts exec task1 --cwd /home/user/work/feature-x -- yarn test
    bun src/cli.ts url task1 3000
    bun src/cli.ts down task1

Link `src/cli.ts` onto your PATH as `l2b` for convenience. Requires [Bun](https://bun.sh), and `gh` for GitHub auth (or `GH_TOKEN`). Doppler is optional.

## Commands

| Command | What it does |
| --- | --- |
| `up <name> [--repo o/r] [--branch b] [--full] [--doppler p/c] [--image ref]` | Create a sandbox, push credentials, check out a branch |
| `bake <o/r> [--install cmd]` | Build a per-repo snapshot: bare partial mirror plus a warm install |
| `exec <name> [--cwd dir] -- <cmd...>` | Run a command with secrets in its environment |
| `creds <name>` | Re-push credentials |
| `url <name> <port>` | Public URL for a port |
| `ls`, `pause <name>`, `down <name>` | Lifecycle |
| `image build` | Build the provider's base image |

`up` uses the repo's snapshot when one exists: a branch switch in the baked checkout plus an incremental install, so a box is ready in about a minute. Without one it falls back to a shallow partial clone. `--full` forces a full clone.

## Credentials

Nothing secret is ever baked into an image or snapshot. At call time, `l2b` resolves a GitHub token (`GH_TOKEN`, or `gh auth token`) plus any configured secret sources locally, and writes them to the sandbox's tmpfs (`/dev/shm/l2b.env`, mode 600), which every `exec` sources. Snapshots are filesystem-only and the file is removed before snapshotting. A paused sandbox still holds its memory, so treat it as holding secrets.

Secret sources (`secrets` in config, or `--doppler project/config`): `doppler`, or `env` (a list of local env var names). Provider API keys use the same mechanism via a value reference, e.g. `{ "from": "doppler", ... }` or `{ "from": "env", "name": "E2B_API_KEY" }`.

## Config

`$L2B_CONFIG`, else `$XDG_CONFIG_HOME/l2b/config.json` (default `~/.config/l2b/config.json`). See `config.example.json`. Every field has a default, so a missing file works if `E2B_API_KEY` is set.

## Adding a provider

Implement `Provider` and `Box` from `src/providers/types.ts`, register it in `src/providers/index.ts`, and add its config block to `src/config.ts`. Commands only talk to those interfaces; the e2b implementation in `src/providers/e2b/` is the reference.

## Development

    bun run typecheck
    bun test

The git scripts and credential file are tested against real local git repos and a real shell.

## License

MIT
