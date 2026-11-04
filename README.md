# local2b

`l2b` is a thin, opinionated layer that lets coding agents (pi, Claude Code, Codex, ...) and humans run heavy repo work on remote sandboxes: full typechecks, test suites, dependency installs, dev servers. It adds sane defaults and guardrails, and it reuses the setup you already have locally (your `gh` login, Doppler or env secrets, a local config file) instead of making you rebuild it in the cloud.

It is a workflow layer, not a new sandbox. Providers are pluggable; [e2b](https://e2b.dev) is the only one so far.

## Why not just use the e2b CLI or SDK?

You can, and l2b is built on the e2b SDK. What l2b adds is the part every team ends up scripting around it:

1. **Credentials stay local.** A GitHub token (`GH_TOKEN` or `gh auth token`) and any Doppler or env secrets are resolved on your machine at call time and written to the sandbox's tmpfs. They are never baked into an image or snapshot, and snapshots are filesystem-only.
2. **Repo-aware fast start.** Bake a repo once (shallow partial mirror, installed dependencies, optional codegen). After that a box is a branch switch plus an incremental install, roughly 30-60 seconds, instead of minutes for a clone and full install.
3. **One-call lifecycle.** `l2b run --repo o/r --branch b -- <cmd>` creates a box, runs the command, and always destroys the box, even on failure or interrupt. The command's exit code passes through and progress goes to stderr.
4. **Implicit cleanup.** Idle expiry is enforced server-side by the provider, and a heartbeat holds it off only while a command is running, so an agent that forgets (or crashes) cannot leak a box.
5. **Agent ergonomics.** A bundled skill tells agents when to reach for l2b, `exec` defaults to the repo checkout, and every `run` ends with an unambiguous `command exited <code>` line.
6. **Provider-agnostic interfaces.** Commands talk to small `Provider` and `Box` interfaces, so another backend does not change the workflow.

| | l2b | raw e2b CLI / SDK |
| --- | --- | --- |
| Secrets | Pushed from your machine to tmpfs per call; never in images or snapshots | You decide, and wire it yourself |
| GitHub access | Your `gh` token, with git credential helper configured | Set up auth in every sandbox |
| Repo start | Baked snapshot: branch switch + incremental install | Clone and install each time, or build your own templates |
| One-off command | `l2b run`: create, run, always destroy, exit code passes through | Script create / run / kill with your own error handling |
| Leaked boxes | Server-side idle expiry plus a heartbeat during commands | Your timeout choices and your cleanup code |
| Agent use | Skill, default cwd, `command exited <code>` line | Not provided |
| Other providers | Same commands via the `Provider` interface | Tied to e2b |

## Limits

- A workflow layer over a sandbox provider, not a sandbox itself.
- e2b is the only provider today.
- GitHub is the only supported git host.
- It spends real e2b compute and money; boxes are billed while they run.
- Baking is manual: re-run `l2b bake` when a repo's dependencies drift far from the snapshot.
- Boxes are disposable. Push a branch to keep work.

## How it works

Three layers. An **image** holds tooling only (Node, git, gh, Doppler, Docker, Postgres, Redis, plus your configured extras); it holds no repo and no credentials, and is built once with `l2b image build`. A **snapshot** is a per-repo, filesystem-only capture on top of that image, made by `l2b bake`: a bare partial mirror, a checkout, installed dependencies and any `warm` step output, with credentials scrubbed first. A **box** is a running sandbox started from the snapshot (or from the plain image when no snapshot exists). `up` writes credentials to the box's tmpfs, switches the checkout to your branch, and runs your `install` command incrementally. When the box is done it is destroyed or expires.

## Quick start

    bun install
    cp config.example.json ~/.config/l2b/config.json   # edit to taste
    bun src/cli.ts image build                          # once: build the base image
    bun src/cli.ts bake my-org/my-repo                  # once per repo: mirror + warm install
    bun src/cli.ts run --repo my-org/my-repo --branch feature/x -- yarn test   # one-shot
    bun src/cli.ts up task1 --repo my-org/my-repo --branch feature/x           # or a session
    bun src/cli.ts exec task1 -- yarn test
    bun src/cli.ts url task1 3000
    bun src/cli.ts down task1

Run `bun src/cli.ts install` to put `l2b` on your PATH (`~/.local/bin`) and link the agent skill into `~/.agents/skills` and `~/.claude/skills`. Requires [Bun](https://bun.sh), and `gh` for GitHub auth (or `GH_TOKEN`). Doppler is optional.

## `run` or `up`/`exec`/`down`

Use `run` for one-off work: "run the tests, typecheck, or build and tell me the result". It cleans up after itself and returns the command's exit code. Add `--keep` to leave the box up for follow-ups.

Use `up`, `exec`, `down` when several commands need the same checkout: debugging, editing, a dev server you want a public `url` for. The box then lives until you `down` it or it goes idle.

## Commands

| Command | What it does |
| --- | --- |
| `run [--repo o/r] [--branch b] [--keep] -- <cmd...>` | One-shot: create a box, run the command in the checkout, always destroy it; exit code passes through |
| `up <name> [--repo o/r] [--branch b] [--full] [--doppler p/c] [--image ref]` | Create a sandbox, push credentials, check out a branch |
| `bake <o/r> [--install cmd] [--warm cmd] [--branch b]` | Build a per-repo snapshot: bare partial mirror plus a warm install |
| `exec <name> [--cwd dir] -- <cmd...>` | Run a command with secrets in its environment; defaults to the repo checkout |
| `shell <name>` | Interactive terminal (needs a TTY) |
| `install` | Put `l2b` on PATH and link the agent skill |
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

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `"e2b"` | Sandbox provider |
| `image` | provider default | Override the base image |
| `secrets` | `[]` | Sources pushed into every box: `{ "type": "doppler", "project", "config" }` or `{ "type": "env", "names": [...] }` |
| `idle.minutes` | `15` | Box expires this long after the last l2b activity |
| `idle.action` | `"kill"` | `kill` discards the box; `pause` keeps disk and memory (and secrets) |
| `cloneDepth` | `50` | Commits of history kept in a baked mirror |
| `repos.<o/r>.baseBranch` | repo default branch | Branch the snapshot is baked from |
| `repos.<o/r>.install` | none | Runs in the checkout on every `up`; keep it fast and incremental |
| `repos.<o/r>.warm` | none | One-time work at bake only (codegen, builds); output ships in the snapshot |
| `repos.<o/r>.env` | `{}` | Plain variables set in every box for this repo (not secret; survive `creds` refresh) |
| `e2b.apiKey` | `{ "from": "env", "name": "E2B_API_KEY" }` | Value reference: `env` or `doppler` |
| `e2b.cpuCount` | `4` | vCPUs at image build |
| `e2b.memoryMB` | `8192` | Memory at image build |
| `e2b.npmGlobals` | `[]` | npm packages installed globally in the image |
| `e2b.aptPackages` | `[]` | Extra apt packages in the image |
| `e2b.imageCommands` | `[]` | Shell commands run as the box user at image build, e.g. to install a toolchain |

Image settings (`e2b.*`) take effect on the next `l2b image build`; per-repo `warm` and `baseBranch` on the next `l2b bake`.

## Roadmap

Planned, not yet available: a provider home-directory setting, configurable image features, non-GitHub git hosts, and `bake --if-older-than`.

## Adding a provider

Implement `Provider` and `Box` from `src/providers/types.ts`, register it in `src/providers/index.ts`, and add its config block to `src/config.ts`. Commands only talk to those interfaces; the e2b implementation in `src/providers/e2b/` is the reference.

## Development

    bun run typecheck
    bun test

The git scripts and credential file are tested against real local git repos and a real shell.

## License

MIT
