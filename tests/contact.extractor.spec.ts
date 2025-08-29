import { test } from '@playwright/test';
import { chromium, Browser, Page, BrowserContext, Route } from 'playwright';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

// --------- Types ----------
type RowOut = {
  website: string;
  email: string;
  facebook: string;
  instagram: string;
};

// --------- Config (tweak as needed) ----------
const NAV_TIMEOUT_MS = 20000; // navigation timeout
const PER_URL_HARD_TIMEOUT_MS = 30000; // total time budget per URL
const DELAY_MS = 200; // minimum delay between requests (ms)
const POLITE_JITTER_MS = 400;

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/g;
const CONTACT_TEXT_RE = /\b(contact|contact us|get in touch|support|help|customer service)\b/i;
const FB_HOST = 'facebook.com';
const IG_HOST = 'instagram.com';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
];

// --------- CLI args ----------
let _cliArgs = process.argv.slice(2);
if (_cliArgs[0] === 'test') {
  _cliArgs = ['data/sites.json', 'output/contacts.csv'];
}
const [inputPath = 'data/sites.json', outCsvPath = 'output/contacts.csv'] = _cliArgs;
const outJsonPath = path.join(path.dirname(outCsvPath), 'contacts.json');

// --------- Helpers ----------
function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

function ensureHttp(u: string) {
  const s = u.trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s;
}

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

function normalizeEmail(e: string) {
  return e.trim().replace(/^mailto:/i, '').split('?')[0];
}

function pickBestSocial(candidates: string[], hostContains: string): string {
  if (!candidates.length) return '';
  const urls: URL[] = [];
  for (const href of candidates) {
    try {
      const u = new URL(href);
      if (!u.hostname.includes(hostContains)) continue;
      const p = u.pathname.toLowerCase();
      if (p.includes('/sharer') || p.includes('/share') || p.includes('/plugins') || p.includes('/dialog')) continue;
      urls.push(u);
    } catch {
    }
  }
  if (!urls.length) return candidates[0];

  urls.sort((a, b) => {
    const segA = a.pathname.split('/').filter(Boolean).length;
    const segB = b.pathname.split('/').filter(Boolean).length;
    if (segA !== segB) return segA - segB;
    if (!!a.search !== !!b.search) return a.search ? 1 : -1;
    return a.pathname.length - b.pathname.length;
  });

  const best = urls[0];
  best.search = '';
  best.hash = '';
  if (best.pathname.endsWith('/') && best.pathname !== '/') {
    best.pathname = best.pathname.replace(/\/+$/, '');
  }
  return best.toString();
}

// autoScroll removed — pages are assumed to load fully without programmatic scrolling

function openCsv(outPath: string) {
  if (!fs.existsSync(path.dirname(outPath))) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  const firstWrite = !fs.existsSync(outPath);
  const ws = fs.createWriteStream(outPath, { flags: 'a' });
  if (firstWrite) {
    ws.write(`website,email,facebook,instagram\n`);
  }
  return ws;
}

function csvEscape(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

function writeCsvRow(ws: fs.WriteStream, row: RowOut) {
  ws.write([
    csvEscape(row.website),
    csvEscape(row.email),
    csvEscape(row.facebook),
    csvEscape(row.instagram)
  ].join(",") + "\n");
}

// JSON output is written at the end via fsp.writeFile

// --------- Extraction core ----------
async function extractFromCurrentPage(page: Page): Promise<{ emails: string[]; fb: string[]; ig: string[]; contactLinks: string[] }> {
  const anchors = await page.$$eval('a[href]', (els) =>
    (els as HTMLAnchorElement[]).map((a: HTMLAnchorElement) => ({
      href: (a.getAttribute('href') || '').trim(),
      abs: (a as HTMLAnchorElement).href || '',
      text: (a.textContent || '').trim()
    }))
  );

  const mailtos = anchors
    .filter(a => /^mailto:/i.test(a.href) || /^mailto:/i.test(a.abs))
    .map(a => normalizeEmail(a.href || a.abs));

  const fbLinks = anchors
    .filter(a => /facebook\.com/i.test(a.href) || /facebook\.com/i.test(a.abs) || /facebook\.com/i.test(a.text))
    .map(a => a.abs || a.href)
    .filter(Boolean);

  const igLinks = anchors
    .filter(a => /instagram\.com/i.test(a.href) || /instagram\.com/i.test(a.abs) || /instagram\.com/i.test(a.text))
    .map(a => a.abs || a.href)
    .filter(Boolean);

  const html = await page.content();
  const textEmails = (html.match(EMAIL_REGEX) || []).map(normalizeEmail);
  const textFb = (html.match(/\bhttps?:\/\/[^\s"'<>]*facebook\.com\/[^\s"'<>]*/gi) || []);
  const textIg = (html.match(/\bhttps?:\/\/[^\s"'<>]*instagram\.com\/[^\s"'<>]*/gi) || []);

  const contactLinks = anchors
    .filter(a => CONTACT_TEXT_RE.test(a.text) || /\/contact(?![a-z])/i.test(a.href) || /\/contact(?![a-z])/i.test(a.abs))
    .map(a => a.abs || a.href)
    .filter(Boolean);

  return {
    emails: uniq([...mailtos, ...textEmails]),
    fb: uniq([...fbLinks, ...textFb]),
    ig: uniq([...igLinks, ...textIg]),
    contactLinks: uniq(contactLinks)
  };
}

async function tryContactPages(page: Page, links: string[]) {
  const found = new Set<string>();
  for (const link of links.slice(0, 2)) {
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      try { await page.waitForLoadState('networkidle', { timeout: 1500 }); } catch { }
      const html = await page.content();
      for (const m of html.match(EMAIL_REGEX) || []) found.add(normalizeEmail(m));
      const anchors = await page.$$eval("a[href^='mailto:']", (els: Element[]) => (els as HTMLAnchorElement[]).map((a: HTMLAnchorElement) => a.getAttribute('href') || ''));
      for (const href of anchors) found.add(normalizeEmail(href));
      if (found.size) break;
    } catch {
      // ignore and continue
    }
  }
  return [...found];
}

async function processOne(page: Page, rawUrl: string): Promise<RowOut> {
  const website = ensureHttp(rawUrl);
  let emails: string[] = [];
  let fbs: string[] = [];
  let igs: string[] = [];

  const hardTimeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('hard-timeout')), PER_URL_HARD_TIMEOUT_MS)
  );

  const job = (async () => {
    try {
      await page.goto(website, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      try { await page.waitForLoadState('networkidle', { timeout: 1500 }); } catch { }

      const first = await extractFromCurrentPage(page);
      emails = first.emails;
      fbs = first.fb;
      igs = first.ig;

      if (!emails.length && first.contactLinks.length) {
        const extra = await tryContactPages(page, first.contactLinks);
        if (extra.length) emails = uniq([...emails, ...extra]);
      }
    } catch (e: any) {
    }

    const facebook = pickBestSocial(fbs, FB_HOST);
    const instagram = pickBestSocial(igs, IG_HOST);

    return {
      website,
      email: emails[0] || '',
      facebook: facebook || '',
      instagram: instagram || ''
    } as RowOut;
  })();

  return Promise.race([job, hardTimeout]).catch((e: any) => {
    return {
      website,
      email: '',
      facebook: '',
      instagram: ''
    } as RowOut;
  });
}

// (sequential processing)
async function makeContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true
  });
  await ctx.route('**/*', (route: Route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font'].includes(type)) return route.abort();
    return route.continue();
  });
  return ctx;
}

// --------- Main ----------
export async function runExtractor(browserArg?: Browser) {
  const raw = await fsp.readFile(inputPath, 'utf8');
  const urls: string[] = JSON.parse(raw).map(ensureHttp).filter(Boolean);

  if (!urls.length) {
    console.error('No URLs found. Provide a JSON array of websites.');
    process.exit(1);
  }

  if (!fs.existsSync(path.dirname(outCsvPath))) {
    fs.mkdirSync(path.dirname(outCsvPath), { recursive: true });
  }

  const csv = openCsv(outCsvPath);
  const results: RowOut[] = [];
  const collect = (r: RowOut) => results.push(r);

  const browser = browserArg ?? await chromium.launch({ headless: true });

  console.log(`Processing ${urls.length} URLs sequentially...`);

  const ctx = await makeContext(browser);
  const page = await ctx.newPage();

  for (let idx = 0; idx < urls.length; idx++) {
    const url = urls[idx];
  await sleep(DELAY_MS + Math.floor(Math.random() * POLITE_JITTER_MS));
    const out = await processOne(page, url);
    writeCsvRow(csv, out);
    collect(out);
    process.stdout.write(`\rProcessed: ${idx + 1}/${urls.length}`);
  }

  await ctx.close();
  await browser.close();

  csv.end();

  // write JSON array file
  if (!fs.existsSync(path.dirname(outJsonPath))) {
    fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
  }
  await fsp.writeFile(outJsonPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`\nDone. CSV: ${outCsvPath}  JSON: ${outJsonPath}`);
}

// Playwright UI test wrapper
test('contact extractor runs and produces outputs', async ({ }, testInfo) => {
  test.setTimeout(30 * 60 * 1000); // 30 minutes
  await runExtractor();
});

// If executed directly (node/tsx), run the extractor.
if (process.argv[2] !== 'test') {
  runExtractor().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
