# local2b

<img width="3888" height="1784" alt="sebastian-schuster-dkKgXnqFkjE-unsplash" src="https://github.com/user-attachments/assets/b3979a53-dc14-4f96-ab0e-8833d9137ccb" />


l2b runs heavy repo work on remote sandboxes: typechecks, test suites, installs, builds, dev servers. Its only users are coding agents. An agent drives it through the skill in `skills/l2b/SKILL.md`; a person sets up provider credentials once and is not involved after that.

    l2b run --repo my-org/my-repo --branch feature/x -- yarn test

That starts a box, checks out the branch, runs the project's setup and install from `.l2b.json`, runs the command, destroys the box, and returns the exit code. Inside a checkout, `--repo` and `--branch` default to that checkout's.

This README is for maintainers and for agents that need more than the skill: how l2b works, its configuration, and how to add a provider.

## What it does

- Pushes the git host token and configured secrets to the box's tmpfs on each call. Images and bakes never contain them.
- Builds the provider's base image on first use and again when its settings change.
- Bakes each repo in the background, so later boxes start as a branch switch plus an incremental install. A bake is made again in the background when it gets old or `.l2b.json` changes.
- Destroys the box after `run`, and expires idle boxes on the provider's side.
- Says on stderr what it did and, on failure, what to do next.

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

## Setup

A person does this once per machine, usually from their dotfiles or installer. Nothing else needs a person.

- Install l2b, as above.
- Give l2b a provider API key, and a git host token: `gh` logged in, or `GH_TOKEN` set.
- Optionally, list secret sources for every box.

The user config at `~/.config/l2b/config.json` (or `$L2B_CONFIG`) holds only these. `config.example.json` is a starting point:

    {
      "provider": "e2b",
      "e2b": { "apiKey": { "from": "env", "name": "E2B_API_KEY" } },
      "secrets": []
    }

Everything about a repo lives in its `.l2b.json`, which agents write. The base image and the bakes are made automatically.

## Commands

- `init`: write a starter `.l2b.json` in the current directory. See Project config.
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
- `bake [o/r] [--install cmd] [--warm cmd] [--branch b] [--if-older-than 12h]`: bake the repo now. `up` and `run` already bake in the background when needed. Fails while another bake of the repo runs. `--if-older-than` skips the bake while the current one is newer and made with the same settings.
- `bake --delete [o/r]`: delete the repo's bake on the selected provider and l2b's local records of it. Later boxes start without a bake.
- `bakes`: list bakes on every configured provider, or on `--provider`'s: repo, provider, id and age. A bake l2b has no local record of shows its own name and no age.
- `image build`: build the base image now. l2b builds it on its own when it is missing or its settings changed.
- `update`: replace the binary with the latest release and refresh the skill.
- `install`: install the agent skill into `~/.agents/skills/l2b` and `~/.claude/skills/l2b`. From a checkout it links the skill and puts `l2b` on PATH; a released binary writes the skill files.

`run`, `up`, `bake` and `creds` take the repo from the checkout in the current directory when `--repo` is not given. See Repo and branch from the checkout.

Use `run` for one-off work. Use `up`, `exec` and `down` when several commands need the same checkout, or for a dev server behind a `url`.

Detached jobs suit long commands such as full test suites, which would otherwise hit a tool-call timeout. Output and exit status are kept in `~/.l2b-jobs/<job>/` in the box (`log`, `status`). A job does not hold off box expiry by itself, so run `logs` or `jobs` now and then while it runs.

## How it works

Each provider runs this workflow with its own primitives. The description below is the shared toolkit's snapshot-and-mirror workflow, which e2b uses.

An **image** holds tooling only: git, gh, a language runtime and whatever the provider config adds. A **bake** is a per-repo disk capture on top of that image: whatever `setup` installed, a shallow mirror, a checkout, installed dependencies, and any codegen from `warm`. A **box** is a sandbox started from the bake. `up` pushes credentials, switches the checkout to the branch, and runs `install` incrementally. Without a bake, `up` runs `setup`, clones, then runs `install`.

Boxes expire 15 minutes after the last l2b activity, with no local process needed; each provider documents how it guarantees that. Push a branch to keep work.

### Base image

Before a start without a bake, and before a bake, the provider makes sure its base image exists and matches the image settings. If it is missing, or was built from other settings, l2b builds it first and prints `preparing the base image <name> (first use|image settings changed; several minutes, once)`. A hash of what the image is built from is kept in `$XDG_STATE_HOME/l2b/images.json`. One l2b process builds at a time; others print `waiting for another l2b process` and wait. An image already on the provider that this machine has no record of is used as it is and recorded, so a new machine does not rebuild a shared image. Boxes and bakes are created from the exact base image build l2b prepared or confirmed, not from the image's name, so a bake made right after a rebuild has the new tools. A bake made on an older base image, or on another build of it, counts as out of date and is made again in the background.

### Background bakes

`up` and `run` check the repo's bake before starting the box:

| Bake | This box starts | Background bake |
| --- | --- | --- |
| None, or of unknown age | from the bake if the provider has one, else without | yes |
| Older than `staleSnapshotHours` (72) | from it | yes |
| Made with other `install`, `env`, `clone` or `baseBranch` | from it, then applies the change | yes |
| Made with other `setup` or `warm` | without it | yes |
| Made before l2b recorded its settings | from it | yes |
| Current | from it | no |

The background bake is a detached `l2b bake` that outlives the command that started it. Its output goes to `$XDG_STATE_HOME/l2b/logs/bake-<provider>-<owner>-<name>.log`. A lock in `$XDG_STATE_HOME/l2b/locks/` allows one bake per provider and repo, so concurrent agents start one; a lock whose process has died is taken over. Each case prints one line on stderr that names the log. `--full` skips all of this.

A bake replaces the previous one only once it is complete, so boxes keep starting from the old bake while it runs and after it fails. A bake that failed because a repo command failed (`setup`, `install`, `warm`, the clone) is not retried with the same settings for an hour; starts say so and name the log. Changing `.l2b.json` retries it at once. Any other failure is retried on the next start. A bake replaces the box an earlier failed bake of the repo left up.

### Local records

l2b keeps these under `$XDG_STATE_HOME/l2b/` (default `~/.local/state/l2b/`):

- `bakes.json`: when each repo was baked, and on which base image build. A bake made on another machine has no known age.
- `bake-configs.json`: a hash of the settings each bake used (`setup`, `install`, `warm`, `baseBranch`, `clone`, `env`).
- `bake-failures.json`: the last bake per repo that failed on a repo command.
- `images.json`: the recipe hash of each base image, and the build in use.
- `boxes.json`: the boxes l2b started, with their repo, branch and last activity. `down` removes an entry, and entries unused for three days are dropped.
- `locks/` and `logs/`: bake and image locks, and background bake logs.

## Project config

A project describes its environment in `.l2b.json`. Agents write and maintain it. l2b uses the nearest one, looking in the current directory and then each parent up to the filesystem root. Commit it to share it, or keep it untracked in a parent directory to cover every checkout below it.

`l2b init` writes a starter file in the current directory with every key. In a checkout it fills in `repo` and `baseBranch`. It does not overwrite an existing file.

    {
      "repo": "my-org/my-service",
      "baseBranch": "main",
      "setup": [
        "curl -fsSL https://go.dev/dl/go1.24.5.linux-amd64.tar.gz | sudo tar -C /usr/local -xz",
        "sudo ln -sf /usr/local/go/bin/go /usr/local/go/bin/gofmt /usr/local/bin/"
      ],
      "install": "go mod download",
      "warm": null,
      "env": {},
      "secrets": [],
      "clone": {},
      "provider": null,
      "gitHost": null
    }

| Key | Meaning |
| --- | --- |
| `repo` | `owner/name` the file is for. A command for another repo fails while this file is the nearest. Outside a checkout it supplies `--repo` |
| `setup` | Shell commands that install the toolchain. They run in order as the box user (sudo is available) in its home, before the clone: at bake, and on a start without a bake. A start from a bake keeps their result |
| `install` | Runs in the checkout at bake and on every start. Keep it incremental |
| `warm` | Runs once at bake, after `install` |
| `baseBranch` | Branch the bake is made from |
| `env` | Plain, non-secret variables set in every box |
| `secrets` | Secret sources added to the user config's. See Secret sources |
| `clone` | `strategy`, `depth` and `filter`, as in Config |
| `provider` | Provider for this repo |
| `gitHost` | Git host for this repo. See Git hosts |

`null`, `{}` and `[]` leave a key to the user config. Unknown keys are an error that names the file.

Settings resolve in this order: command-line flags, the nearest `.l2b.json`, `repos.<o/r>` in the user config, then the user config's globals. Provider settings (API keys, image features, box size) live in the user config only.

Each command runs in a non-login shell, so put tools on the default `PATH`, for example by linking them into `/usr/local/bin`.

With no `.l2b.json` and no `install` in `repos.<o/r>`, nothing is set up or installed, and `up`, `run` and `bake` say so on stderr and point at `l2b init`. A command in `run` or `exec` that exits 127 (command not found) prints a pointer to `setup`.

`secrets` and a `generic` `gitHost` can name commands, which l2b runs on the local machine without asking, as it runs `setup` and `install` in the box.

### Repo and branch from the checkout

Without `--repo`, `run`, `up`, `bake` and `creds` use the git checkout in the current directory. `owner/name` comes from its `origin` remote, matched against the git host. An `origin` on another host is an error that asks for `--repo`. Outside a checkout, `repo` from `.l2b.json` is used.

Without `--branch`, `run` and `up` use the checkout's current branch. The box fetches that branch from the remote, so l2b prints one line when the branch is not on `origin` or has unpushed commits. `bake` uses `baseBranch`, not the current branch.

## Credentials

Nothing secret goes into an image or bake. At call time, l2b resolves a git host token and the configured secrets locally and writes them to `/dev/shm/l2b.env` in the box (tmpfs, mode 600). Every `exec` sources that file. Bake deletes it before snapshotting, and snapshots are filesystem-only.

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

`$L2B_CONFIG`, else `~/.config/l2b/config.json`. Every key has a default. In normal use it holds only provider credentials and secret sources (see Setup); repo settings belong in `.l2b.json`. The other keys exist for machine-wide defaults, and `repos.<o/r>` is the fallback for repos without a `.l2b.json`.

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
| `staleSnapshotHours` | `72` | Age past which `up` and `run` re-bake in the background |
| `repos.<o/r>.baseBranch` | repo default | Branch the bake is made from |
| `repos.<o/r>.setup` | `[]` | Toolchain commands; see `setup` in Project config |
| `repos.<o/r>.install` | none | Runs on every `up` and at bake. Keep it incremental. `""` runs nothing |
| `repos.<o/r>.warm` | none | Runs at bake only (codegen, builds). Output ships in the bake |
| `repos.<o/r>.env` | `{}` | Plain, non-secret variables set in every box for this repo |
| `repos.<o/r>.gitHost` | global | Per-repo override |
| `repos.<o/r>.provider` | global `provider` | Provider used for this repo |
| `repos.<o/r>.clone` | global | Per-repo override of `strategy`, `depth` and `filter`. Unset fields inherit |

A change to `setup`, `baseBranch`, `warm` or `clone` makes `up` and `run` bake again in the background (see Background bakes); the bake prints the clone strategy it used. `up` follows what the bake contains: it uses a baked mirror if one exists and otherwise fetches in place, so changing the strategy never breaks an existing bake. `--full` on `up` or `run` clones without a bake at full depth and keeps the filter.

Use `plain` for small repos. A mirror pays off when the repo is large and boxes switch branches often; for a small repo it adds a second copy and nothing else.

## Providers

Several providers can be configured and used side by side. `up`, `run`, `bake` and `image build` use one provider, chosen in this order:

1. `--provider <id>`, accepted anywhere before `--`
2. `L2B_PROVIDER`
3. `repos.<o/r>.provider`
4. the top-level `provider`

An unknown id fails and lists the known ones. Bakes and bake times are kept per provider; each provider gets its own background bake.

Each provider has its own config block with its own API key, such as `e2b` below. A provider counts as configured when its block is present, it is the default, or its API key resolves. With no block, that means its default variable is set, such as `E2B_API_KEY`.

`exec`, `shell`, `url`, `down`, `pause` and `creds` address a box by name. With `--provider` they use that provider. Without it they look the name up on every configured provider at once. One match is used. No match gives a "no sandbox named" error that lists the providers searched. A box l2b started from this machine that has since expired gets a "box expired" error with the time of its last l2b activity and the `up` command that starts it again. A name on several providers fails and asks for `--provider`. A provider with no usable API key is skipped in this lookup, but an explicit `--provider` for it fails and names the key to set.

`ls` lists boxes from every configured provider, with the provider id in the last column. A provider that fails prints one warning on stderr and the rest still list.

### e2b

Set `E2B_API_KEY`, or point `e2b.apiKey` at a value reference. The base image is an e2b template named by `e2b.template`. It is built on first use and rebuilt when the image settings below change; a template's build counts once it has a `default` tag. l2b tags each build it uses with its own `l2b-<id>` tag and creates boxes and bakes from `<template>:<tag>`, so they run that exact build.

A box expires through e2b's server-side timeout. l2b sets it to the idle window at creation and re-arms it with a heartbeat while a command or shell runs.

| Key | Default | Meaning |
| --- | --- | --- |
| `e2b.apiKey` | env `E2B_API_KEY` | Value reference: `env`, `file`, `command` or `doppler` |
| `e2b.template` | `"l2b-dev"` | Name of the base image template |
| `e2b.onIdle` | `idle.action` | At the end of the idle window: `kill` discards the box; `pause` keeps disk and memory (and secrets) |
| `e2b.cpuCount`, `e2b.memoryMB` | `4`, `8192` | Box size at image build |
| `e2b.features` | all | Image tooling: `node`, `gh`, `doppler`, `docker`, `postgres`, `redis`, `ripgrep`, `tmux`. `[]` for a lean image |
| `e2b.nodeMajor` | `24` | Node version for the `node` feature |
| `e2b.npmGlobals`, `e2b.aptPackages` | `[]` | Extra packages in the image |
| `e2b.imageCommands` | `[]` | Shell commands run as the box user at image build, for toolchains |

### boat

Set `BOAT_API_KEY`, or point `boat.apiKey` at a value reference. `ssh` and `ssh-keygen` must be on your PATH.

Boxes run boat's stock Ubuntu image, which has git, gh, node, bun and docker. A bake is a stopped boat box: `l2b bake` clones and installs in a box, then stops it, and boat keeps its disk. Boxes started from the bake are forks of it. boat keeps a stopped box's disk for at least 14 days and may delete it after that; once it is gone, `up` and `run` start without it and bake again in the background. A new bake replaces the old one. With packages or commands in the `boat` block, l2b keeps a `l2b-base` bake built from them, and boxes and bakes start from it; it is built on first use and again when those settings change. With neither set, nothing is built.

A box expires through boat's auto-stop deadline. l2b sets it to the idle window at creation and re-arms it while a command or shell runs. Boxes are created with snapshots off, so the stop at the deadline erases the box and its disk. A forked box may keep its disk when it stops; l2b deletes stopped boxes on the next `up` or `run`.

Credentials go to the box over SSH stdin into `/dev/shm/l2b.env`. l2b authorizes a new key for each write, pins the host key boat reports, then revokes the key and deletes it locally. Secrets are never part of an API request, a command line or boat's file API. Boxes are created with monitoring off, so boat keeps no command history or output. boat writes the output of each command to `~/.ascii/processes/` on the box disk; a command that prints a secret leaves it there until the box is gone. Bake writes a `.boatignore` that keeps that folder out of the kept disk.

`shell` runs `ssh -t`. `url` returns a token-gated URL for a service listening on `0.0.0.0`; anyone with the full URL can open the port. `pause` is not supported.

| Key | Default | Meaning |
| --- | --- | --- |
| `boat.apiKey` | env `BOAT_API_KEY` | Value reference: `env`, `file`, `command` or `doppler` |
| `boat.type` | `"default"` | Box size: `small`, `default`, `large`, `xlarge` |
| `boat.environment` | `null` | A boat environment to attach to every box. `null` attaches none, so boxes get no account secrets, repos or logins |
| `boat.aptPackages` | `[]` | Apt packages the `l2b-base` image adds to the stock image |
| `boat.imageCommands` | `[]` | Shell commands run as the box user when `l2b-base` is built (sudo is available) |

## Git hosts

Every git host is a base URL, a credential username, a token and the variable the token is exported as. `github` and `gitlab` are presets of that shape:

| Type | Token | Exported as |
|---|---|---|
| `github` | `firstOf` `GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token` | `GH_TOKEN` |
| `gitlab` | `firstOf` `GITLAB_TOKEN`, `glab auth token` | `GITLAB_TOKEN` |

GitHub is the default. `baseUrl` points a preset at GitHub Enterprise Server or a self-hosted GitLab (`{ "type": "gitlab", "baseUrl": "https://gitlab.example.com" }`); the CLI fallback then becomes `gh auth token --hostname <host>` or `glab auth token --hostname <host>`. Bitbucket, Gitea and other https hosts use `generic`, with an optional `tokenEnvVar` (default `L2B_GIT_TOKEN`):

    { "type": "generic", "baseUrl": "https://bitbucket.org", "username": "x-token-auth",
      "token": { "from": "env", "name": "BITBUCKET_TOKEN" } }

## Adding a provider

A provider gets the workflow done with its own primitives. Core says what it wants: a box for this repo and branch, a bake, a command run. Core then checks the result.

1. Implement `Provider` and `Box` from `src/providers/types.ts`. The doc comments there state the functionality expectations: what `start` delivers, how credentials must be handled, and that boxes expire on their own.
2. Throw `UnsupportedError` for anything the provider cannot do. l2b prints its message as it comes.
3. Keep provider policy in the adapter and its own config block: what pause keeps, ssh or pty, snapshots, image builds, lifetime caps.
4. Reuse `src/toolkit/` if it fits. It has git scripts, the setup runner, the credential env file, the file write behind `put`, the heartbeat, local bake records, the base recipe and `machineWorkflow`, which turns low-level machine primitives into a `Provider`. Nothing requires it.
5. Pass the contract suite. Add a test that calls `describeProviderContract({ name, makeProvider, timeoutMs })` from `src/providers/contract.ts`. It covers the branch checkout with dependencies installed, setup ordering, exec exit codes and streams, background processes outliving exec, `put`, the git identity, credentials reaching commands and never being persisted, bakes, listing and deleting bakes, run-once cleanup, idle expiry and `UnsupportedError`. Gate a real-provider run behind an environment variable, as `src/providers/e2b/contract.test.ts` does with `L2B_CONTRACT_E2B=1`.
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
