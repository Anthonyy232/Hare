# Hare review and fixes — September 12, 2026

The review covered all extension entry points, settings and message boundaries, media/controller lifecycle, frame bridges, sync coordination, Svelte UI, platform handlers, dependencies, and the existing tests. The original 93 unit tests passed, but did not exercise the Svelte UI or several lifecycle failures.

## Main issues fixed

| Area | Failure in the original code | Result |
| --- | --- | --- |
| Settings | Failed writes cleared dirty state and left Saving stuck; reads/watches accepted different schemas; defaults could be shared/mutated. | One normalization boundary, finite/clamped values, copied defaults, recoverable saves, strict editor loads, validated exclusions, and sync quota feedback. |
| Popup | Every input keystroke sent an asynchronous command; requested rates were displayed as though accepted; all unavailable states looked identical. | Commit complete values on Enter/blur, serialize commands against refreshes, read back actual rates, show mixed speeds, and explain disabled/excluded/unavailable states. |
| Keyboard | Nested editable content, shadow inputs, modifiers, composition, and repeated visibility toggles were mishandled. The reset target in Settings was ignored. | Respect editable/composing contexts and modifiers, suppress repeated toggles, honor the reset target, and reject invalid forwarded actions. |
| Media lifecycle | Initial/nested shadow roots were missed, removed roots retained observers, deferred listeners could survive disable, audio changes required reload, and cached pages never reactivated. | Shared iterative traversal, independently removable root observers, explicit cleanup, live audio updates, and pagehide/pageshow recovery. |
| Playback | A heuristic resumed legitimate user pauses. Seeking ignored DVR boundaries. Rejected rates could escape as exceptions. Opposite-direction buttons shared one setting. | Respect pauses, clamp seeks to available ranges/duration, handle rate rejection, and use each action's configured value. |
| Overlay | Keyboard focus did not reveal buttons; fullscreen repair could remove focus; mounts could be inside a video node; parent CSS changes persisted after disable. | Focus-accessible controls, stable fullscreen mounts, valid containers, reference-counted restoration of modified parent positioning, and compact feedback. |
| Frames | An embedded player could run on an excluded parent page; a forwarded pointer action affected every video in the child frame. | Inherit top-page exclusions, target the correct controller, validate geometry, and account for iframe borders/scaling. |
| Sync startup | Partial activation leaked agents; replacing a pair could deactivate newly created agents; UI ignored `{ success: false }`. | Separate startup transaction with rollback/cancellation, awaited prior deactivation, play/rate alignment, and actionable UI errors. |
| Sync lifecycle | Stale requests could affect a replacement session; storage operations could race; buffering recovery could override a deliberate pause; replaced media retained its old pair. | Session-identity checks, ordered persistence, bounded messaging, validated restoration, pause-aware buffering, and source-change teardown. |
| Quality | Type checking skipped Svelte; tests depended on remote media; production debug logging was enabled; dependency audit had 25 advisories. | Svelte plus test/config checks, local deterministic browser fixtures, production debug suppression, and updated dependencies with a clean audit. |
| Packaging | Source archives picked up ignored browser profiles and reports. | Explicit build-input allowlist for source ZIPs. |

## UI/UX follow-up

- Added one-click speed presets with actual-rate selection, mixed-speed handling, current-site context, and a compact Settings action in the popup header. Direct speed actions take precedence over an unfinished custom input.
- Added an isolated controller preview using the same stylesheet and icons as the real overlay. Opacity is displayed as a percentage; appearance drafts remain local until saved.
- Replaced the horizontally scrolling shortcut table with responsive, labeled rows that fit 320px windows, including key-capture mode. Renamed the ambiguous Force control to Override site shortcut and cancel capture when focus leaves its button.
- Made sync roles explicit with A/B markers, a selection count, role swapping, and deselection guidance. A third tab cannot silently replace the current pair. A compact speed panel keeps setup within the popup height; a named sync landmark supports screen-reader navigation.
- Prepared Firefox release 1.6.0 with reproducible reviewer build instructions. The preview creates DOM nodes directly, and Svelte uses its supported DOM-tree template mode, eliminating runtime `innerHTML` assignments from the extension pages.

## Architecture

The content script owns discovery and lifecycle within one frame. `ObserverPool` and `media-detector` share traversal. `VideoController` owns one media element and its overlay. `safe-media` centralizes native property access and seek validation. The frame bridge forwards a specific controller action.

`tab-media` centralizes bounded frame requests and status aggregation for the popup and background. `SyncStartup` owns activation and rollback, `SyncCoordinator` owns the current pair and drift correction, and `SyncAgent` applies commands to one media element without echoing them back. Session identity guards asynchronous work; ordered storage writes preserve the final state.

Settings retain the existing storage key and shape. No additional extension permissions, telemetry, remote assets, or runtime services were added. The existing site-specific handlers remain heuristics; this review does not claim live validation of their selectors on paid services.

Development uses WXT's supported manual runner. Its optional `web-ext` launcher was evaluated but omitted because its current linter dependency has unresolved `image-size` advisories; this also avoids shipping that unnecessary dependency tree. Load the development build in a separate profile to use hot reload.

## Verification and limits

Final functional run: **138 unit tests and 20 Chromium extension tests passed**, Svelte/TypeScript reported **0 errors and 0 warnings**, both browser builds succeeded, and the dependency review reported **0 vulnerabilities**. The UI/UX follow-up introduced no dependency changes.

Mozilla Add-ons Linter 10.12.0 reports **0 errors, 0 warnings, and 0 notices** for the Firefox 1.6.0 package. The matching source archive is verified by a fresh install and rebuild, comparing every generated extension file by SHA-256.

- Svelte/TypeScript checks cover extension code, components, tests, and config files.
- Unit regressions cover malformed settings, storage boundaries, keyboard ownership, controller cleanup, seek ranges, shadow lifecycle, startup rollback, stale sessions, buffering, and request timeouts.
- Isolated Chromium tests exercise the built extension, real native media events using generated PCM, cross-origin frames, failed saves, keyboard/decimal input, cached-page lifecycle, fullscreen, pair replacement, source changes, and sync failures.
- axe checks run on the popup, sync setup, and narrow settings layout; browser screenshots provide visual inspection. Browser regressions also cover presets, mixed rates, draft previews, narrow shortcut editing, and sync role selection.
- Chrome and Firefox MV3 builds are verified. Native Firefox/Edge interaction, Safari, authenticated streaming services, DRM, live production streams, and browser-native picture-in-picture are not covered by these local fixtures.
- Recovery from service-worker restart is exercised at the state-machine level. The browser suite does not forcibly terminate a live worker.

The implementation uses Chrome's documented [sync-storage item quota](https://developer.chrome.com/docs/extensions/reference/api/storage), the [page lifecycle persisted flag](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), and Playwright's [isolated Chromium extension workflow](https://playwright.dev/docs/chrome-extensions).

Run `npm run check`, `npm run test:e2e`, and `npm audit` to reproduce verification. This review does not publish or install the extension into the user's everyday browser profile.
