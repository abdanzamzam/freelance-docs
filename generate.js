import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { marked } from 'marked';
import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const docs = [
  { file: '01-project-brief.md',     title: 'Project Brief',                    id: 'FRM-PB-001' },
  { file: '02-proposal.md',          title: 'Proposal & Quotation',             id: 'FRM-PQ-001' },
  { file: '03-nda.md',               title: 'Non-Disclosure Agreement',         id: 'FRM-NDA-001' },
  { file: '04-spk.md',               title: 'Surat Perjanjian Kerja (SPK)',     id: 'FRM-SPK-001' },
  { file: '05-sow.md',               title: 'Statement of Work (SOW)',          id: 'FRM-SOW-001' },
  { file: '06-change-order.md',      title: 'Change Order',                     id: 'FRM-CO-001' },
  { file: '07-progress-report.md',   title: 'Progress Report & Meeting Notes',  id: 'FRM-PR-001' },
  { file: '08-bast-uat.md',          title: 'BAST & UAT',                       id: 'FRM-BAST-001' },
  { file: '09-invoice.md',           title: 'Invoice',                          id: 'FRM-INV-001' },
  { file: '10-maintenance.md',       title: 'Perjanjian Maintenance',           id: 'FRM-MAINT-001' },
];

const css = readFileSync(join(__dirname, 'style.css'), 'utf-8');
const chromePaths = [
  '/home/abdanzamzam/.cache/puppeteer/chrome/linux-150.0.7871.24/chrome-linux64/chrome',
  '/home/abdanzamzam/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome',
  '/snap/bin/chromium',
].filter(p => { try { return !!readFileSync(p); } catch { return false; } });
const chromePath = chromePaths[0];

const outDir = join(__dirname, 'pdf');
mkdirSync(outDir, { recursive: true });

// ─── Preprocess markdown ──────────────────
function preprocess(md) {
  return md
    // Checklist
    .replace(/- \[ \]/g, '- ☐')
    .replace(/- \[x\]/g, '- ☑')
    .replace(/- \[✓\]/g, '- ☑')
    // Clean nbsp entities
    .replace(/&nbsp;/g, ' ')
    // Collapse multiple spaces
    .replace(/ {2,}/g, ' ');
}

// ─── Post-process HTML ─────────────────────
function postprocess(html, docId) {
  // Wrap PIHAK PERTAMA/KEDUA
  html = html.replace(
    /<p><strong>PIHAK (PERTAMA|KEDUA)<\/strong>\s*—\s*(.+?)<\/p>/g,
    (m, num, desc) => `<div class="party-header">PIHAK ${num}</div><div class="party-desc">${desc}</div>`
  );

  // Pasal titles (h3)
  html = html.replace(/<h3\s*>/g, '<h3 class="pasal-title">');

  // Tanda tangan sections: look for two **[Name]** separated by text
  html = html.replace(
    /\(Tanda tangan &amp; meterai\)\s*&amp;nbsp;\s*\(Tanda tangan &amp; meterai\)/g,
    '(Tanda tangan & meterai)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;(Tanda tangan & meterai)'
  );

  // Signature block — detect "[Nama Klien]" / "[Nama Kamu]" patterns
  html = html.replace(
    /<p>\*\*(?:Nama Klien|Nama Kamu|Nama (?:Client|Pengembang|Klien|Kamu))\*\*(?:<\/strong>)?(?:\s|&nbsp;)*(?:\*\*(?:Nama Klien|Nama Kamu|Nama (?:Client|Pengembang|Klien|Kamu))\*\*)?<\/p>/g,
    (m) => {
      // Extract names
      const names = [...m.matchAll(/\*\*([^*]+)\*\*/g)].map(x => x[1]);
      if (names.length === 0) return m;

      const cols = names.map(n => {
        const isMaterai = n.toLowerCase().includes('tanda tangan') || n.toLowerCase().includes('meterai');
        return `<div class="ttd-col">
          <span class="sig-space"></span>
          <div class="sig-name">${n.replace(/&amp;/g, '&')}</div>
          <div class="sig-materai">(meterai Rp10.000)</div>
        </div>`;
      }).join('');

      return `<div class="ttd-line">${cols}</div>`;
    }
  );

  return html;
}

// ─── Build full HTML page ──────────────────
function buildHtml(md, doc) {
  const titleMatch = md.match(/^# (.+)$/m);
  const docTitle = titleMatch ? titleMatch[1].replace(/\*\*/g, '') : doc.title;
  const body = preprocess(md.replace(/^# .+\n?/, ''));

  const today = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  // Manually parse the content with marked
  const parsed = marked.parse(body);

  // Post-process
  const content = postprocess(parsed, doc.id);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <style>
${css}
  </style>
</head>
<body>
  <div class="doc-wrapper">
    <div class="doc-header">
      <div class="doc-header-inner">
        <div class="doc-header-row">
          <span class="doc-id">${doc.id}</span>
          <span class="doc-title-line">${docTitle}</span>
          <span class="doc-date">${today}</span>
        </div>
      </div>
      <div class="doc-header-spacer"></div>
    </div>
    <div class="doc-body">
      ${content}
    </div>
  </div>
</body>
</html>`;
}

// ─── Generate PDF ──────────────────────────
async function genPdf(html, outPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    executablePath: chromePath,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '18mm', left: '22mm', right: '18mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-size:7pt;color:#888;font-family:'Times New Roman',serif;padding:0 22mm;text-align:right;font-style:italic;">
      <span class="title"></span>
    </div>`,
    footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#888;font-family:'Times New Roman',serif;padding:0 22mm;text-align:center;">
      <div style="border-top:0.5px solid #bbb;padding-top:0.5mm;">— <span class="pageNumber"></span> —</div>
    </div>`,
  });

  await browser.close();
  const size = (readFileSync(outPath).length / 1024).toFixed(0);
  console.log(`✅ ${outPath.split('/').pop()} (${size}KB)`);
}

// ─── MAIN ───────────────────────────────────
console.log('🚀 Generating legal PDF documents (Times New Roman style)...\n');

for (const doc of docs) {
  const md = readFileSync(join(__dirname, doc.file), 'utf-8');
  const html = buildHtml(md, doc);
  const outPath = join(outDir, doc.file.replace(/\.md$/, '.pdf'));
  await genPdf(html, outPath);
}

console.log(`\n🎉 ${docs.length} PDF selesai!`);
