# local2b

Toolkit for pushing dev work (worktrees, dev servers, test suites) onto remote e2b sandboxes so local pi / Claude Code / Codex sessions can spin up compute on demand instead of eating local disk and RAM.

## Usage

    bun install
    l2b up my-task --repo Create-Inc/escher --branch main --doppler anyone-shared-credentials/dev
    l2b exec my-task --cwd /home/user/escher -- yarn typecheck
    l2b url my-task 3000
    l2b pause my-task | l2b down my-task | l2b ls

Needs a valid `E2B_API_KEY`, plus local `gh` and `doppler` logins.

## Credential model

Credentials are resolved locally at call time and written to the sandbox's tmpfs (`/dev/shm/l2b.env`, mode 600), sourced on every `exec`. Nothing is baked into templates or written to sandbox disk. `l2b creds <name>` refreshes them. Paused sandboxes snapshot memory, so they still hold the secrets.

## Roadmap

- Prebuilt template (repo cloned, `yarn install` done, Postgres/Redis/Doppler/gh/pi preinstalled), based on `apps/flux/e2b-templates/self-improvement/e2b.Dockerfile` in escher
- Interactive shell (PTY), file pull/push, git fetch of sandbox branches locally
- Scoped, short-lived Doppler service tokens instead of copying secrets from the local login
- Agent-facing skill so pi/Claude/Codex know how to use `l2b`
- Auto-pause on idle, TTL reaping
