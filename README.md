# local2b

<img width="3888" height="1784" alt="sebastian-schuster-dkKgXnqFkjE-unsplash" src="https://github.com/user-attachments/assets/b3979a53-dc14-4f96-ab0e-8833d9137ccb" />


Run heavy repo work on remote sandboxes instead of your laptop: typechecks, test suites, installs, dev servers. For coding agents and people.

    l2b run --repo my-org/my-repo --branch feature/x -- yarn test

That starts a box, checks out the branch with dependencies installed, runs the command, destroys the box, and hands you the exit code.

## What it does

- Pushes your `gh` token and configured secrets to the box's tmpfs on each call. Images and snapshots never contain them.
- Bakes a repo once, so a box starts as a branch switch plus an incremental install.
- Destroys the box after `run`, and expires idle boxes on the provider's side.
- Ships an agent skill. Commands default to the repo checkout, and `run` ends with `command exited <code>`.

## Install

    curl -fsSL https://raw.githubusercontent.com/arnavsurve/local2b/main/install.sh | sh

The script downloads the latest release binary for macOS or Linux on arm64 or x64, checks it against the release's `SHA256SUMS`, and installs it to `~/.local/bin/l2b`. It then runs `l2b install`, which writes the agent skill to `~/.agents/skills/l2b` and `~/.claude/skills/l2b`.

- `L2B_INSTALL_DIR=/some/dir` installs the binary elsewhere.
- `L2B_VERSION=0.2.0` installs that release instead of the latest.
- `l2b update` replaces the binary with the latest release and refreshes the skill.
- `l2b --version` prints the installed version.

To uninstall, delete the binary and the skill directories:

    rm ~/.local/bin/l2b
    rm -rf ~/.agents/skills/l2b ~/.claude/skills/l2b

From a checkout, `bun install` then `bun src/cli.ts install` links `~/.local/bin/l2b` to the checkout and links the skill. A checkout updates with `git pull`.

## Quick start

You need an API key for your provider and `gh` (or `GH_TOKEN`). A secret source is optional.

    mkdir -p ~/.config/l2b
    curl -fsSL https://raw.githubusercontent.com/arnavsurve/local2b/main/config.example.json -o ~/.config/l2b/config.json
    l2b image build             # once
    l2b bake my-org/my-repo     # once per repo
    l2b run --repo my-org/my-repo --branch main -- yarn test

## Commands

- `run [--repo o/r] [--branch b] [--keep] -- <cmd...>`: one-shot. Create a box, run the command, destroy the box. Exit code passes through.
- `up <name> [--repo o/r] [--branch b] [--full] [--doppler p/c] [--image ref]`: create a box and check out a branch.
- `exec <name> [--cwd dir] [--detach] -- <cmd...>`: run a command in a box. Defaults to the repo checkout. With `--detach` the command starts in the background and `exec` prints a job id at once.
- `logs <name> <job> [--follow]`: print a detached job's output and its status (`running` or `exited N`). With `--follow` it streams until the job ends and exits with the job's exit code.
- `jobs <name>`: list a box's detached jobs with their status.
- `put <name> <local-path|-> <remote-path>`: send a text file into a box. Relative remote paths resolve against the box workdir. Parent directories are created and the exec bit is kept. `-` reads stdin. Use it instead of heredocs inside `exec`. Binary files are rejected.
- `shell <name>`: interactive terminal (needs a TTY).
- `down <name>`, `pause <name>`, `ls`: lifecycle.
- `url <name> <port>`: public URL for a port.
- `creds <name> [--repo o/r]`: re-push credentials.
- `bake <o/r> [--install cmd] [--warm cmd] [--branch b] [--if-older-than 12h]`: build the repo snapshot.
- `image build`: build the base image.
- `update`: replace the binary with the latest release and refresh the skill.
- `install`: install the agent skill into `~/.agents/skills/l2b` and `~/.claude/skills/l2b`. From a checkout it links the skill and puts `l2b` on PATH; a released binary writes the skill files.

Use `run` for one-off work. Use `up`, `exec` and `down` when several commands need the same checkout, or you want a dev server behind a `url`.

Detached jobs suit long commands such as full test suites, which would otherwise hit a tool-call timeout. Output and exit status are kept in `~/.l2b-jobs/<job>/` in the box (`log`, `status`). A job does not hold off box expiry by itself, so run `logs` or `jobs` now and then while it runs.

## How it works

Each provider runs this workflow with its own primitives. The description below is the shared toolkit's snapshot-and-mirror workflow, which e2b uses.

An **image** holds tooling only: git, gh, a language runtime and whatever else you configure. `l2b image build` makes it once. A **snapshot** is a per-repo disk capture on top of that image, made by `l2b bake`: a shallow mirror, a checkout, installed dependencies, and any codegen from `warm`. A **box** is a sandbox started from the snapshot. `up` pushes credentials, switches the checkout to your branch, and runs `install` incrementally.

Boxes expire 15 minutes after the last l2b activity, with no local process needed; each provider documents how it guarantees that. Push a branch to keep work.

## Credentials

Nothing secret goes into an image or snapshot. At call time, l2b resolves a git host token and your configured secrets locally and writes them to `/dev/shm/l2b.env` in the box (tmpfs, mode 600). Every `exec` sources that file. Bake deletes it before snapshotting, and snapshots are filesystem-only.

Anything the box runs can read those secrets, and a paused box keeps them in memory. Prefer a scoped `GH_TOKEN` over your full `gh` login.

## Secret sources

`secrets` in config is a list of sources. Each yields variables that go into every box.

- `env`: named local variables. `{ "type": "env", "names": ["A", "B"] }`
- `file`: a local dotenv or JSON file. `{ "type": "file", "path": "~/.secrets.env", "format": "dotenv" }`
- `command`: runs a program and parses stdout. `{ "type": "command", "argv": ["..."], "format": "json" }`
- `doppler`: `{ "type": "doppler", "project", "config" }`, or `--doppler project/config`. A preset over `command`.

`format` is `json` (a flat object of string values) or `dotenv`. `command` takes `argv` as a list and runs it without a shell; write `["sh", "-c", "..."]` if you need one. It inherits your environment, so your credential CLI keeps its login. `timeoutMs` defaults to `30000`; the process is killed past it. Errors show the program, exit code and stderr, never its output.

Any command that prints JSON or dotenv works. Examples:

- 1Password: `["op", "inject", "-i", "template.env"]` as `dotenv`
- Vault: `["vault", "kv", "get", "-format=json", "-field=data", "secret/app"]` as `json`
- AWS Secrets Manager: `["aws", "secretsmanager", "get-secret-value", "--secret-id", "X", "--query", "SecretString", "--output", "text"]` as `json`

A single value, such as a provider API key or a git host token, uses a value reference:

- `{ "from": "env", "name": "E2B_API_KEY" }`
- `{ "from": "file", "path": "~/.e2b-key" }`
- `{ "from": "command", "argv": ["op", "read", "op://vault/item/field"] }`
- `{ "from": "command", "argv": ["security", "find-generic-password", "-s", "NAME", "-w"] }` (macOS Keychain)
- `{ "from": "doppler", "project": "p", "config": "dev", "name": "E2B_API_KEY" }`
- `{ "from": "firstOf", "refs": [ref, ...] }` (the first ref that resolves to a non-empty value; if none does, the error lists what failed, never values)

A command reference trims one trailing newline and fails on empty output. Tools such as `pass show NAME` and `bw get password NAME` print a single value and fit the same form.

## Config

`$L2B_CONFIG`, else `~/.config/l2b/config.json`. Every key has a default. See `config.example.json`.

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | `"e2b"` | Default sandbox provider (`e2b` or `boat`). See Providers |
| `image` | provider default | Base image override |
| `secrets` | `[]` | Sources pushed into every box. See Secret sources |
| `gitHost` | `{ "type": "github" }` | See Git hosts |
| `gitIdentity` | local `git config --global` | `{ "name": "...", "email": "..." }` set as the global git author in every box by `up` and `run`. Skipped when neither this nor the local values are set |
| `idle.minutes` | `15` | Idle time before a box expires |
| `idle.action` | `"kill"` | Deprecated alias for the provider's own idle setting, such as `e2b.onIdle` |
| `clone.strategy` | `"mirror"` | `mirror`: bare mirror plus a worktree checkout. `plain`: an ordinary clone |
| `clone.depth` | `50` | Commits of history kept; `null` for full history |
| `clone.filter` | `"blob:limit=50m"` | Git partial-clone filter, e.g. `blob:none`; `null` for none |
| `cloneDepth` | none | Kept for compatibility; the global default for `clone.depth`. Prefer `clone.depth` |
| `staleSnapshotHours` | `72` | `up` and `run` hint to re-bake past this age |
| `repos.<o/r>.baseBranch` | repo default | Branch the snapshot is baked from |
| `repos.<o/r>.install` | detected from lockfile | Runs on every `up` and at bake. Keep it incremental. `""` runs nothing |
| `repos.<o/r>.warm` | none | Runs at bake only (codegen, builds). Output ships in the snapshot |
| `repos.<o/r>.env` | `{}` | Plain, non-secret variables set in every box for this repo |
| `repos.<o/r>.gitHost` | global | Per-repo override |
| `repos.<o/r>.provider` | global `provider` | Provider used for this repo |
| `repos.<o/r>.clone` | global | Per-repo override of `strategy`, `depth` and `filter`. Unset fields inherit |

`baseBranch`, `warm` and `clone` apply on the next `l2b bake`, which prints the strategy it used. `up` follows what the snapshot contains: it uses a baked mirror if one exists and otherwise fetches in place, so changing the strategy never breaks an existing snapshot. `--full` on `up` or `run` clones without a snapshot at full depth and keeps the filter.

Use `plain` for small repos. A mirror pays off when the repo is large and boxes switch branches often; for a small repo it adds a second copy and nothing else.

### Install detection

When `install` is not set, `l2b` looks at the checkout root and picks a command: `bun.lock` or `bun.lockb` runs `bun install --frozen-lockfile`, `pnpm-lock.yaml` runs `pnpm install --frozen-lockfile`, `yarn.lock` runs `yarn install --immutable` (with `.yarnrc.yml`) or `yarn install --frozen-lockfile`, `package-lock.json` runs `npm ci`, and a bare `package.json` runs `npm install`. The first match in that order wins. Detection covers JavaScript only. For other ecosystems set `install` yourself; with no match, nothing is installed. A configured string always wins, and `""` disables installing.

## Providers

Several providers can be configured and used side by side. `up`, `run`, `bake` and `image build` use one provider, chosen in this order:

1. `--provider <id>`, accepted anywhere before `--`
2. `L2B_PROVIDER`
3. `repos.<o/r>.provider`
4. the top-level `provider`

An unknown id fails and lists the known ones. Snapshots and bake times are kept per provider, so bake a repo on each provider you use it with.

Each provider has its own config block with its own API key, such as `e2b` below. A provider counts as configured when its block is present, it is the default, or its API key resolves. With no block, that means its default variable is set, such as `E2B_API_KEY`.

`exec`, `shell`, `url`, `down`, `pause` and `creds` address a box by name. With `--provider` they use that provider. Without it they look the name up on every configured provider at once. One match is used. No match gives a "no sandbox named" error that lists the providers searched. A box l2b started from this machine that has since expired gets a "box expired" error with the time of its last l2b activity and the `up` command that starts it again. A name on several providers fails and asks for `--provider`. A provider with no usable API key is skipped in this lookup, but an explicit `--provider` for it fails and names the key to set.

`ls` lists boxes from every configured provider, with the provider id in the last column. A provider that fails prints one warning on stderr and the rest still list.

### e2b

Set `E2B_API_KEY`, or point `e2b.apiKey` at a value reference. Image settings apply on the next `l2b image build`.

A box expires through e2b's server-side timeout. l2b sets it to the idle window at creation and re-arms it with a heartbeat while a command or shell runs.

| Key | Default | Meaning |
| --- | --- | --- |
| `e2b.apiKey` | env `E2B_API_KEY` | Value reference: `env`, `file`, `command` or `doppler` |
| `e2b.onIdle` | `idle.action` | At the end of the idle window: `kill` discards the box; `pause` keeps disk and memory (and secrets) |
| `e2b.cpuCount`, `e2b.memoryMB` | `4`, `8192` | Box size at image build |
| `e2b.features` | all | Image tooling: `node`, `gh`, `doppler`, `docker`, `postgres`, `redis`, `ripgrep`, `tmux`. `[]` for a lean image |
| `e2b.nodeMajor` | `24` | Node version for the `node` feature |
| `e2b.npmGlobals`, `e2b.aptPackages` | `[]` | Extra packages in the image |
| `e2b.imageCommands` | `[]` | Shell commands run as the box user at image build, for toolchains |

### boat

Set `BOAT_API_KEY`, or point `boat.apiKey` at a value reference. `ssh` and `ssh-keygen` must be on your PATH.

Boxes run boat's stock Ubuntu image, which has git, gh, node, bun and docker. A bake is a stopped boat box: `l2b bake` clones and installs in a box, then stops it, and boat keeps its disk. Boxes started from the bake are forks of it. boat keeps a stopped box's disk for at least 14 days and may delete it after that; once it is gone, `up` and `run` clone from scratch until the next bake. A new bake replaces the old one. `l2b image build` makes a `l2b-base` bake with the packages and commands in the `boat` block, and boxes and bakes start from it; with neither set it builds nothing.

A box expires through boat's auto-stop deadline. l2b sets it to the idle window at creation and re-arms it while a command or shell runs. Boxes are created with snapshots off, so the stop at the deadline erases the box and its disk. A forked box may keep its disk when it stops; l2b deletes stopped boxes on the next `up` or `run`.

Credentials go to the box over SSH stdin into `/dev/shm/l2b.env`. l2b authorizes a new key for each write, pins the host key boat reports, then revokes the key and deletes it locally. Secrets are never part of an API request, a command line or boat's file API. Boxes are created with monitoring off, so boat keeps no command history or output. boat writes the output of each command to `~/.ascii/processes/` on the box disk; a command that prints a secret leaves it there until the box is gone. Bake writes a `.boatignore` that keeps that folder out of the kept disk.

`shell` runs `ssh -t`. `url` returns a token-gated URL for a service listening on `0.0.0.0`; anyone with the full URL can open the port. `pause` is not supported.

| Key | Default | Meaning |
| --- | --- | --- |
| `boat.apiKey` | env `BOAT_API_KEY` | Value reference: `env`, `file`, `command` or `doppler` |
| `boat.type` | `"default"` | Box size: `small`, `default`, `large`, `xlarge` |
| `boat.environment` | `null` | A boat environment to attach to every box. `null` attaches none, so boxes get no account secrets, repos or logins |
| `boat.aptPackages` | `[]` | Apt packages `l2b image build` adds to the stock image |
| `boat.imageCommands` | `[]` | Shell commands run as the box user at image build (sudo is available) |

## Git hosts

Every git host is a base URL, a credential username, a token and the variable the token is exported as. `github` and `gitlab` are presets of that shape:

| Type | Token | Exported as |
|---|---|---|
| `github` | `firstOf` `GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token` | `GH_TOKEN` |
| `gitlab` | `firstOf` `GITLAB_TOKEN`, `glab auth token` | `GITLAB_TOKEN` |

GitHub is the default. `baseUrl` points a preset at GitHub Enterprise Server or a self-hosted GitLab (`{ "type": "gitlab", "baseUrl": "https://gitlab.example.com" }`); the CLI fallback then becomes `gh auth token --hostname <host>` or `glab auth token --hostname <host>`. Bitbucket, Gitea and other https hosts use `generic`, with an optional `tokenEnvVar` (default `L2B_GIT_TOKEN`):

    { "type": "generic", "baseUrl": "https://bitbucket.org", "username": "x-token-auth",
      "token": { "from": "env", "name": "BITBUCKET_TOKEN" } }

## Keeping snapshots fresh

A stale snapshot makes `up` slower. `bake --if-older-than` skips the work when the snapshot is recent, so a scheduled job can call it often:

    0 3 * * * l2b bake my-org/my-repo --if-older-than 20h

l2b records bake times in `$XDG_STATE_HOME/l2b/bakes.json`. A snapshot baked elsewhere has no known age.

l2b records the boxes it starts, with their repo, branch and last activity, in `$XDG_STATE_HOME/l2b/boxes.json`. `down` removes an entry, and entries unused for three days are dropped.

## Adding a provider

A provider gets the workflow done with its own primitives. Core says what it wants: a box for this repo and branch, a bake, a command run. Core then checks the result.

1. Implement `Provider` and `Box` from `src/providers/types.ts`. The doc comments there state the functionality expectations: what `start` delivers, how credentials must be handled, and that boxes expire on their own.
2. Throw `UnsupportedError` for anything the provider cannot do. l2b prints its message as it comes.
3. Keep provider policy in the adapter and its own config block: what pause keeps, ssh or pty, snapshots, image builds, lifetime caps.
4. Reuse `src/toolkit/` if it fits. It has git scripts, install detection, the credential env file, the file write behind `put`, the heartbeat, local bake records, the base recipe and `machineWorkflow`, which turns low-level machine primitives into a `Provider`. Nothing requires it.
5. Pass the contract suite. Add a test that calls `describeProviderContract({ name, makeProvider, timeoutMs })` from `src/providers/contract.ts`. It covers the branch checkout with dependencies installed, exec exit codes and streams, background processes outliving exec, `put`, the git identity, credentials reaching commands and never being persisted, bakes, run-once cleanup, idle expiry and `UnsupportedError`. Gate a real-provider run behind an environment variable, as `src/providers/e2b/contract.test.ts` does with `L2B_CONTRACT_E2B=1`.
6. Register the provider in `src/providers/index.ts` and `src/providers/ids.ts`, add its config block to `src/config.ts`, and give it a README section.

## Development

    bun run typecheck
    bun test
    L2B_CONTRACT_E2B=1 bun test src/providers/e2b   # contract suite against real e2b boxes
    L2B_CONTRACT_BOAT=1 bun test src/providers/boat # contract suite against real boat boxes

## Releasing

    scripts/release.sh 0.3.0

Run it from a clean checkout of an up-to-date `main`. It opens a PR that bumps the version in `package.json`, waits for checks, merges it, then tags the merge commit `v0.3.0` and pushes the tag.

The tag starts `.github/workflows/release.yml`. It fails if the tag does not match `package.json`, runs the typecheck and tests, builds `l2b-darwin-arm64`, `l2b-darwin-x64`, `l2b-linux-x64` and `l2b-linux-arm64` with `bun build --compile`, signs the macOS binaries ad hoc, and publishes them with `SHA256SUMS` as a GitHub release.

A failed release is fixed forward with a new patch version. A published tag is never moved.

## License

MIT
