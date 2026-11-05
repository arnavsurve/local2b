# Contributing notes

- Keep the CLI, README, skill, and error messages provider-neutral. Provider names belong only in `src/providers/<id>/`, the provider's config block, and the provider's own README section.
- Core code talks to `Provider` and `Box` from `src/providers/types.ts`. Do not import a provider's SDK or helpers from outside its directory (the provider registry in `src/providers/index.ts` and the config schema are the only places that name providers).
- Docs: short declarative sentences, commands as plain lists, tables only for reference data. No comparisons to a specific provider's own CLI.
- Tests use real local git and a real shell; the in-memory fake provider (`src/test/fake-provider.ts`) is the only double.
- `main` is protected: open a PR, squash merge.
