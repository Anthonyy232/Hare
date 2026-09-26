# Native Firefox end-to-end tests

The suite installs the production Firefox build in an isolated temporary profile, exercises real WebExtension APIs and media, and discards the profile on exit. No everyday browser profile is used. Selenium's system-access flag is needed to open the extension's options page; the tests do not change host browser settings.

```sh
npm ci
npm run build:firefox
python3 -m venv .venv-firefox
.venv-firefox/bin/pip install selenium==4.49.0
FIREFOX_BINARY=/path/to/firefox xvfb-run -a .venv-firefox/bin/python tests/native/firefox_e2e.py
```

On a desktop with a display, omit `xvfb-run -a`. Selenium Manager resolves geckodriver. The Node fixture server uses port 41739. Results and screenshots go to ignored `test-results/firefox`, or `HARE_FIREFOX_RESULTS` if set. The popup is mounted in an inactive extension tab while its media tab is active, then brought forward for interaction. This tests popup code and targeting but not browser toolbar placement.
