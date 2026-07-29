import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';
import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ordered docs to generate
const docs = [
  { file: '01-project-brief.md', title: 'Project Brief' },
  { file: '02-proposal.md', title: 'Proposal & Quotation' },
  { file: '03-nda.md', title: 'Non-Disclosure Agreement' },
  { file: '04-spk.md', title: 'Surat Perjanjian Kerja (SPK)' },
  { file: '05-sow.md', title: 'Statement of Work (SOW)' },
  { file: '06-change-order.md', title: 'Change Order' },
  { file: '07-progress-report.md', title: 'Laporan Progress & Catatan Meeting' },
  { file: '08-bast-uat.md', title: 'BAST & UAT' },
  { file: '09-invoice.md', title: 'Invoice' },
  { file: '10-maintenance.md', title: 'Perjanjian Maintenance & Support' },
];

const css = readFileSync(join(__dirname, 'style.css'), 'utf-8');

const chromePath = '/home/abdanzamzam/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome';
const outDir = join(__dirname, 'pdf');

// Footer template
const footerTemplate = [
  `<div style="width:100%;text-align:center;font-size:8pt;color:#64748b;font-family:Inter,sans-serif;">`,
  `  <span class="pageNumber"></span>`,
  `</div>`,
].join('');

async function genPdf(html, outPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: chromePath,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '18mm', left: '20mm', right: '20mm' },
    displayHeaderFooter: true,
    footerTemplate,
    headerTemplate: '<div></div>',
  });
  await browser.close();
  console.log('✅', outPath);
}

mkdirSync(outDir, { recursive: true });

for (const doc of docs) {
  const md = readFileSync(join(__dirname, doc.file), 'utf-8');
  const content = marked.parse(md);

  const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><style>
${css}
@page { size: A4; margin: 0; }
body { font-family: 'Inter', 'Segoe UI', sans-serif; color: #1e293b; line-height: 1.7; }
</style></head><body>
<div class="doc-wrapper">
${content}
</div>
</body></html>`;

  const outPath = join(outDir, doc.file.replace(/\.md$/, '.pdf'));
  await genPdf(html, outPath);
}

console.log('\n🎉 Semua PDF selesai!');
