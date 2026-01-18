# Hare

Control HTML5 video/audio playback speed with keyboard shortcuts

## Features

- **Speed Control**: Adjust playback speed from 0.07x to 16x
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
- **Blacklist**: Exclude specific domains from speed control
- **Persistent Settings**: Synced across devices

## Browser Compatibility

| Browser | Support     | Manifest |
| ------- | ----------- | -------- |
| Chrome  | ✅ Yes      | V3       |
| Firefox | ✅ Yes      | V3       |
| Edge    | ✅ Yes      | V3       |
| Safari  | 🟡 Partial* | V3       |

*Safari builds supported but require Xcode for App Store submission

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

### Configuration

- **Keyboard Shortcuts**: Customize in Settings
- **Blacklist**: Add domains to exclude (default: Instagram, Twitter/X, Teams, Google Meet)
- **Controller Appearance**: Adjust opacity and button size
- **Audio Control**: Enable/disable audio speed control
- **Hidden Mode**: Start with controller hidden

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/Hare.git
cd Hare
npm install

# Start development server (Chrome)
npm run dev

# Start development server (Firefox)
npm run dev:firefox
```

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

- Chrome: `.output/chrome-mv3/` → `hare-1.0.0-chrome.zip`
- Firefox: `.output/firefox-mv3/` → `hare-1.0.0-firefox.zip`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License, please adhere.

## Acknowledgments

- Based on [videospeed](https://github.com/igrigorik/videospeed) by Ilya Grigorik
