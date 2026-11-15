// node readme/capture.cjs <hare checkout> : raw 2x screenshots of the built extension into readme/inputs/
// Build the extension first (`npm run build` in the checkout). Uses the e2e fixture page as the video site.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hareCheckout } = require('../lib.cjs');

const hare = hareCheckout(process.argv[2]);
const ext = path.join(hare, '.output/chrome-mv3');
const out = path.join(__dirname, 'inputs');
// A neutral host name instead of 127.0.0.1 in the popup header and tab list.
const site = 'http://watch.example:41739/video.html';
const tabs = [['Grand Prix replay: onboard camera', '#e2574c'], ['Grand Prix replay: live commentary', '#3aa675']];
const favicon = color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/></svg>`);

async function capture(scheme) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hare-capture-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, colorScheme: scheme, deviceScaleFactor: 2,
    args: ['--host-resolver-rules=MAP watch.example 127.0.0.1', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const videos = [];
    for (const [title, color] of tabs) {
      const page = await ctx.newPage();
      await page.goto(site);
      await page.locator('hare-controller').waitFor({ state: 'attached' });
      await page.evaluate(([title, href]) => {
        document.title = title;
        document.head.append(Object.assign(document.createElement('link'), { rel: 'icon', href }));
      }, [title, favicon(color)]);
      videos.push(page);
    }
    const [a] = videos;
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await a.bringToFront();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('button', { name: 'Set speed to 1.5×', exact: true }).click();
    await popup.waitForFunction(() => document.querySelector('input[aria-label="Playback speed"]').value === '1.50');
    await a.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
    const shot = async name => {
      await popup.mouse.move(350, 590);
      await popup.evaluate(() => document.fonts.ready);
      await popup.locator('.popup').screenshot({ path: `${out}/${name}-${scheme}.png`, animations: 'disabled' });
    };
    await shot('popup');

    await popup.getByRole('button', { name: 'Sync Mode' }).click();
    const candidates = popup.locator('.candidate');
    await candidates.nth(1).waitFor();
    await candidates.nth(0).click();
    await candidates.nth(1).click();
    await popup.getByRole('button', { name: 'Start Sync' }).waitFor();
    await shot('sync-setup');

    if (scheme === 'light') {
      // The live on-page controller at 1.50x; build.cjs draws it expanded on the video mock.
      const html = await a.locator('hare-controller').evaluate(({ shadowRoot }) =>
        `<style>\n${shadowRoot.adoptedStyleSheets.flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n')}\n</style>\n${shadowRoot.innerHTML}`);
      if (!html.includes('1.50x')) throw new Error('Controller is not at 1.50x');
      fs.writeFileSync(`${out}/controller.html`, html + '\n');
    }

    const options = await ctx.newPage();
    await options.setViewportSize({ width: 1040, height: 700 });
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByRole('checkbox', { name: /Enable Hare/, checked: true }).waitFor();
    await options.getByRole('button', { name: 'Expanded' }).click();
    await options.getByRole('button', { name: 'Expanded', pressed: true }).waitFor();
    await options.evaluate(() => document.fonts.ready);
    await options.screenshot({ path: `${out}/settings-${scheme}.png`, animations: 'disabled' });
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

(async () => {
  const server = spawn(process.execPath, ['tests/e2e/server.mjs'], { cwd: hare, stdio: 'inherit' });
  try {
    for (let i = 0; ; i++) {
      try { await fetch('http://127.0.0.1:41739/video.html'); break; } catch (e) { if (i > 50) throw e; await new Promise(r => setTimeout(r, 100)); }
    }
    for (const scheme of ['light', 'dark']) await capture(scheme);
  } finally {
    server.kill();
  }
})();
