// Shared by releases/banner.cjs and readme/build.cjs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const font = (file, style) => `@font-face { font-family: 'Instrument Serif'; font-style: ${style}; font-weight: 400;
  src: url(data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, 'fonts', file)).toString('base64')}) format('woff2'); }`;
const fonts = `<style>${font('InstrumentSerif-Regular.woff2', 'normal')}\n${font('InstrumentSerif-Italic.woff2', 'italic')}</style>`;

// The master logo lives on main; inline it without its fixed size and title.
const logo = hare => fs.readFileSync(path.join(hare, 'assets/logo.svg'), 'utf8')
  .replace(/<title>.*?<\/title>/, '').replace('width="256" height="256"', '');

function hareCheckout(arg) {
  const dir = path.resolve(arg ?? '');
  if (!arg || !fs.existsSync(path.join(dir, 'assets/logo.svg'))) throw new Error('Pass the path of a Hare checkout of main');
  return dir;
}

async function render(browser, html, file, { width, height, scale = 1, transparent = false }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all([...document.fonts].map(face => face.load())));
  await page.evaluate(() => Promise.all([...document.images].map(img => img.decode())));
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
}

module.exports = { chromium, fonts, logo, hareCheckout, render };
