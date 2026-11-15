// node releases/banner.cjs <hare checkout> [<version> "<highlight>"] : 1280x640 release banners in releases/
const fs = require('fs');
const { chromium, fonts, logo, hareCheckout, render } = require('../lib.cjs');
const dir = __dirname;
const file = `${dir}/banners.json`;
const banners = JSON.parse(fs.readFileSync(file, 'utf8'));
const [hare, version, highlight] = process.argv.slice(2);
const mark = logo(hareCheckout(hare));
if (version) {
  banners[version] = highlight;
  fs.writeFileSync(file, JSON.stringify(banners, null, 2) + '\n');
}

const html = (v, text) => `<!doctype html><meta charset="utf-8">${fonts}
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 640px; overflow: hidden; display: grid; grid-template-columns: 1fr 470px; background: #f5f3ee; color: #1c1b18; font-family: system-ui, sans-serif; }
  .copy { padding: 64px 40px 60px 80px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .brand svg { width: 36px; height: 36px; }
  .num { margin-top: auto; font: 500 18px ui-monospace, 'Cascadia Code', monospace; color: #615d55; }
  h1 { margin: 14px 0 0; font: 400 96px/1 'Instrument Serif', Georgia, serif; letter-spacing: -0.01em; text-wrap: balance; }
  h1 i { color: #2563eb; }
  .stage { position: relative; margin: 40px 40px 40px 0; border-radius: 24px; overflow: hidden; display: grid; place-items: center;
    background: radial-gradient(60% 80% at 12% 8%, #9dc0ff 0%, transparent 70%), radial-gradient(55% 70% at 92% 20%, #5b93f8 0%, transparent 70%), radial-gradient(70% 70% at 55% 115%, #2f6df0 0%, transparent 65%), #c9dcff; }
  .stage svg { width: 230px; height: 230px; }
  .stage svg g { fill: #fff; }
</style>
<div class="copy">
  <div class="brand">${mark}Hare</div>
  <div class="num">Release ${v}</div>
  <h1>${text}</h1>
</div>
<div class="stage">${mark}</div>`;

// The last word carries the accent, as the README headlines do with one word.
const accent = text => text.replace(/(\S+)$/, '<i>$1</i>');

(async () => {
  const browser = await chromium.launch();
  for (const [v, text] of version ? [[version, highlight]] : Object.entries(banners)) {
    await render(browser, html(v, accent(text)), `${dir}/v${v}.png`, { width: 1280, height: 640 });
  }
  await browser.close();
})();
