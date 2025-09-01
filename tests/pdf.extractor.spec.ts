import { test } from '@playwright/test';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import pLimit from 'p-limit';

async function fileExists(fp: string) {
  try {
    await fsp.access(fp, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, '_');
}

function looksLikePdfHeaders(headers: Headers, url: string) {
  const ct = (headers.get('content-type') || '').toLowerCase();
  if (ct.includes('pdf')) return true;
  if (url.toLowerCase().endsWith('.pdf')) return true;
  const cd = (headers.get('content-disposition') || '').toLowerCase();
  if (cd.includes('.pdf')) return true;
  return false;
}

async function zipFiles(files: string[], zipPath: string) {
  if (!files.length) return { ok: true, reason: 'no files' };
  try {
    await fsp.mkdir(path.dirname(zipPath), { recursive: true });
    return await new Promise<{ ok: boolean; reason?: string; error?: any }>((resolve) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve({ ok: true }));
      output.on('error', (err) => resolve({ ok: false, reason: 'write error', error: String(err) }));
  archive.on('error', (err: any) => resolve({ ok: false, reason: 'zip error', error: String(err) }));
      archive.pipe(output);
      for (const f of files) archive.file(f, { name: path.basename(f) });
      archive.finalize();
    });
  } catch (err: any) {
    return { ok: false, reason: 'zip failed', error: String(err) };
  }
}

const CONCURRENCY = Number(process.env.CONCURRENCY || 6);

async function downloadIfPdf(item: Record<string, any>, destDir = path.join('output', 'pdfs')) {
  const { code, url, outPath } = getOutInfo(item, destDir);
  if (!code || !url) return { ok: false, reason: 'missing product_code or url', item };
  // delegate to the URL-based downloader (which also checks existence)
  return downloadUrlToPath(url, outPath);
}

function getOutInfo(item: Record<string, any>, destDir = path.join('output', 'pdfs')) {
  const code = String(item.product_code || item.product || item.code || '');
  const url = String(item.url || item.link || '');
  const outPath = path.resolve(destDir, sanitizeFileName(code) + '.pdf');
  return { code, url, outPath };
}

async function saveBufferToPath(buf: Buffer, outPath: string) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, buf);
  return outPath;
}

async function downloadUrlToPath(url: string, outPath: string) {
  if (await fileExists(outPath)) return { ok: true, skipped: true, path: outPath };
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return { ok: false, reason: `http ${res.status}`, status: res.status };

    const headersOk = looksLikePdfHeaders(res.headers, url);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const magic = buf.slice(0, 4).toString();
    const isPdfMagic = magic === '%PDF';

    if (!headersOk && !isPdfMagic) return { ok: false, reason: 'not a PDF (headers+magic mismatch)', contentType: res.headers.get('content-type') };

    await saveBufferToPath(buf, outPath);
    return { ok: true, skipped: false, path: outPath };
  } catch (err: any) {
    return { ok: false, reason: String(err), error: err };
  }
}

function getZipPath(destDir: string) {
  return path.resolve(path.dirname(destDir), path.basename(destDir) + '.zip');
}

async function processItem(item: Record<string, any>, destDir: string, page?: any) {
  const { code, url, outPath } = getOutInfo(item, destDir);
  if (!code || !url) return { ok: false, reason: 'missing product_code or url', item };

  // Try fetch-based download first 
  const fetchRes: any = await downloadIfPdf(item, destDir).catch((e) => ({ ok: false, reason: String(e) }));
  if (fetchRes && fetchRes.ok && fetchRes.path) return fetchRes;

  // If a page is available, use the browser to try to locate or receive the PDF
  if (page) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response) {
        const headers = response.headers();
        const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
        if (ct.includes('pdf')) {
          const body = await response.body();
          await saveBufferToPath(body, outPath);
          return { ok: true, skipped: false, path: outPath };
        }
      }

      const pdfHref: string | null = await page.evaluate(() => {
        const selectors = Array.from(document.querySelectorAll('a[href], iframe[src], embed[src], object[data]'));
        for (const el of selectors) {
          try {
            if (el instanceof HTMLAnchorElement) {
              const href = el.href || el.getAttribute('href') || '';
              if (href && href.toLowerCase().includes('.pdf')) return href;
            }
            const src = (el as any).src || (el as any).data || '';
            if (src && src.toLowerCase().includes('.pdf')) return src;
          } catch {
            continue;
          }
        }
        return null;
      });

      if (pdfHref) {
        const hrefRes: any = await downloadUrlToPath(pdfHref, outPath).catch((e) => ({ ok: false, reason: String(e) }));
        return hrefRes;
      }
    } catch (e: any) {
      return { ok: false, reason: String(e) };
    }
  }

  return { ok: false, reason: fetchRes.reason || 'no PDF found' };
}

export async function runPdfExtraction(list: Array<{ product_code?: string; url?: string }>, destDir = path.join('output', 'pdfs')) {
  const downloaded: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ item: any; reason: string }> = [];

  const limit = pLimit(CONCURRENCY);
  const tasks = list.map((item) => limit(async () => {
    const res: any = await downloadIfPdf(item, destDir).catch((e) => ({ ok: false, reason: String(e) }));
    return { item, res };
  }));

  const results = await Promise.all(tasks);
  const toFallback: Array<any> = [];
  for (const r of results) {
    const { item, res } = r;
    if (res && res.ok && res.path) {
      if (res.skipped) skipped.push(String(res.path));
      else downloaded.push(String(res.path));
    } else {
      toFallback.push(item);
    }
  }

  // Fallback step (sequential) using processItem with no page available
  for (const item of toFallback) {
    const res: any = await processItem(item, destDir);
    if (res && res.ok && res.path) {
      if (res.skipped) skipped.push(String(res.path));
      else downloaded.push(String(res.path));
    } else {
      failed.push({ item, reason: String(res?.reason) });
    }
  }

  const zipPath = getZipPath(destDir);
  const zipRes = await zipFiles(downloaded, zipPath);

  return { downloaded, skipped, failed, zip: zipRes.ok ? zipPath : undefined, zipError: zipRes.ok ? undefined : zipRes };
}


const invokedDirectly = typeof process.argv[1] === 'string' && (process.argv[1].endsWith('tests/pdf.extractor.spec.ts') || process.argv[1].endsWith('pdf.extractor.spec.ts'));
if (invokedDirectly) {
  (async () => {
    const inputArg = process.argv[2] || path.resolve(process.cwd(), 'data', 'pdfs.json');
    try {
      const raw = await fsp.readFile(inputArg, 'utf8');
      const list = JSON.parse(raw);
      const res = await runPdfExtraction(list);
      console.log('PDF extraction finished:', { downloaded: res.downloaded.length, skipped: res.skipped.length, failed: res.failed.length, zip: res.zip });
    } catch (e: any) {
      console.error('Failed to run PDF extraction:', e.message || e);
      process.exit(1);
    }
  })();
}

// Playwright test wrapper 
test('pdf extractor - downloads PDFs and zips them', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const input = path.resolve(process.cwd(), 'data', 'pdfs.json');
  let list: any[] = [];
  try {
    const raw = await fsp.readFile(input, 'utf8');
    list = JSON.parse(raw);
  } catch (e) {
    console.log('No data/pdfs.json found or it is invalid; skipping automatic run inside test.');
    return;
  }

  const downloaded: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ item: any; reason: string }> = [];
  const destDir = path.join('output', 'pdfs');

  // Phase 1: concurrent fetch-based downloads
  const limit = pLimit(CONCURRENCY);
  const tasks = list.map((item) => limit(async () => {
    const res: any = await downloadIfPdf(item, destDir).catch((e) => ({ ok: false, reason: String(e) }));
    return { item, res };
  }));
  const results = await Promise.all(tasks);
  const toFallback: any[] = [];
  for (const r of results) {
    const { item, res } = r;
    if (res && res.ok && res.path) {
      if (res.skipped) skipped.push(String(res.path));
      else downloaded.push(String(res.path));
      console.log('Saved via fetch:', res.path);
    } else {
      toFallback.push(item);
    }
  }

  // Phase 2: sequential Playwright fallback for failures
  for (const item of toFallback) {
    const res: any = await processItem(item, destDir, page);
    if (res && res.ok && res.path) {
      if (res.skipped) skipped.push(String(res.path));
      else downloaded.push(String(res.path));
      console.log('Saved via fallback:', res.path);
    } else {
      failed.push({ item, reason: String(res?.reason) });
    }
  }

  // zip downloads
  const zipPath = path.resolve(path.dirname(destDir), path.basename(destDir) + '.zip');
  const zipRes = await zipFiles(downloaded, zipPath);

  console.log('PDF extraction summary:', { downloaded: downloaded.length, skipped: skipped.length, failed: failed.length, zip: zipRes.ok ? zipPath : undefined });
});
