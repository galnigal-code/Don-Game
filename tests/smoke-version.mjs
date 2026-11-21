// The running game must show its build and react when a newer build is published.
// Run `npm run build && npm run preview` first. Usage: node tests/smoke-version.mjs [url]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

// 1. same version published: badge visible, no nagging
let page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto(base);
await page.waitForFunction(() => window.__game);
await page.waitForTimeout(1200);
const label = await page.textContent('#build');
check(/גרסה .+ · \d\d\.\d\d \d\d:\d\d UTC/.test(label), 'the menu shows which build is running: ' + label);
check(await page.evaluate(() => document.getElementById('btn-update').hidden), 'no update prompt when this is the latest build');
await page.close();

// 2. a newer build is published while the menu is open: the page refreshes itself once
page = await browser.newPage({ viewport: { width: 844, height: 390 } });
let served = 0;
await page.route('**/version.json*', (route) => { served++; route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'newer-build', label: 'newer' }) }); });
await page.goto(base);
await page.waitForFunction(() => location.search.includes('v=newer-build'), null, { timeout: 15000 }).catch(() => {});
check(page.url().includes('v=newer-build'), 'idle on the menu with a newer build published -> refreshes to it automatically: ' + page.url());
await page.waitForFunction(() => window.__game, null, { timeout: 15000 });
await page.waitForTimeout(1500);
check(await page.evaluate(() => !document.getElementById('btn-update').hidden), 'if it is still outdated after the refresh (cache), a visible update button is offered instead of looping');
check(served >= 2, 'version.json was fetched without caching (' + served + ' requests)');
await page.close();

// 3. mid-race a newer build must not interrupt: only the button appears
page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto(base + '?skipCalib=1&seed=3');
await page.waitForFunction(() => window.__game && __game.state !== 'menu');
await page.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'newer-2', label: 'n2' }) }));
await page.evaluate(() => __game.checkVersion());
await page.waitForTimeout(800);
check(!page.url().includes('v=newer-2'), 'a newer build never reloads the page in the middle of a race');
check(await page.evaluate(() => !document.getElementById('btn-update').hidden), 'but the update button appears');
await browser.close();
if (fails.length) { console.error('\nVERSION SMOKE FAILED'); process.exit(1); }
console.log('\nVERSION SMOKE OK');
