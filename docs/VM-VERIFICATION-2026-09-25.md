# VM verification and improvements — September 25, 2026

> Historical record. See the [completed simplification audit](SIMPLIFICATION-AUDIT.md) for the current file inventory, changes, and verification results.

Hare was built, installed, exercised, deliberately disrupted, fixed, and retested inside a dedicated Hyper-V VM. The final run passed **44 Chromium extension scenarios, 6 native Firefox scenarios, and 148 unit tests**. Svelte/TypeScript reported **0 errors and 0 warnings**, both production builds succeeded, and `npm audit` reported **0 vulnerabilities**.

## Environment

| Component | Tested environment |
| --- | --- |
| VM | `Hare-E2E-2026`, Hyper-V Generation 2, 4 CPUs, 2–5 GB dynamic RAM, 24 GB virtual disk |
| Guest | Ubuntu 24.04.5 LTS, Linux 6.8.0-139-generic, `systemd-detect-virt` = `microsoft` |
| Node / npm | 24.16.0 / 11.13.0 |
| Chromium | Chrome for Testing 143.0.7499.4, Playwright 1.57, production MV3 build |
| Firefox | Native Firefox 156.0.1, geckodriver 0.37.1, Selenium 4.49.0, production Firefox MV3 build |
| Display | Headed browsers under Xvfb, isolated temporary profiles |

The Ubuntu boot image and Node distribution were checked against their published checksums. No everyday browser profile was used. The existing unrelated VM was left untouched. The dedicated VM is retained for reuse and shut down after testing.

## Defects reproduced and fixed

| Defect | Reproduction | Improvement |
| --- | --- | --- |
| Inaccessible overflowing preview | The original VM baseline passed 24/25 tests; expanded appearance preview produced a serious axe `scrollable-region-focusable` violation | Preview and controls now wrap within the available width; original accessibility check passes without suppressing the rule |
| Buttons outside a small player | 24 px buttons overflowed a 320 × 180 player | Controller width follows the media bounds and buttons wrap without shrinking; verified in both browsers |
| Nudge selection forgotten | Choose 500 ms, close/reopen the popup, observe 100 ms | Validated nudge choices persist with the active sync session and reload from its status; status polling is serialized with changes |
| Stop silently ignored in an extension tab | Stop cleared the displayed sync state but the background retained the pair | Recognize messages from Hare's own extension pages, including pages with a tab ID; still reject stale Stop messages from unrelated content frames |
| Saved opacity displayed incorrectly | Save 0.65, restart the browser, see the slider round to 0.7 | Slider supports 1% increments and faithfully represents the saved value |
| Raw error on protected pages | Open the popup for a protected browser page whose URL is omitted by the browser | Show the explicit unsupported-page state without requesting additional permissions |

Earlier popup site controls, numeric shortcut editing, scaled dragging, and sync response validation are recorded in [the preceding improvement notes](IMPROVEMENTS-2026-09-25.md) and are included in the VM regressions.

## Coverage

| Area | Browser coverage |
| --- | --- |
| Speed and shortcuts | Speed up/down/reset, seek boundaries, decimal commit/cancel, presets, min/max/empty values, mixed speeds, page rate limiting, custom seek/reset values, capture/clear/duplicates/modifiers, force override, composition and editor protection |
| Settings | Fresh defaults, save/reload, live appearance, opacity precision, audio, hidden controller, enable/disable, conflicting editors, draft preservation/discard, invalid exclusions, oversized settings, reset/cancel, failed reads/writes/reset and retry |
| Site access | Exclude and restore an exact hostname, preserve broader/regex rules and unrelated settings, parent exclusions inherited by cross-origin media frames, target navigation, restricted pages |
| Overlay/media | Keyboard focus, hide/restore, large buttons in a small player, scaled/bordered dragging, narrow options, doubled CSS layout size, reduced-motion environment, nested shadow media, dynamic audio, repeated source replacement and enable cycles, cached-page return |
| Fullscreen/PiP | Actual VP8 video in picture-in-picture; keyboard speed control in native video fullscreen; visible controls in player-container fullscreen and after exit |
| Sync setup | Candidate discovery, select/deselect, swap roles, refresh, missing/closed tabs, cancel, failed activation, replacing an existing pair |
| Active sync | Play/pause, seek, rate, offsets in both directions, paused nudges, remembered step, Stop, partner close/source replacement, buffering recovery, deliberate pause, periodic drift correction |
| Recovery | Actual Chromium service worker termination followed by continued sync; browser process restart with saved settings and no stale session; stale content-frame Stop protection |
| Accessibility | Axe checks on popup, options, and exclusion state; keyboard controls; responsive checks at 320/390 px and doubled layout size |

The six native Firefox scenarios cover keyboard/editor behavior, popup speed/site controls, settings/reset/audio, cross-origin iframe exclusions, small-player/source lifecycle, and sync start/rate/seek/play/pause/nudge/stop. Firefox is actually running the installed add-on; this is more than a build check.

Storage failures, buffering events, page rate limits, and follower displacement are controlled fault injections into real browser contexts. They are not evidence of a real network outage or a particular streaming service's DRM behavior. Autoplay rejection and several cancellation/race branches also retain unit coverage; a native autoplay-policy matrix was not exercised.

Popup pages are mounted in extension tabs while the media tab is active, then brought forward for interaction. This verifies application logic and tab targeting, not toolbar popup placement. Native Firefox/Edge on Windows, live/DVR streams, authenticated streaming services, browser-store updates, and cross-device account synchronization are outside this fixture run. No release was published. No finite suite proves every possible website or browser state.

## Reproduction

In a Linux guest with Node 24 and the repository installed:

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
HARE_HEADED=1 xvfb-run -a npx playwright test --workers=1 --reporter=list
npm audit
```

See [native Firefox instructions](../tests/native/README.md) for its separate WebDriver suite. The Chromium shared fixture is in `tests/e2e/fixtures/extension.ts`; adversarial regressions are in `tests/e2e/adversarial.spec.ts`. The synthetic video fixture has [generation instructions](../tests/e2e/fixtures/MEDIA.md). Playwright retains first-failure traces even without a retry.

## Saved evidence on this workstation

- Final logs, browser metadata and screenshots: `local/vm-verification/vm-evidence/`.
- Portable final evidence archive: `local/final-vm-evidence.tar.gz`.
- Before-fix archives: `local/vm-baseline-evidence.tar.gz` and `local/vm-adversarial-before-evidence.tar.gz`.
- Tested code/test archive: `local/hare-updated-source.tar.gz`, SHA-256 `0288207526d7d63ab4c417e2799233638f5d594219c26670d720b4ad84fcbf68`.
- VM disk and setup artifacts: `C:\Users\Antho\Downloads\Hare-VM-Verification`.

The source snapshot covers extension code and tests; documentation was completed after the run. Final evidence excludes browser profiles. Local artifacts are ignored by Git. Popup, desktop preview, small-player controls, and native Firefox media screenshots were inspected. Full-page screenshots can include fixed footers at their viewport position; use the browser assertions and viewport captures when assessing those controls.

Final commands completed successfully without retries. `git diff --check` passed. Source changes are local and uncommitted.
