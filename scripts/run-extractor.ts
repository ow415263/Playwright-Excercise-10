import fs from 'fs/promises';
import path from 'path';
import { runPdfExtraction } from '../tests/pdf.extractor.spec';

const INPUT = path.resolve(process.cwd(), 'data', 'pdfs.json');
const OUT_JSON = path.resolve(process.cwd(), 'output', 'extraction-result.json');

(async () => {
  try {
    const raw = await fs.readFile(INPUT, 'utf8');
    const list = JSON.parse(raw);
    const res = await runPdfExtraction(list);
    await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
    await fs.writeFile(OUT_JSON, JSON.stringify(res, null, 2), 'utf8');
    console.log('WROTE', OUT_JSON);
    console.log('PDF extraction finished:', { downloaded: res.downloaded.length, skipped: res.skipped.length, failed: res.failed.length, zip: res.zip });
  } catch (err: any) {
    console.error('Runner error:', err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
