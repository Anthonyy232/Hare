# Local media fixtures

The HTTP server generates silent PCM for deterministic seeking and long-running sync tests.

`motion.webm` is a synthetic moving test pattern, generated in the test VM with FFmpeg. It exercises actual video-track rendering, fullscreen, and picture-in-picture without remote assets or copyrighted footage.

Regenerate it with:

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 12 -c:v libvpx -b:v 60k -an -y tests/e2e/fixtures/motion.webm
```
