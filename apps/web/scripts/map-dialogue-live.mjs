// Real browser + running gateway/provider data only. No fixtures or route mocks.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const evidencePath = path.join(root, 'data/map-dialogue-live-20261002.json');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const base = 'http://127.0.0.1:8503';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(Object.entries(evidence.cookies).map(([name, value]) => ({ name, value, url: base, httpOnly: true })));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.url().includes('/web/api/') && response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
});
const mode = process.argv[2] || 'inspect';
try {
  if (mode !== 'inspect' && process.env.RUN_LIVE_INTEGRATION !== '1') throw new Error('Set RUN_LIVE_INTEGRATION=1 before workflow actions/paid live calls.');
  await page.goto(`${base}/ai/${evidence.thread}`);
  await page.locator('.chat-page').waitFor({ timeout: 30000 });
  if (mode === 'choice') {
    const button = page.getByRole('button', { name: /Trường Đại học Bách khoa, Đại học Quốc gia/ }).first();
    await button.waitFor({ timeout: 15000 });
    const response = page.waitForResponse(r => r.url().includes(`/threads/${evidence.thread}/chat`) && r.request().method() === 'POST', { timeout: 240000 });
    await button.click();
    const r = await response;
    if (!r.ok()) throw new Error(`Choice failed ${r.status()}`);
    evidence.turns.push({ action: 'browser-place-choice', snapshot: await r.json() });
  } else if (mode === 'house') {
    await page.getByLabel('Nhà trong vùng bản đồ').waitFor({ timeout: 30000 });
    await page.locator('.maplibregl-canvas').waitFor({ timeout: 30000 });
    const zoom = page.locator('.maplibregl-ctrl-zoom-in');
    for (let i = 0; i < 3; i++) {
      await zoom.click();
      await page.waitForTimeout(1000); // allow real map moveend + spatial requests
    }
    const choice = page.getByLabel('Nhà trong vùng bản đồ').getByRole('button', { name: 'Chọn căn này', exact: true }).first();
    await choice.waitFor({ timeout: 40000 });
    const response = page.waitForResponse(r => r.url().includes(`/threads/${evidence.thread}/action`) && r.request().method() === 'POST', { timeout: 180000 });
    await choice.click();
    const r = await response;
    if (!r.ok()) throw new Error(`House selection failed ${r.status()}`);
    evidence.turns.push({ action: 'browser-map-house-selection', snapshot: await r.json() });
  } else if (mode === 'moving-pin' || mode === 'moving-confirm') {
    const form = page.getByLabel('Thông tin chuyển đồ');
    await form.waitFor({ timeout: 30000 });
    if (await form.getByLabel('Ngày chuyển').inputValue() !== '2026-10-13') throw new Error('Date was lost');
    if (await form.getByLabel('Giờ xe đến').inputValue() !== '16:00') throw new Error('Time was lost');
    // Click an actual provider-backed candidate marker on the map, not a
    // synthetic coordinate or intercepted response.
    const marker = page.locator(mode === 'moving-confirm' ? '.mv-candidate.home' : '.mv-candidate:not(.home)').first();
    await marker.waitFor({ timeout: 30000 });
    await marker.click();
    const response = page.waitForResponse(r => r.url().includes(`/threads/${evidence.thread}/chat`) && r.request().method() === 'POST', { timeout: 240000 });
    await form.getByRole('button', { name: 'Xác nhận và lấy báo giá', exact: true }).click();
    const r = await response;
    if (!r.ok()) throw new Error(`Moving pin failed ${r.status()}`);
    evidence.turns.push({ action: `browser-map-${mode}`, snapshot: await r.json() });
  }
  await page.screenshot({ path: path.join(root, `data/map-dialogue-${mode}.png`), fullPage: true });
  console.log(JSON.stringify({ mode, errors, text: (await page.locator('body').innerText()).slice(-11000) }));
} catch (error) {
  await page.screenshot({ path: path.join(root, `data/map-dialogue-${mode}-failed.png`), fullPage: true });
  console.log(JSON.stringify({ mode, errors, text: (await page.locator('body').innerText()).slice(-8000) }));
  throw error;
} finally {
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
  await browser.close();
}
