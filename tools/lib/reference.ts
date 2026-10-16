import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { startStaticServer } from './static-server.ts';

export const ROOT = path.resolve(import.meta.dirname, '../..');

export interface RefSession {
  page: Page;
  browser: Browser;
  close: () => Promise<void>;
}

/** Opens the reference runner in a headless browser and waits until the project is loaded. */
export async function openReference(opts: { headless?: boolean } = {}): Promise<RefSession> {
  const server = await startStaticServer(ROOT);
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: opts.headless ?? true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 980, height: 760 } });
  page.on('pageerror', (e) => console.error('[ref pageerror]', e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (/Translation for|willReadFrequently/.test(text)) return;
    if (m.type() === 'error' || m.type() === 'warning') console.error(`[ref ${m.type()}]`, text.slice(0, 300));
  });
  await page.goto(`${server.url}/reference/index.html`);
  await page.waitForFunction(() => (window as any).H?.ready || (window as any).H?.error, null, { timeout: 300_000, polling: 250 });
  const err = await page.evaluate(() => (window as any).H.error);
  if (err) throw new Error(`reference failed to load: ${err}`);
  return {
    page,
    browser,
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}
