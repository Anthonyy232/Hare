# Extension improvements — September 25, 2026

> Historical record. See the [completed simplification audit](SIMPLIFICATION-AUDIT.md) for the current file inventory, changes, and verification results.

This pass builds on the 1.6.0 review without changing the settings schema, extension permissions, or dependencies.

## Changes

- The popup can exclude the current hostname, restore an exact hostname exclusion, and enable Hare globally. Broader domain and regular expression exclusions remain under Settings. Writes read the latest saved settings, preserve unrelated fields, report failures, and can be retried. The popup refreshes its target tab's URL so navigation does not leave it showing an old site.
- Numeric shortcut edits accept Enter to commit and Escape to cancel. Cancelling an otherwise unchanged draft does not enable Save.
- Controller dragging uses the containing block's CSS coordinates, accounting for scaling, borders, scrolling, and the media's position inside its container. A browser regression reproduced the old error: a 60-pixel pointer movement moved the badge only about 47 pixels on a scaled player. It now follows the pointer and remains inside the video at both tested scales.
- Sync treats malformed position replies and missing command acknowledgements as failures. Repeated failures end the session instead of leaving a broken pair active.

## Verification

Final results: **147 unit tests and 25 Chromium extension tests passed**. Svelte/TypeScript reported **0 errors and 0 warnings**, Chrome and Firefox production builds succeeded, and `npm audit` reported **0 vulnerabilities**. `git diff --check` passed. Popup screenshots were inspected, and the browser suite's axe accessibility checks passed.

Validation covers Svelte/TypeScript, unit regressions, Chrome and Firefox production builds, isolated Chromium extension tests, popup accessibility, and dependency auditing. Browser cases cover exclusion and restoration of embedded media, preservation of other settings and regex rules, failed writes and retry, navigation, shortcut draft editing, and dragging in scaled and bordered players. The existing playback, sync, fullscreen, and lifecycle suite remains part of the checks.

Authenticated streaming services, arbitrary rotated or skewed player containers, and native Firefox/Edge interaction are not covered by these local browser fixtures. No release was published and no extension was installed into the user's everyday browser profile.
