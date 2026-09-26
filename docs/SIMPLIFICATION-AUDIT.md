# Completed simplification audit — September 26, 2026

This closes the three review passes, simplification pass, and subsequent whole-repository handrolling audit. Every current authored file is listed below. Dependencies, Git internals, generated build output and ignored local evidence are outside the source inventory; the dependency graph and produced packages were checked separately. No actionable finding remains from these passes. This is an evidence-backed review, not a guarantee about every website or browser state.

## Final buffering and performance review — September 26

A fresh review of sync, media lifecycle, cleanup and performance found additional edge cases and repaired them:

- Buffering now tracks actual start/recovery transitions. `canplay` can release a source paused by its peer; duplicate readiness events do not restart recovery timers. Simultaneous stalls pause both sources and resume only when both recover. Deliberate pauses clear recovery intent on both agents.
- Buffering state is persisted and reconciled against the agents after a service-worker restart. Position polling continues during a stall, so missing recovery events and disconnected frames cannot leave an indefinitely stuck session. Stalled media clocks are not extrapolated as though they were playing.
- A superseded `play()` rejection cannot cancel a newer play request. Actual playback rejection still reports the pause to its peer.
- Coalesced remote seeks no longer leave a counter that swallows the next user seek. Tracking the final target removed the counter and its timeout.
- Starting playback skips a seek when the partner is already within the existing 50 ms sync tolerance, avoiding needless work and transient buffering pauses.
- Source errors and emptied sources release the old sync pair. Their listeners share native AbortController cleanup with source-replacement handling.
- Drift polls cannot overlap, and session storage retains metadata only for the current pair.

Five new unit regressions failed against the preceding code. An additional native MediaSource test reproduced a fatal decode error leaving sync active. All now pass. The existing worker-termination browser test now terminates the worker during buffering and verifies recovery. The MediaSource case exhausts actual buffered VP8 data, refills it while the source is paused, verifies resumed playback, and triggers a real decode error. Its peer-induced pause is issued explicitly to make that timing deterministic. These extend the injected media-event tests; they do not simulate every network or DRM implementation.

The recovery event choice follows the [HTML media ready-state algorithm](https://html.spec.whatwg.org/multipage/media.html#ready-states): readiness can change while media is paused, whereas playing notifications depend on playback state.

## Changes in the final audit

- Removed two unused CSS libraries, an obsolete remote-media manual fixture, an unused message route and unused message strings/imports.
- Removed the arbitrary 50-shadow-root cutoff from the already iterative media traversal. The strengthened 64-root regression failed before the fix and passes afterward.
- Removed remote Google Fonts links; extension pages use system fonts.
- Inherited WXT's generated TypeScript configuration and enabled unused-local/parameter checks.
- Used native timer promises, Vitest async timers and observable waits, table-driven relay tests, and Selenium expected conditions. Removed redundant getter tests and comments that repeated the code.
- The Firefox rerun exposed a stale-element race in its custom startup wait. Selenium's built-in text condition fixed it; all seven scenarios then passed.

The preceding passes replaced manual listener teardown with AbortController/Svelte lifecycle ownership, drag ownership with pointer capture, bespoke test infrastructure with WXT's Vitest support, and redundant scans/parsing with native DOM, URL and array APIs. No runtime dependency was added.

## Deliberately retained custom code

| Code | Reason |
| --- | --- |
| Shadow traversal | Native selectors do not traverse separate shadow roots; Hare also supports closed roots through extension APIs and skips its own UI. The traversal is iterative and the DOM tree is acyclic. |
| Controller geometry | Dragging and hit testing must translate scaled/bordered/scrolled player coordinates and respect the media bounds. Pointer capture handles pointer ownership. |
| Cross-frame bridge | DOM input events do not propagate across cross-origin frames. A small direct-parent protocol forwards a specific controller action. |
| Sync state | Offset policy, asynchronous rollback, stale-session rejection, echo suppression and drift correction are extension behavior, not generic utility implementations. |
| Request timeout | Extension messaging promises cannot be cancelled with AbortSignal. Promise.race supplies a bounded result and clears its timer. |
| Settings normalization | Bounds, exclusion syntax, shortcuts and migration behavior are project policy; a schema dependency would not remove that policy. |
| Offline media fixture | A few Node Buffer writes make deterministic silent PCM without a new dependency or a large binary. The local HTTP fixture supports the byte ranges the browser needs. |

## Verification

The release cleanup removed 19 standalone tests already covered by retained behavioral regressions, consolidated drift/failure cases, and removed or shortened redundant comments. The retained tests cover buffering, lifecycle, failure and race behavior. An unreachable playback-rate fallback was also removed.

- Svelte/TypeScript: zero errors and zero warnings; **123 unit tests passed** after cleanup (142 before removing redundant cases).
- Production Chrome and Firefox MV3 builds and version **1.7.0** packages succeeded.
- Dedicated Ubuntu VM: **45 Chromium extension tests passed**, including axe accessibility checks; **7 native Firefox tests passed** after fixing the startup wait.
- System-font popup, settings, narrow shortcut layout and sync screenshots inspected. Full-page/element captures can include a fixed footer within the captured region; viewport-width assertions and actual interaction checks also pass.
- All five PNG assets decode with the declared dimensions. Synthetic VP8 fixture metadata and browser playback verified.
- npm audit: **zero vulnerabilities**; npm dependency tree resolves without errors.
- ZIP integrity, manifest version, source allowlist and absence of remote font references checked.
- A clean `npm ci` and Firefox build from the source ZIP matched all 16 packaged extension files by SHA-256. `git diff --check` passed.

Browser versions: Chromium 143.0.7499.4 and Firefox 156.0.1, headed under Xvfb in the dedicated Hyper-V Ubuntu VM. Browser tests use isolated profiles; the VM is shut down. Live authenticated/DRM services, native Windows Firefox/Edge and browser-store deployment were not exercised. Site-handler selector review does not establish compatibility with every live service.

Release verification logs and native Firefox evidence are under ignored `local/release-evidence/`, with local check/package/rebuild logs prefixed `local/release-`. Earlier buffering logs, package hashes and source manifest remain in `local/buffering-evidence/`; `local/buffering-before.log` and `local/buffering-evidence/buffering-fatal-before.log` preserve the failures before repair. This audit accompanies the 1.7.0 release preparation; the release workflow gates packaging on checks and validates the tag against the package version.

## File-by-file inventory

**93 current authored files reviewed.** Deleted files are listed separately below.

| File | Review result |
| --- | --- |
| `.github/workflows/build-and-release.yml` | Release gate, version check, permission scope, package selection. |
| `.github/workflows/checks.yml` | Shared checks, isolated browser suite, audit, failure artifacts. |
| `.gitignore` | Generated output, local profiles, evidence and secrets excluded. |
| `LICENSE` | MIT license retained. |
| `README.md` | Usage/build instructions and browser coverage reconciled with current audit. |
| `assets/controller.css` | Removed unreachable external-ancestor selector and redundant comments; shadow styles verified. |
| `assets/icon.svg` | Bundled vector markup reviewed; no scripts or external resources. |
| `assets/ui.css` | Shared native-control focus and reduced-motion styling retained. |
| `components/BlacklistEditor.svelte` | Native textarea and shared settings validation; error feedback retained. |
| `components/ControllerPreview.svelte` | Bundled icons and isolated shadow styles reused from actual controller. |
| `components/KeybindEditor.svelte` | Svelte event ownership and native numeric values; draft/escape/capture behavior covered. |
| `components/SpeedControl.svelte` | Native numeric input, commit/cancel and direct-action precedence. |
| `components/SyncMode.svelte` | Polling/cleanup, role selection, preserved Stop on errors, native numeric values. |
| `docs/IMPROVEMENTS-2026-09-25.md` | Historical evidence labeled and linked to current audit. |
| `docs/REVIEW.md` | Historical evidence labeled and linked to current audit. |
| `docs/SIMPLIFICATION-AUDIT.md` | Current completion record and exhaustive authored-file inventory. |
| `docs/VM-TEST-PLAN.md` | Historical evidence labeled and linked to current audit. |
| `docs/VM-VERIFICATION-2026-09-25.md` | Historical evidence labeled and linked to current audit. |
| `entrypoints/background.ts` | Routing, startup ownership and stale-session rejection. |
| `entrypoints/content.ts` | Removed unused route; native source/error listener cleanup and aligned-play seek avoidance verified. |
| `entrypoints/options/App.svelte` | Removed duplicate keyboard listener management; system fonts and draft persistence. |
| `entrypoints/options/index.html` | Removed remote font loading; local bundled entry point only. |
| `entrypoints/options/main.ts` | Standard Svelte mount and shared stylesheet import. |
| `entrypoints/popup/App.svelte` | System fonts, site actions, frame aggregation and native array operations. |
| `entrypoints/popup/index.html` | Removed remote font loading; local bundled entry point only. |
| `entrypoints/popup/main.ts` | Standard Svelte mount and shared stylesheet import. |
| `lib/async-utils.test.ts` | Timeout and rejection cleanup behavior. |
| `lib/async-utils.ts` | Promise.race timeout retained for uncancellable extension requests. |
| `lib/browser-detect.ts` | Only used observer feature checks remain. |
| `lib/constants.ts` | Removed arbitrary shadow depth cap; used bounds/timing values retained. |
| `lib/controller-icons.ts` | Shared bundled SVG source retained. |
| `lib/controller.test.ts` | Playback enforcement, mounting and destruction; retained behavioral regressions. |
| `lib/controller.ts` | AbortController listener lifetime, native pointer capture, bounds and positioning repair. |
| `lib/cross-frame-pointer.ts` | AbortController cleanup; direct-parent hitmap protocol and geometry retained. |
| `lib/keybinds.test.ts` | Typing/modifiers/composition and action routing. |
| `lib/keybinds.ts` | Native composed event path/capture and listener cleanup; frame forwarding remains necessary. |
| `lib/logger.ts` | Removed obvious and outdated comments; development-only debug logging. |
| `lib/media-detector.test.ts` | Existing deep-shadow case strengthened to 64 roots; red before fix, green after. |
| `lib/media-detector.ts` | Iterative traversal simplified to Node stack; no artificial depth cutoff. |
| `lib/messages.ts` | Unused messages and redundant section comments removed. |
| `lib/observer-pool.test.ts` | Native timer promise replaces hand-built delay; real observer lifecycle assertions. |
| `lib/observer-pool.ts` | Root-specific observer disposal and batched discovery retained. |
| `lib/safe-media.test.ts` | VOD and disjoint live seek ranges plus native property access. |
| `lib/safe-media.ts` | Native media accessors and live/VOD seek clamping retained. |
| `lib/settings.test.ts` | Storage boundaries, defaults, validation and site exclusion behavior. |
| `lib/settings.ts` | Single normalization boundary, native URL parsing, quota checks and policy matching. |
| `lib/shadow-dom.ts` | Uses WXT browser API plus Firefox content-script property and standard open root. |
| `lib/site-handlers/amazon.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/base.ts` | Native closest selector and fallback positioning. |
| `lib/site-handlers/crunchyroll.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/dailymotion.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/disney.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/facebook.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/hbomax.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/index.ts` | Removed redundant hostname parsing/caching; existing handler priority retained. |
| `lib/site-handlers/netflix.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/reddit.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/tiktok.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/twitch.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/twitter.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/utils.test.ts` | Consolidated domain/subdomain cases; boundary rejection retained. |
| `lib/site-handlers/utils.ts` | Native hostname and explicit subdomain boundary matching. |
| `lib/site-handlers/vimeo.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/site-handlers/youtube.ts` | Native closest selectors; simplified boolean queries where equivalent; mount priority retained. |
| `lib/sync-agent.test.ts` | Behavior regressions for readiness, stalled vs buffered media, cancelled play and coalesced seeks. |
| `lib/sync-agent.ts` | Native readiness events; coalesced seeks, stale play rejection and deliberate pause ownership verified. |
| `lib/sync-coordinator.test.ts` | Native async timers and WXT storage fake; buffering/restart/polling/metadata race regressions. |
| `lib/sync-coordinator.ts` | Persisted buffering recovery, bounded polling and current-pair metadata; simplified side-based timers. |
| `lib/sync-startup.test.ts` | Waits for observable calls instead of counting microtasks; rollback/cancellation coverage. |
| `lib/sync-startup.ts` | Promise.allSettled ensures late activation rollback; serialized replacement retained. |
| `lib/sync-types.ts` | Used protocol/state types and timing policy. |
| `lib/tab-media.ts` | Bounded frame discovery/message calls and native status aggregation. |
| `lib/types.ts` | Removed unused message variant; shared contracts checked against senders/receivers. |
| `package-lock.json` | Machine-validated npm dependency tree, audit and clean install; generated lock retained. |
| `package.json` | Scripts/engines and direct dependencies validated by install, checks and packaging. |
| `playwright.config.ts` | Native Playwright server/fixture/reporting and first-failure traces. |
| `public/icons/icon128.png` | PNG decoded successfully; dimensions match filename; shared icon visually inspected. |
| `public/icons/icon16.png` | PNG decoded successfully; dimensions match filename; shared icon visually inspected. |
| `public/icons/icon19.png` | PNG decoded successfully; dimensions match filename; shared icon visually inspected. |
| `public/icons/icon38.png` | PNG decoded successfully; dimensions match filename; shared icon visually inspected. |
| `public/icons/icon48.png` | PNG decoded successfully; dimensions match filename; shared icon visually inspected. |
| `tests/e2e/adversarial.spec.ts` | Native MediaSource starvation/decode errors, buffering worker restart and controlled fault injections. |
| `tests/e2e/extension.spec.ts` | Shared fixture, native assertions/waits and behavior regressions; unused import removed. |
| `tests/e2e/fixtures/MEDIA.md` | Synthetic fixture provenance and reproducible FFmpeg command. |
| `tests/e2e/fixtures/extension.ts` | Playwright fixture owns temporary profiles, extension pages and teardown. |
| `tests/e2e/fixtures/motion.webm` | Decoded by browsers; ffprobe confirms VP8, 160x90, 12 seconds. |
| `tests/e2e/fixtures/video.html` | Offline media, shadow/iframe/editor fixtures; no remote fixture dependency. |
| `tests/e2e/server.mjs` | Small local HTTP/PCM fixture; native Node APIs, deliberate narrow range support. |
| `tests/native/README.md` | Isolated native Firefox reproduction and coverage limits. |
| `tests/native/firefox_e2e.py` | Selenium waits/expected conditions; reproduced and fixed stale-element startup race. |
| `tsconfig.json` | Extends WXT generated configuration; unused locals/parameters now checked. |
| `vitest.config.ts` | WXT Vitest plugin replaces handwritten import/storage setup. |
| `wxt.config.ts` | Build inputs allowlisted for source archive; manifests and packaging checked. |

## Deleted files

| File | Reason |
| --- | --- |
| `assets/animations.css` | Unused animation library; no imports or class references. |
| `assets/variables.css` | Unused token stylesheet; no imports or variable use. |
| `lib/browser-detect.test.ts` | Tested removed compatibility wrappers rather than meaningful extension behavior. |
| `lib/frame-detection.test.ts` | Redundant low-value frame-detection checks; real cross-origin browser coverage retained. |
| `tests/__mocks__/wxt-imports.ts` | WXT Vitest plugin supplies the imports and browser test support. |
| `tests/repro-playback.html` | Obsolete remote-media manual reproduction; deterministic automated media regressions cover the behavior. |
