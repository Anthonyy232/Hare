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
  - `V` - Show/hide the controller
- **Visual Controller**: Draggable on-screen speed display
- **Site-Specific Handlers**: Tuned for YouTube, Netflix, Prime Video, Disney+, Twitch, and 10 more sites
- **Audio Support**: Optional audio element speed control
- **Excluded Sites**: Exclude domains (including subdomains), pasted URLs, or regular expressions
- **Synced Settings**: Settings follow you across devices through your browser's sync
- **Sync Mode**: Pair media in two tabs, or a tab and [mpv](https://mpv.io), preserving their starting offset while coordinating playback, seeking, and speed
- **Open in Video Player**: Hand the current video to your desktop player

## Browser Support

- **Firefox**
- **Chrome** and other Chromium browsers such as Edge (Edge isn't tested separately)

Safari isn't supported.

## Installation

**Firefox:** Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/hare-video-controller/).

**Chrome/Edge:** Hare isn't in the Chrome Web Store, so install it unpacked. It won't update itself; repeat these steps for a new version.

1. Download `hare-<version>-chrome.zip` from the [latest release](https://github.com/Anthonyy232/Hare/releases/latest)
2. Extract the ZIP file
3. Open `chrome://extensions/` (or `edge://extensions/`)
4. Enable "Developer mode"
5. Click "Load unpacked"
6. Select the extracted folder

Reload pages that were already open. Browser settings pages and some protected pages can't run extensions. For local files, allow file access in the extension's details.

## Usage

Open any page with HTML5 video/audio and use the keyboard shortcuts, or click the extension icon for the popup. Shortcuts are single keys without modifiers and do nothing while you type in a text field. The popup applies a speed to all media in the current tab; some players reject speeds or allow a narrower range.

On an excluded site, **Use Hare on this site** in the popup removes that site's exclusion. Broader domain or regular expression rules stay and can be edited in Settings.

### Sync Mode

Load media in two different tabs and cue each to the moment you want to pair. Select tab A, then tab B (**Swap A / B** changes their roles). A sets the playback speed and play/pause state; B keeps its starting offset, which you can fine-tune with the offset buttons. Closing a paired tab, replacing its media, or turning Hare off ends the session. Each tab syncs one video, preferring playing media and then the larger player.

To sync with mpv, open **Sync with mpv** in the Sync Mode list, download [hare.lua](public/hare.lua), and move it to mpv's scripts folder (`%APPDATA%\mpv\scripts` on Windows, `~/.config/mpv/scripts` on macOS and Linux). After that, any video you open in mpv appears in the list. The script needs an mpv build that uses LuaJIT, which most do. Only one mpv window can be paired at a time, and opening another file in mpv ends the session. The script listens on `127.0.0.1:42730` and only answers requests from browser extensions.

### Open in Video Player

**Open in video player** at the bottom of the popup saves `hare.m3u` to your Downloads folder and opens it with your default player for `.m3u` files. It points to the video file, or to the HLS/DASH stream the page plays, such as on Twitch, Kick, Patreon, and PeerTube. For protected or site-specific formats, such as YouTube and Vimeo, it points to the page itself, which players that resolve sites (such as mpv with yt-dlp) can play. The playlist also tells the player where to start and which site the video is from, which some hosts, such as Patreon's, require. VLC reads these on its own; mpv needs [hare.lua](public/hare.lua).

Video calls and screen shares can't be opened. The first use asks for permission to manage downloads. Firefox doesn't let Hare open the file itself, so click `hare.m3u` in the downloads panel.

### Settings

- **Core Settings**: Turn Hare on or off, include audio-only media, or start with the controller hidden
- **Controller Display**: Opacity and button size, with a live preview
- **Keybindings**: Each shortcut's key and amount; **Override site shortcut** wins when a site uses the same key
- **Excluded Sites**: Domains, URLs, or `/regular expressions/`, also applied to players embedded in those pages. Defaults: Instagram, X/Twitter, Imgur, Teams, and Google Meet

Click **Save Settings** to apply changes to open pages.

## Building From Source

For Firefox add-on review. Release packages are built on Ubuntu with Node.js 24 and npm 11, as in Mozilla's default reviewer environment ([install Node.js](https://nodejs.org/en/download) if needed). In the extracted source archive, run:

```bash
npm ci
npm run build:firefox
```

The extension is built to `.output/firefox-mv3/` and matches the submitted package. `npm ci` installs the exact versions in `package-lock.json` from the public npm registry; no credentials are needed.

## Contributing

Contributions are welcome. Changes are made with coding agents; point yours at [AGENTS.md](AGENTS.md) and open a pull request.

## License

[MIT](LICENSE)

## Acknowledgments

- Based on [videospeed](https://github.com/igrigorik/videospeed) by Ilya Grigorik
