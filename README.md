# Hare

Control HTML5 video/audio playback speed with keyboard shortcuts

## Features

- **Speed Control**: Adjust playback speed from 0.07x to 16x
- **Quick Presets**: Choose 0.75x, 1x, 1.25x, 1.5x, or 2x in one click
- **Keyboard Shortcuts**: Fully customizable keybindings
  - `S` - Decrease speed (-0.1x)
  - `D` - Increase speed (+0.1x)
  - `R` - Reset speed to 1.0x
  - `Z` - Rewind 10 seconds
  - `X` - Advance 10 seconds
  - `V` - Toggle display visibility
- **Visual Controller**: Draggable on-screen speed display
- **Site-Specific Handlers**: Optimized for YouTube, Netflix, Disney+, Twitch, and 10+ more platforms
- **Audio Support**: Optional audio element speed control
- **Excluded sites**: Exclude domains (including subdomains), pasted URLs, or regular expressions
- **Persistent Settings**: Synced across devices
- **Sync Mode**: Pair media in two tabs, preserving their starting offset while coordinating playback, seeking, and speed

## Browser Compatibility

| Browser | Support     | Manifest |
| ------- | ----------- | -------- |
| Chrome / Chromium | Automated extension tests | V3 |
| Firefox | Automated native Firefox tests | V3 |
| Edge | Uses the Chromium build; not separately tested | V3 |

Safari packaging and playback are not validated by this repository.

## Installation

### Manual Installation (Development)

**Chrome/Edge:**

1. Download the latest release
2. Extract the ZIP file
3. Open `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the extracted folder

**Firefox:**

1. Download the latest release
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file

## Usage

Navigate to any page with HTML5 video/audio and use keyboard shortcuts to control playback speed. Click the extension icon to access the popup interface, or open Settings to customize keybindings and preferences.

Type a complete speed in the popup and press Enter or leave the field to apply it. The popup shows the rate reported by the player; some players reject speeds or impose narrower limits. Changes apply to all detected media in the current tab. Keyboard shortcuts use physical keys without modifiers and leave text editors and form fields alone.

Presets highlight the actual playback speed. No preset is selected for a custom rate or when players have different speeds. Choosing a speed button replaces an unfinished custom value. The popup identifies the current site and provides Settings in its header.

Use **Exclude this site** in the popup to turn off Hare for the current hostname and its subdomains, including embedded players. **Use Hare on this site** removes that hostname's exclusion and restores controls immediately. Broader domain or regular expression rules stay intact and can be edited in Settings. If Hare is turned off globally, the popup offers **Enable Hare**.

To use Sync Mode, load media in two different tabs and cue each to the moment you want to pair. Select tab A, then tab B. A supplies the playback speed and play/pause state; B retains its starting offset. Use the offset buttons to fine-tune B. Closing a paired tab, replacing its media source, or disabling Hare ends the session. Sync is for one primary loaded media element per tab, preferring playing media and then the larger player.

Use **Swap A / B** before starting to change their roles. Deselect a selected tab before choosing a different pair.

### Configuration

- **Keyboard Shortcuts**: Customize in Settings
- **Shortcut Values**: Press Enter to apply a numeric edit, or Escape to cancel it before saving
- **Excluded sites**: Add domains to exclude; exclusions also apply to embedded players on those pages (defaults include Instagram, Twitter/X, Imgur, Teams, and Google Meet)
- **Controller Appearance**: Adjust opacity and button size with a live preview of the resting and expanded controller; save to apply changes to videos
- **Audio Control**: Enable/disable audio speed control
- **Hidden Mode**: Start with controller hidden

Save settings to apply changes to existing pages. Failed saves preserve the draft and provide a retry. The popup's **Show / hide controller** button restores a hidden controller even when its keyboard shortcut is unbound. Browser settings pages and some protected pages cannot run extensions; reload existing webpages after installing or updating Hare. Local files also require enabling file access in the browser's extension details.

## Development

### Prerequisites

- Node.js 22.12+ (Node 24 LTS recommended)
- npm

### Setup

```bash
git clone https://github.com/Anthonyy232/Hare.git
cd Hare
npm ci

# Start development server (Chrome)
npm run dev

# Start development server (Firefox)
npm run dev:firefox
```

Development uses WXT's manual browser runner. Load the printed development output folder into a separate browser profile once; WXT then rebuilds as you edit. Automatic browser launching is an optional WXT integration and is not bundled here.

### Project Structure

```
Hare/
├── entrypoints/        # Extension entry points
│   ├── background.ts   # Background service worker
│   ├── content.ts      # Content script (main logic)
│   ├── popup/          # Popup UI (Svelte)
│   └── options/        # Settings page (Svelte)
├── components/         # Reusable Svelte components
├── lib/                # Core logic
│   ├── controller.ts   # Video controller class
│   ├── settings.ts     # Settings management
│   ├── keybinds.ts     # Keyboard event handling
│   ├── tab-media.ts    # Shared frame discovery, messaging, and status aggregation
│   ├── sync-startup.ts # Pair activation, cancellation, and rollback
│   ├── sync-coordinator.ts # Session state and drift correction
│   ├── sync-agent.ts   # Per-media command execution and echo suppression
│   └── site-handlers/  # Site-specific handlers
├── assets/             # Icons and CSS
└── public/             # Static assets
```

### Tech Stack

- **Framework**: WXT (Web eXtension Tooling)
- **UI**: Svelte 5
- **Language**: TypeScript
- **Manifest**: V3

### Build

```bash
# Build for Chrome
npm run build
npm run zip

# Build for Firefox
npm run build:firefox
npm run zip:firefox
```

Build outputs:

- Chrome: `.output/chrome-mv3/`; ZIP under `.output/` with the package version
- Firefox: `.output/firefox-mv3/`; ZIP under `.output/` with the package version

### Firefox source review

Version 1.7.0 was verified on Windows 11 x64 and Ubuntu with Node.js 24.16.0 and npm 11.13.0. Release packages are built by GitHub Actions on Ubuntu with Node.js 24. Install Node.js from [nodejs.org](https://nodejs.org/en/download). Dependencies and build tools are pinned by `package-lock.json`.

Extract the matching source ZIP into a fresh directory, open a terminal in that directory, and run:

```bash
npm ci
npm run build:firefox
```

Compare all files under `.output/firefox-mv3/` with the contents of the submitted Firefox extension ZIP. Run `npm run zip:firefox` to package that output. ZIP container timestamps can differ; the extension files must match. Dependency installation requires access to the public npm registry. The build runs locally and needs no credentials or private dependencies.

Submit `.output/hare-1.7.0-firefox.zip` as the add-on and `.output/hare-1.7.0-sources.zip` as its matching source archive. See Mozilla's [source submission instructions](https://extensionworkshop.com/documentation/publish/source-code-submission/).

### Verification

```bash
npm run check             # Svelte/TypeScript, unit tests, Chrome and Firefox builds
npx playwright install chromium
npm run test:e2e          # Builds Chrome, then tests a separate temporary Chromium profile
npm audit
```

Browser tests use a local HTTP fixture with generated silent PCM media and a synthetic VP8 video, require no website accounts or external media downloads, and close their browser profiles after each test. They cover media events, seeking, editing, shadow DOMs, iframes, settings persistence/failure, fullscreen, picture-in-picture, sync, and browser/service-worker restart. Popup/options accessibility checks use axe. Reports and screenshots are written to `playwright-report/` and `test-results/`. Native Firefox testing has [separate instructions](tests/native/README.md).

Site-specific selectors and DRM restrictions still require checks against the actual services. Browser-native video fullscreen and picture-in-picture may not display a custom DOM overlay; keyboard or popup control and player-container fullscreen are covered.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License, please adhere.

## Acknowledgments

- Based on [videospeed](https://github.com/igrigorik/videospeed) by Ilya Grigorik
