// node readme/build.cjs <hare checkout> : README hero and feature panels (light/dark) and site images, from readme/inputs/
const fs = require('fs');
const path = require('path');
const { chromium, fonts, logo, hareCheckout, render } = require('../lib.cjs');

const hare = hareCheckout(process.argv[2]);
const inputs = path.join(__dirname, 'inputs');
const readme = path.join(hare, '.github/readme');
const site = path.join(hare, 'site/img');
const store = path.join(__dirname, '../store');
const b64 = file => 'data:image/png;base64,' + fs.readFileSync(path.join(inputs, file)).toString('base64');
const mark = logo(hare);
// Drawn as if hovered: full opacity, buttons shown.
const controller = fs.readFileSync(path.join(inputs, 'controller.html'), 'utf8').replaceAll('.hare-controller:hover', '.hare-controller')
  + '<style>:host { position: static !important; }</style>';

const base = dark => `<!doctype html><meta charset="utf-8">${fonts}
<style>
  :root { --bg: ${dark ? '#171614' : '#f5f3ee'}; --ink: ${dark ? '#edeae3' : '#1c1b18'}; --muted: ${dark ? '#a09b90' : '#615d55'}; --line: ${dark ? '#edeae326' : '#1c1b1822'};
    --accent: ${dark ? '#8ab4ff' : '#2563eb'}; --key: ${dark ? '#211f1c' : '#fffefb'};
    --wash: ${dark
      ? 'radial-gradient(60% 80% at 15% 10%, #2f5fd0 0%, transparent 70%), radial-gradient(55% 70% at 90% 25%, #1b3a8f 0%, transparent 70%), radial-gradient(70% 70% at 60% 110%, #4f86f7 0%, transparent 65%), #14224a'
      : 'radial-gradient(60% 80% at 12% 8%, #9dc0ff 0%, transparent 70%), radial-gradient(55% 70% at 92% 20%, #5b93f8 0%, transparent 70%), radial-gradient(70% 70% at 55% 115%, #2f6df0 0%, transparent 65%), #c9dcff'}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: transparent; }
  body { width: 1280px; overflow: hidden; color: var(--ink); font-family: system-ui, sans-serif; }
  .card { position: relative; width: 1280px; overflow: hidden; border-radius: 28px; background: var(--bg); }
  .serif { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; }
  .serif i { color: var(--accent); }
  .stage { position: relative; overflow: hidden; background: var(--wash); }
  .shot { position: absolute; border-radius: 12px; box-shadow: 0 30px 70px -20px #0009, 0 0 0 1px #0000001a; }
  .keys { display: flex; gap: 8px; font: 600 15px ui-monospace, 'Cascadia Code', monospace; }
  .keys span { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line); border-bottom-width: 3px; border-radius: 7px; background: var(--key); }
  .video { position: absolute; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 70px -20px #0009;
    background: radial-gradient(ellipse at 80% 95%, #3d6475, transparent 70%), radial-gradient(ellipse at 15% 10%, #2b3f55, transparent 60%), linear-gradient(135deg, #1d2733, #16212b); }
  .bar { position: absolute; left: 24px; right: 24px; bottom: 22px; height: 4px; border-radius: 2px; background: #ffffff30; }
  .bar::before { content: ''; position: absolute; inset: 0 62% 0 0; border-radius: 2px; background: #fff; }
  #controller { position: absolute; left: 22px; top: 20px; zoom: 1.4; }
</style>`;
const controllerScript = `<script>
  document.querySelector('#controller div').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(controller)};
</script>`;

const hero = (dark, h = 760) => `${base(dark)}<style>
  .card { height: ${h}px;${h < 700 ? ' border-radius: 0;' : ''} text-align: center; }
  .brand { display: inline-flex; align-items: center; gap: 10px; margin-top: ${h < 700 ? 34 : 48}px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .brand svg { width: 30px; height: 30px; }
  h1 { margin: ${h < 700 ? 16 : 30}px 0 0; font-size: ${h < 700 ? 100 : 116}px; line-height: 0.98; }
  p { margin: 22px auto 0; max-width: 560px; text-wrap: balance; font-size: 20px; line-height: 1.45; color: var(--muted); }
  .stage { position: absolute; left: 120px; right: 120px; top: ${h < 700 ? 380 : 452}px; height: 420px; border-radius: 24px 24px 0 0; }
  .video { left: 60px; top: 48px; width: 560px; height: 420px; }
  .shot.back { left: 520px; top: 70px; width: 330px; transform: rotate(-4deg); }
  .shot.front { left: 650px; top: 44px; width: 330px; }
</style>
<div class="card">
  <div class="brand">${mark}Hare</div>
  <h1 class="serif">any video,<br>at <i>your</i> speed</h1>
  <p>Speed control, keyboard shortcuts and <span style="white-space:nowrap">two-tab</span> sync for every player on the web.</p>
  <div class="stage">
    <div class="video"><div class="bar"></div><div id="controller"><div></div></div></div>
    <img class="shot back" src="${b64(`popup-${dark ? 'light' : 'dark'}.png`)}">
    <img class="shot front" src="${b64(`popup-${dark ? 'dark' : 'light'}.png`)}">
  </div>
</div>${controllerScript}`;

const feature = (dark, n, title, text, extra, stage) => `${base(dark)}<style>
  .card { height: 560px; display: grid; grid-template-columns: 1fr 640px; }
  .copy { padding: 0 56px 0 72px; display: flex; flex-direction: column; justify-content: center; }
  .num { font: 500 15px ui-monospace, 'Cascadia Code', monospace; color: var(--muted); }
  h2 { margin: 14px 0 0; font-size: 64px; line-height: 1.02; }
  p { margin: 20px 0 0; font-size: 19px; line-height: 1.5; color: var(--muted); }
  .extra { margin-top: 30px; }
  .legend { margin-top: 10px; font-size: 14px; color: var(--muted); }
  .stage { margin: 28px 28px 28px 0; border-radius: 20px; }
</style>
<div class="card">
  <div class="copy"><div class="num">${n}</div><h2 class="serif">${title}</h2><p>${text}</p>${extra}</div>
  <div class="stage">${stage}</div>
</div>`;

const keys = `<div class="extra"><div class="keys"><span>S</span><span>D</span><span>R</span><span>Z</span><span>X</span><span>V</span></div><div class="legend">slower · faster · reset · rewind · advance · hide</div></div>`;
const features = scheme => {
  const dark = scheme === 'dark';
  return {
    'feature-speed': feature(dark, '01', 'Speed, <i>one key</i> away', 'From 0.07× to 16× on any HTML5 video or audio. Use the keyboard, the popup, or the controller on the player.', keys,
      `<img class="shot" style="left:140px;top:64px;width:360px" src="${b64(`popup-${scheme}.png`)}">`),
    'feature-sync': feature(dark, '02', 'Two tabs, <i>one</i> timeline', 'Pair media in two tabs, or a tab and mpv. They play, pause, seek and change speed together, and keep the offset you set.', '',
      `<img class="shot" style="left:140px;top:38px;width:360px" src="${b64(`sync-setup-${scheme}.png`)}">`),
    'feature-settings': feature(dark, '03', 'Tuned <i>to you</i>', 'Rebind every shortcut, restyle the controller with a live preview, and exclude the sites where you would rather Hare stayed out of the way.', '',
      `<img class="shot" style="left:56px;top:56px;width:900px" src="${b64(`settings-${scheme}.png`)}">`),
  };
};

// The site's speed feature: the controller on a bare video, framed by the page.
const player = `${base(false)}<style>
  body { width: 440px; }
  .video { inset: 0; border-radius: 0; box-shadow: none; }
  .bar { left: 18px; right: 18px; bottom: 16px; }
  #controller { left: 10px; top: 10px; zoom: 1; }
</style>
<div class="video"><div class="bar"></div><div id="controller"><div></div></div></div>${controllerScript}`;

// Chrome Web Store: 1280x800 screenshots and the 440x280 promo tile, opaque with square corners.
const storeShot = html => html + '<style>.card { height: 800px; border-radius: 0; } .stage .shot { translate: 0 120px; }</style>';
const promo = `${base(false)}<style>
  body { width: 440px; height: 280px; display: grid; place-content: center; justify-items: center; background: var(--wash); }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 44px; font-weight: 700; letter-spacing: -0.02em; }
  .brand svg { width: 56px; height: 56px; }
  .serif { margin-top: 12px; font-size: 34px; }
</style>
<div class="brand">${mark}Hare</div><div class="serif">any video, at <i>your</i> speed</div>`;

(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(store, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    await render(browser, hero(scheme === 'dark'), `${readme}/hero-${scheme}.png`, { width: 1280, height: 760, scale: 1.6, transparent: true });
    for (const [name, html] of Object.entries(features(scheme))) {
      await render(browser, html, `${readme}/${name}-${scheme}.png`, { width: 1280, height: 560, scale: 1.6, transparent: true });
    }
    for (const name of ['popup', 'sync-setup', 'settings']) fs.copyFileSync(`${inputs}/${name}-${scheme}.png`, `${site}/${name}-${scheme}.png`);
  }
  await render(browser, player, `${site}/controller.png`, { width: 440, height: 280, scale: 2 });
  // GitHub has no API for the social preview; it is uploaded by hand from this file.
  await render(browser, hero(false, 640), path.join(__dirname, '../social-preview.png'), { width: 1280, height: 640 });
  const shots = [hero(false, 800) + '<style>.card { border-radius: 0; }</style>', ...Object.values(features('light')).map(storeShot)];
  for (const [i, html] of shots.entries()) await render(browser, html, `${store}/screenshot-${i + 1}.png`, { width: 1280, height: 800 });
  await render(browser, promo, `${store}/promo-small.png`, { width: 440, height: 280 });
  await browser.close();
})();
