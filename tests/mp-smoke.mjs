// Multiplayer smoke: real dev room server + `vite preview` + several Chromium contexts playing together.
// Run `npm run build && npm run preview` first (port 4173). Usage: node tests/mp-smoke.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startDevServer } from '../tools/dev-server.mjs';

const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const base = process.argv[2] || 'http://localhost:4173/Don-Game/';
const problems = [];
const ok = (cond, text) => { console.log((cond ? 'ok   ' : 'FAIL ') + text); if (!cond) problems.push(text); };

const srv = await startDevServer({ port: 8799, delayMs: 120, lobbyTimerMs: 4000, quiet: true });
const server = 'http://localhost:8799';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const pages = [];
async function newPlayer(name, url) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.goto(url);
  const p = { name, page, errs };
  pages.push(p); return p;
}
const q = `server=${encodeURIComponent(server)}&autodrive=1&fast=4&quality=0`;

try {
  // A creates a room
  const A = await newPlayer('A', `${base}?${q}`);
  await A.page.waitForSelector('#btn-create', { state: 'visible', timeout: 15000 });
  ok(true, 'menu shows the online buttons when a server is configured');
  await A.page.click('#btn-create');
  await A.page.fill('#in-name', 'אלי'); await A.page.click('#btn-profile-go');
  await A.page.waitForSelector('#btn-start:not([disabled])', { timeout: 15000 });
  await A.page.click('#btn-start');
  await A.page.waitForSelector('#scr-lobby:not([hidden])', { timeout: 10000 });
  const code = (await A.page.textContent('#lobby-code')).trim();
  ok(/^[A-Z]{4}$/.test(code), `room code shown: ${code}`);

  // B joins by typing the code, C by link, D by link
  async function join(name, via) {
    const url = via === 'link' ? `${base}?${q}&room=${code}` : `${base}?${q}`;
    const P = await newPlayer(name, url);
    if (via !== 'link') { await P.page.waitForSelector('#btn-join', { state: 'visible', timeout: 15000 }); await P.page.click('#btn-join'); await P.page.fill('#in-code', code.toLowerCase()); }
    await P.page.waitForSelector('#in-name', { state: 'visible', timeout: 15000 });
    await P.page.fill('#in-name', name); await P.page.click('#btn-profile-go');
    await P.page.waitForSelector('#btn-start:not([disabled])', { timeout: 15000 });
    await P.page.click('#btn-start');
    await P.page.waitForSelector('#scr-lobby:not([hidden])', { timeout: 10000 });
    return P;
  }
  const B = await join('בני', 'code'), C = await join('גלי', 'link');
  await A.page.waitForFunction(() => document.querySelectorAll('#lobby-players .pl').length === 3, null, { timeout: 8000 });
  ok(true, 'the host sees 3 players');
  ok((await A.page.textContent('#lobby-players')).includes('👑'), 'the host is marked');
  ok(await A.page.isVisible('#btn-lobby-start') && !(await B.page.isVisible('#btn-lobby-start')), '"start now" is only for the host');
  const D = await join('דנה', 'link');

  // the 30 s timer (4 s here) starts the race for everyone
  for (const P of [A, B, C, D]) await P.page.waitForFunction(() => window.__game.state === 'countdown' || window.__game.state === 'racing', null, { timeout: 20000 });
  ok(true, 'the race starts for all 4 players when the timer runs out');
  const seeds = await Promise.all([A, B, C, D].map((P) => P.page.evaluate(() => window.__game.raceSeed)));
  ok(new Set(seeds).size === 1, `everyone races on the same seed (${seeds[0]})`);

  // everyone finishes; the lobby comes back with the same code and a score table
  for (const P of [A, B, C, D]) await P.page.waitForFunction(() => document.querySelector('#scr-lobby:not([hidden])') && document.querySelectorAll('#lobby-last .pl').length > 0, null, { timeout: 170000 });
  ok(true, 'results arrive and everyone is back in the lobby');
  const codeAfter = (await A.page.textContent('#lobby-code')).trim();
  ok(codeAfter === code, 'same room code after the race (no new code needed)');
  const last = await A.page.textContent('#lobby-last');
  ok(/\+10/.test(last), 'winner got 10 points');
  await A.page.waitForSelector('#btn-start:not([disabled])', { timeout: 15000 });
  await A.page.click('#btn-start');
  await A.page.waitForFunction(() => document.querySelectorAll('#lobby-board .pl').length === 4, null, { timeout: 8000 });
  ok(true, 'the room score table lists all 4 players');

  // a 5th and 6th fit, a 7th is refused
  const E = await join('אורי', 'link'), F = await join('פנינה', 'link');
  ok((await A.page.evaluate(() => document.querySelectorAll('#lobby-players .pl').length)) === 6, 'six players fit');
  const G = await newPlayer('G', `${base}?${q}&room=${code}`);
  await G.page.waitForSelector('#in-name', { state: 'visible', timeout: 15000 });
  await G.page.fill('#in-name', 'שביעי'); await G.page.click('#btn-profile-go');
  await G.page.waitForFunction(() => /מלא/.test(document.querySelector('#profile-err')?.textContent || ''), null, { timeout: 8000 });
  ok(true, 'the 7th player is told the room is full');

  for (const P of pages) ok(P.errs.length === 0, `${P.name}: no console errors ${P.errs.slice(0, 2).join(' | ')}`);
} catch (e) {
  console.log('ERROR', e.message); problems.push(e.message);
  for (const P of pages) await P.page.screenshot({ path: `/tmp/mp-fail-${P.name}.png` }).catch(() => {});
} finally {
  await browser.close(); await srv.close();
}
if (problems.length) { console.log('\nMP SMOKE FAILED:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('\nMP SMOKE OK');
