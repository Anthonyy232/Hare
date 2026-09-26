# VM exploration plan

> Historical record. See the [completed simplification audit](SIMPLIFICATION-AUDIT.md) for the current file inventory, changes, and verification results.

Goal: run the built extension inside an isolated VM, explore its user flows and failure recovery, reproduce defects, and verify improvements in that VM.

Completed results and coverage limits are recorded in [the VM verification report](VM-VERIFICATION-2026-09-25.md).

## Environment and evidence

- Dedicated Hyper-V VM, Ubuntu 24.04 cloud image verified against Canonical's SHA-256 checksum.
- Build from the current working tree, including the preceding local improvements.
- Real Chromium extension contexts inside the guest; headed runs under a virtual display.
- Keep guest OS/browser versions, command logs, regression results, screenshots, and a final coverage report.
- Inspect native Firefox support if the guest can run the packaged extension; do not describe a Firefox build as a browser test.

## Flow inventory

| Area | Normal paths | Adversarial/recovery paths |
| --- | --- | --- |
| Installation and persistence | Fresh defaults, options/popup, reload, browser restart | Disabled extension, restricted page, unavailable content script, service worker restart |
| Speed | Presets, custom values, Enter/blur, reset, distinct shortcut steps | Empty/invalid/out-of-range values, rapid actions, rejected rates, multiple media with different rates |
| Keyboard | All actions, binding capture/clear, custom values, force | Duplicate keys, modifiers, composition, held keys, nested editors/shadow inputs, Enter/Escape drafts |
| Settings | Save, live appearance preview, audio, start hidden, enable | Load/write failures, reset/cancel, conflicts between open editors, unfinished numeric edits, invalid exclusions, oversized data |
| Site access | Exact domain disable/restore, embedded media, navigation | Broader/regex exclusions, stale popup, failed save/retry, globally disabled state |
| Overlay | Hide/restore, focus expansion, dragging, fullscreen | Scaling, borders, resizing, small players, large text/buttons, player reparenting, DOM removal, direct shadow children |
| Media lifecycle | Video and audio, dynamic insertion, source replacement | Delayed sources, failed media, nested/cross-origin frames, shadow roots, cached page return, repeated enable/disable |
| Sync setup | Candidate scan, A/B selection, swap, start, cancel, refresh | Fewer than two candidates, disappearing tabs, activation failure, rapid replacement/start/stop |
| Active sync | Play/pause, rate, seek, offset in both directions, stop | Drift, buffering, autoplay rejection, paused nudges, page navigation/close, media replacement, worker restart, browser restart |
| Accessibility/layout | Keyboard traversal, focus, readable states, narrow options, popup height | Zoom, reduced motion, screen-reader labels, hidden/focused controller, error/status announcements |

The final report will distinguish coverage of real media/browser behavior from injected failure conditions and fixture approximations of service-specific DOMs. Paid-service accounts and DRM playback cannot be inferred from local tests.
