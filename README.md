# Hare media

Release banners for [Hare](https://github.com/Anthonyy232/Hare), kept off `main` so it stays light.

From a Hare checkout with dependencies installed:

```bash
git worktree add local/media media
node local/media/banner.cjs 1.11.0 "One short highlight"
```

That records the highlight in `banners.json` and writes `releases/v1.11.0.png` (1280x640). Without arguments it redraws every banner. Commit, push, and use the raw URL in the release notes:

`https://raw.githubusercontent.com/Anthonyy232/Hare/media/releases/v1.11.0.png`
