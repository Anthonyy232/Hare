# Working on Hare

Guidance for anyone changing this codebase, human or AI. These are defaults, not laws: follow them unless you have a good reason not to, and say what the reason was.

Hare is a browser extension (WXT, Svelte 5, TypeScript, MV3) for Chrome and Firefox. `npm run dev` doesn't launch a browser: load the printed output folder unpacked in a separate profile.

## Architecture

- **`lib/` is grouped by feature.** A feature owns its messages and listeners; `background.ts` and `content.ts` only route, and the popup and options pages are views.

## How we write code

- **Simple beats clever.** Write the most direct code that solves today's problem. No speculative abstractions, options or extension points for needs that don't exist yet.
- **Stay in scope.** Build what was asked; suggest extras instead of adding them.
- **Don't hand-roll what already exists**, in the browser APIs, WXT, Svelte, a dependency or this repo. Search before you write a helper.
- **Not overly defensive.** Validate at real boundaries (page messages, stored settings, network) and trust internal callers. No checks, fallbacks or try/catch for cases that can't happen.
- **One source of truth.** Define a value or rule once instead of keeping copies in step.
- **Delete dead code** you come across or create: unused exports, messages, styles and dependencies.
- **Match the surrounding code**: naming, structure, comment density and idioms.
- **Fix root causes.** A site or browser workaround gets a comment saying why.
- **Fix it everywhere.** After fixing a bug or a convention slip, look for the same pattern elsewhere.

## Comments

- Explain **why**, not **what**: a browser or site quirk, a race, a non-obvious decision. One tight line where possible.
- Don't restate names or code, narrate the next line, or label sections. Remove comments that no longer match the code.

## Tests

- Test **behaviour and the edges that can break**: sync lifecycle and races, cross-frame messaging, settings persistence.
- No trivial, duplicate, obvious or low-signal tests. A regression test should fail without its fix.
- Keep tests deterministic: fake timers and observable events, not sleeps.
- A failing test is a bug until shown otherwise.

## Before you call something done

- You have **reviewed your own diff against this file**: over-engineering, over-abstraction, defensive code, hand-rolled or duplicated code, low-signal tests, restating comments.
- `npm run check` passes with **zero warnings**, and `npm run test:e2e` passes for anything that runs in pages, the popup or sync.
- **Check the real case in a browser**, not just the tests.
- Behaviour changes are deliberate and called out.

## Git

- **Commit messages are short and informal**: lowercase, no trailing punctuation, bullets only when they help, e.g. `keep recorded stream playlists across extension updates`. Releases are `release x.y.z`.
- **No AI attribution** in commits, branches, PRs or release notes.
- **Don't commit meta docs**: review notes, audits, decision logs or verification reports.
- One logical change per commit. Work on a branch off `main` and merge when asked.
- Release notes are short and user-facing: no internals or test counts.

## For AI agents

- Ask before anything hard to undo or visible to others. Approval to commit or merge isn't approval to push.
- Leave changes you didn't make alone, and clean up scratch files, browser profiles and processes when done.
- Report honestly: what was verified and how, and what wasn't.
- Keep replies short; give one clear recommendation rather than a list of options.
