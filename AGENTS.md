# Contributing notes

- Keep the CLI, README, skill, and error messages provider-neutral. Provider names belong only in `src/providers/<id>/`, the provider's config block, and the provider's own README section.
- Core code talks to `Provider` and `Box` from `src/providers/types.ts`. Do not import a provider's SDK or helpers from outside its directory (the provider registry in `src/providers/index.ts` and the config schema are the only places that name providers).
- The boundary is workflow-level. Core states what it wants and checks results; it does not know how a provider gets there. Do not add capability flags or core rules about pause, terminals, lifetimes, snapshots or images. That policy lives in the adapter and its config block.
- `src/toolkit/` holds building blocks adapters may compose. Core does not call them on a provider's behalf.
- Functionality expectations go in `src/providers/types.ts` doc comments and are enforced by the contract suite (`src/providers/contract.ts`), not by core logic. A new expectation needs a contract test.
- Docs: short declarative sentences, commands as plain lists, tables only for reference data. No comparisons to a specific provider's own CLI.
- Public copy states what the tool does now. No roadmap or project-status asides ("X is the first", "for now", "currently", "coming soon"), no hedges ("if that matters to you"), no taglines or bolded slogans. Don't oversell.
- Tests use real local git and a real shell. The fakes in `src/test/` are the only doubles. `fake-provider.ts` stands in for a whole provider and passes the contract suite. `fake-machine.ts` stands in for a provider SDK under the toolkit workflow.
- `main` is protected: open a PR, squash merge.
