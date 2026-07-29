import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';
import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Ordered docs ──────────────────────────
const docs = [
  { file: '01-project-brief.md',     title: 'Project Brief',                    id: 'FRM-PB' },
  { file: '02-proposal.md',           title: 'Proposal & Quotation',            id: 'FRM-PQ' },
  { file: '03-nda.md',                title: 'Non-Disclosure Agreement',         id: 'FRM-NDA' },
  { file: '04-spk.md',                title: 'Surat Perjanjian Kerja (SPK)',     id: 'FRM-SPK' },
  { file: '05-sow.md',                title: 'Statement of Work (SOW)',          id: 'FRM-SOW' },
  { file: '06-change-order.md',       title: 'Change Order',                     id: 'FRM-CO' },
  { file: '07-progress-report.md',    title: 'Laporan Progress & Meeting Notes', id: 'FRM-PR' },
  { file: '08-bast-uat.md',           title: 'BAST & UAT',                       id: 'FRM-BAST' },
  { file: '09-invoice.md',            title: 'Invoice',                          id: 'FRM-INV' },
  { file: '10-maintenance.md',        title: 'Perjanjian Maintenance & Support', id: 'FRM-MAINT' },
];

const css = readFileSync(join(__dirname, 'style.css'), 'utf-8');

const chromePaths = [
  '/home/abdanzamzam/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
  '/home/abdanzamzam/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
  '/home/abdanzamzam/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
  '/snap/bin/chromium',
];
const chromePath = chromePaths.find(p => { try { readFileSync(p); return true; } catch { return false; } }) || chromePaths[0];

const outDir = join(__dirname, 'pdf');
mkdirSync(outDir, { recursive: true });

// ─── Footer template ───────────────────────
const footerTmpl = [
  `<div style="width:100%;text-align:center;font-size:8pt;color:#94a3b8;font-family:Inter,sans-serif;">`,
  `  <span style="margin:0 15mm;">— <span class="pageNumber"></span> —</span>`,
  `</div>`,
].join('');

// ─── Header template ───────────────────────
const headerTmpl = [
  `<div style="width:100%;text-align:center;font-size:7.5pt;color:#94a3b8;font-family:Inter,sans-serif;">`,
  `  <span id="docTitle" style="margin:0 15mm;"></span>`,
  `</div>`,
].join('');

// ─── Transform MD to professional HTML ────
function wrapHtml(md, doc) {
  // Extract first heading as document title
  const titleMatch = md.match(/^# (.+)$/m);
  const docTitle = titleMatch ? titleMatch[1] : doc.title;

  // Remove the first heading (will use custom header)
  let body = md.replace(/^# .+\n?/, '');

  // Parse body with marked
  const content = marked.parse(body);

  // Transform tables: add classes
  // Transform blockquotes: they are already <blockquote>

  // Define page size base on content — SPK, BAST, NDA need full width
  const isLegal = ['04-spk.md', '03-nda.md', '08-bast-uat.md', '10-maintenance.md'].includes(doc.file);
  const isInvoice = doc.file === '09-invoice.md';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <style>
    ${css}
    ${isInvoice ? '.doc-wrapper { max-width: 100%; }' : ''}
  </style>
</head>
<body>
  <div class="doc-wrapper">

    <!-- Document Header -->
    <div class="doc-header">
      <h1 style="border:none;padding:0;margin:0;page-break-before:avoid;">${docTitle}</h1>
      ${isLegal ? `<div class="doc-sub">Dokumen Hukum — ${doc.id}</div>` : `<div class="doc-sub">Kode Dokumen: ${doc.id}</div>`}
    </div>

    <!-- Document Body -->
    <div class="doc-body">
      ${content}
    </div>

    <!-- Footer Note -->
    <div style="margin-top:10mm;padding-top:3mm;border-top:1px solid #e2e8f0;font-size:7.5pt;color:#94a3b8;text-align:center;">
      ${doc.title} — ${doc.id}<br>
      © ${new Date().getFullYear()} — Dokumen ini adalah template, isi sesuai kebutuhan project.
    </div>

  </div>
</body>
</html>`;
}

// ─── PDF generation ─────────────────────────
async function genPdf(html, outPath, isLegal) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    executablePath: chromePath,
  });

  const page = await browser.newPage();
  await page.setContent(html, {
    waitUntil: 'networkidle0',
    timeout: 30000,
  });

  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '18mm',
      bottom: '18mm',
      left: isLegal ? '22mm' : '20mm',
      right: isLegal ? '22mm' : '20mm',
    },
    displayHeaderFooter: true,
    headerTemplate: headerTmpl,
    footerTemplate: footerTmpl,
  });

  await browser.close();
  console.log('✅', outPath);
}

// ─── MAIN ───────────────────────────────────
console.log('🚀 Generating profesional PDF documents...\n');

let i = 0;
for (const doc of docs) {
  i++;
  const md = readFileSync(join(__dirname, doc.file), 'utf-8');
  const html = wrapHtml(md, doc);
  const outPath = join(outDir, doc.file.replace(/\.md$/, '.pdf'));
  const isLegal = ['04-spk.md', '03-nda.md', '08-bast-uat.md', '10-maintenance.md'].includes(doc.file);
  await genPdf(html, outPath, isLegal);
}

console.log(`\n🎉 ${docs.length} PDF profesional berhasil dibuat di: ${outDir}/`);
