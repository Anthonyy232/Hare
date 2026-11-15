# Working on Hare

A browser extension (WXT, Svelte 5, TypeScript, MV3) that controls video and audio speed in Chrome and Firefox. `npm run dev` doesn't launch a browser: load the printed output folder unpacked in a separate profile.

## Code

- Simple and direct. No speculative abstractions, options or extension points.
- Stay in scope; suggest extras instead of adding them.
- Use what the platform, framework, dependencies and this repo already provide before writing a helper.
- Validate only at real boundaries (user input, storage, network, other processes). No checks, fallbacks or try/catch for cases that can't happen.
- One source of truth for each value or rule.
- Delete dead code you find or create.
- Match the surrounding code.
- Fix root causes, and fix the same pattern everywhere it occurs.

## Comments

- Only where the reason isn't clear from the code: a quirk, a race, a non-obvious decision.
- Short fragments, not sentences. Never restate code, narrate, or label sections.
- Delete comments that no longer match.

## Tests

- Behaviour and the edges that can break. No trivial, duplicate, obvious or low-signal tests.
- A regression test fails without its fix.
- Deterministic: fake time and observable events, no sleeps.
- A failing test is a bug until shown otherwise.

## Hare

- `lib/` is grouped by feature. A feature owns its messages and listeners; `background.ts` and `content.ts` only route, and the popup and options pages are views.
- Page messages and stored settings are the real boundaries; trust internal callers.
- `npm run test:e2e` builds first and drives the built Chrome extension. Run it for anything that runs in pages, the popup or sync.
- Mozilla reviewers rebuild from the source archive: `zip.includeSources` in `wxt.config.ts` lists what goes in it, and the README's "Building from source" section is their instructions. Keep both true.
- `site/` is the GitHub Pages site, deployed by `.github/workflows/pages.yml`. It is not part of the extension or the source archive.

## Done means

- Diff reviewed against this file.
- `npm run check` passes with zero warnings.
- UI changes seen in the running app, light and dark. Docs and metadata changes need no end-to-end run.
- README updated for anything users will notice; behaviour changes called out.

## Docs

- README is for users: what it does, how to get it, how to use it. No internals, no agent instructions.
- This file is for agents: only what can't be found quickly in the code.
- No meta docs in the repo (notes, audits, plans, reports).

## Git

- `type: summary` or `type(scope): summary`: lowercase, imperative, no full stop, about 70 characters at most. Types: `feat` `fix` `refactor` `perf` `test` `docs` `style` `build` `ci` `chore`.
- Body only to say why. `Fixes #123` closes an issue.
- One logical change per commit. Squash fix-ups before merging.
- Branch off `main`. A single commit fast-forwards; several merge with `merge: <summary>`.
- No AI attribution in commits, branches, PRs or releases.
- One maintainer: amending and force-pushing to tidy history is fine. Keep contributors as authors. Delete stale branches.

## Pull requests

- Title in commit format. Body: what changed, why, how it was checked. Short.

## Releases

- Bump commit `chore: release vX.Y.Z`; tag `vX.Y.Z`, which must match `package.json`.
- Title `Hare X.Y.Z`.
- Notes: banner image first, then `### New`, `### Improved`, `### Fixed` (only those that apply). One line per change, written for users; no internals, dependency lists or test counts. End with the install link(s) and the full changelog link.
- Banner: on the orphan `media` branch, `node banner.cjs <version> "<highlight>"` writes `releases/v<version>.png`; reference its raw URL. The branch's README has the steps.
- Pushing the tag makes CI build the ZIPs and open a draft release. Firefox Add-ons is submitted by hand with the Firefox and sources ZIPs.

## Agents

- Pushing, amending and force-pushing are allowed. Ask before publishing a release or submitting to a store.
- Leave changes you didn't make alone. Clean up scratch files, processes and emulators.
- Say what was checked and how, and what wasn't.
- Short replies; one recommendation, not a list of options.
