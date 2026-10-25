// Browser smoke test: starts the Vite dev server, opens the game in headless Chrome and clicks through the main flow
// (title, packs, build, shop, mods, library, launch, flight, results, history, daily puzzle, guide), then checks a
// sideways phone and a desktop layout. Fails on any uncaught page error or console error.
//
//   npm run smoke            the dev server (needs Google Chrome; CHROME_PATH=/path/to/chrome for another Chromium)
//   npm run smoke -- --dist  the production build in dist/ (run npm run build first): what players get
//   SMOKE_HEADED=1 npm run smoke   to watch it
//
// Requests to other hosts (game server, cloud save, telemetry) are blocked, so the test never touches production.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';

const errors = [];
const step = name => console.log('  · ' + name);
const fail = msg => { throw new Error(msg); };

async function newPage(browser, viewport, label) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 900, isMobile: false, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route(url => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), r => r.abort());
  page.on('pageerror', e => errors.push(`[${label}] page error: ${e.message}`));
  page.on('console', m => {
    // blocked requests to other hosts show up as failed loads; anything else logged as an error counts
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(`[${label}] console: ${m.text()}`);
  });
  return page;
}
const visible = (page, sel) => page.locator(sel).first().isVisible();
async function openPacks(page) {
  await page.locator('#packs').waitFor({ state: 'visible', timeout: 5000 });
  await page.click('#pkSkip');
  await page.click('#pkDone');
  await page.locator('#packs').waitFor({ state: 'hidden' });
}
// put the selected palette part on a cell (tap the palette, then the cell)
async function place(page, type, c, r) {
  const b = page.locator(`#pal button[data-t="${type}"]`);
  if (!(await b.count())) return false;
  await b.click();
  await page.click(`#grid .cell[data-c="${c}"][data-r="${r}"]`);
  return true;
}
// between contracts the button says START CONTRACT n (opens the contract), then LAUNCH!
async function launch(page) {
  if (/START CONTRACT/.test(await page.textContent('#launch'))) await page.click('#launch');
  const label = (await page.textContent('#launch')).trim();
  if (!/^LAUNCH/.test(label)) fail(`launch button says "${label}"`);
  await page.click('#launch');
  await page.locator('#flight').waitFor({ state: 'visible' });
}
const coins = async page => +((await page.textContent('#hCoins')) || '0').replace(/\D/g, '');

async function portrait(browser, url) {
  console.log('phone portrait 390x844');
  const page = await newPage(browser, { width: 390, height: 844 }, 'portrait');
  await page.goto(url);
  await page.locator('#start').waitFor({ timeout: 10000 });
  step('title');

  await page.click('#start');
  await openPacks(page);
  if (!(await visible(page, '#hangar'))) fail('hangar not shown after the packs');
  step('packs');

  const before = await page.locator('#grid .cell.on').count();
  await place(page, 'wing', 2, 1);
  (await place(page, 'prop', 3, 2)) || (await place(page, 'rocket', 1, 2));
  const after = await page.locator('#grid .cell.on').count();
  if (after <= before) fail(`placing parts did nothing (${before} -> ${after} parts)`);
  step(`build (${after} parts)`);

  await page.click('#tShop');
  await page.locator('#dealer.open').waitFor();
  const c0 = await coins(page);
  const buy = page.locator('#dealerBody .buy[data-kind="part"]:not([disabled])').first();
  if (await buy.count()) {
    await buy.click();
    if ((await coins(page)) >= c0) fail('buying a part did not take coins');
  }
  step('shop');
  await page.click('#dealerX');
  await page.locator('#dealer').waitFor({ state: 'hidden' });
  await page.click('#tMods');
  await page.locator('#dealer.open').waitFor();
  await page.click('#libOpen');
  await page.locator('#library.open').waitFor();
  await page.click('#libX');
  await page.locator('#library').waitFor({ state: 'hidden' });
  await page.click('#dealerX');
  await page.locator('#dealer').waitFor({ state: 'hidden' });
  step('mods and library');

  await launch(page);
  await page.click('#bFF');
  await page.waitForTimeout(1500);
  const cv = await page.evaluate(() => { const c = document.getElementById('cv'); return [c.width, c.height]; });
  if (!cv[0] || !cv[1]) fail('flight canvas has no size');
  if (!(await page.textContent('#fDist')).trim()) fail('flight HUD is empty');
  step('flight');

  await page.locator('#sheet #next').waitFor({ state: 'visible', timeout: 90000 });
  await page.click('#sheet .eqn');
  const total = (await page.textContent('#tyT')).trim();
  await page.click('#sheet #next');
  if (await visible(page, '#tourGo')) await page.click('#tourGo');
  await page.locator('#hangar').waitFor({ state: 'visible' });
  step(`results (score ${total})`);

  await page.click('#tMods');
  await page.click('#aband2');
  await page.click('#aband2');
  await page.locator('#start').waitFor();
  await page.click('#histBtn');
  await page.locator('#sheet .hentry').first().waitFor();
  await page.click('#hOk');
  step('abandon and history');

  await page.click('#dPlay');
  if (await visible(page, '#packs')) await openPacks(page);
  await page.locator('#hangar').waitFor({ state: 'visible' });
  await page.click('#tMods');
  await page.click('#aband2');
  await page.click('#aband2');
  await page.locator('#title').waitFor({ state: 'visible' });
  step('daily puzzle');

  await page.click('#howto');
  await page.locator('#guide').waitFor({ state: 'visible' });
  await page.click('#grClose');
  step('guide');
  await page.context().close();
}

async function landscape(browser, url) {
  console.log('phone landscape 844x390');
  const page = await newPage(browser, { width: 844, height: 390 }, 'landscape');
  await page.goto(url);
  await page.click('#start');
  await openPacks(page);
  if (!(await page.locator('#dealer.docked').count())) fail('shop is not docked beside the hangar');
  await page.click('#cstrip .route');
  await page.locator('#tourGo').waitFor();
  const box = await page.locator('#sheet').boundingBox();
  if (box.y < 0 || box.y + box.height > 391) fail(`tour sheet runs off the screen (${Math.round(box.y)}..${Math.round(box.y + box.height)} of 390)`);
  await page.click('#tourGo');
  step('docked shop and tour map');
  await launch(page);
  await page.waitForTimeout(800);
  step('flight');
  await page.context().close();
}

async function desktop(browser, url) {
  console.log('desktop 1280x800');
  const page = await newPage(browser, { width: 1280, height: 800 }, 'desktop');
  await page.goto(url);
  await page.click('#start');
  await openPacks(page);
  if (!(await page.locator('#dealer.docked').count())) fail('shop is not docked beside the hangar');
  await page.click('#dtMods');
  await page.click('#dtShop');
  step('hangar');
  await page.context().close();
}

const dist = process.argv.includes('--dist');
const server = dist
  ? await preview({ preview: { port: 5198, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' })
  : await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
if (!dist) await server.listen();
const url = server.resolvedUrls.local[0];
console.log(dist ? 'production build (dist/)' : 'dev server');
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH, headless: !process.env.SMOKE_HEADED }
    : { channel: 'chrome', headless: !process.env.SMOKE_HEADED });
  await portrait(browser, url);
  await landscape(browser, url);
  await desktop(browser, url);
} catch (e) {
  errors.push(e.message.split('\n')[0]);
} finally {
  if (browser) await browser.close();
  await (dist ? new Promise(r => server.httpServer.close(r)) : server.close());
}
if (errors.length) {
  console.error('\nSMOKE FAILED\n' + errors.map(e => '  ' + e).join('\n'));
  process.exit(1);
}
console.log('\nsmoke ok');
