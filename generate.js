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

// ═══════════════════════════════════════════
// PREPROCESSOR — strip custom markup before marked
// ═══════════════════════════════════════════
function preprocess(md) {
  let text = md
    // Normalize newlines
    .replace(/\r\n/g, '\n');

  // STEP 1: Extract blockquotes info-lines and wrap them
  // markdown blockquotes start with >
  text = text.replace(/^> (.+)$/gm, '<INFO>$1</INFO>');

  // STEP 2: Handle PIHAK sections
  // <!--PIHAK:PERTAMA: desc-->
  text = text.replace(/<!--PIHAK:(PERTAMA|KEDUA):\s*(.+?)-->/g, (m, num, desc) => {
    return `<PARTY_HEAD>${num}</PARTY_HEAD>\n<PARTY_DESC>${desc}</PARTY_DESC>`;
  });
  text = text.replace(/<!--\/PIHAK-->/g, '<PARTY_END>');

  // STEP 3: Handle SIG_START / SIG_END
  text = text.replace(/<!--SIG_START-->/g, '<SIG_BLOCK>');
  text = text.replace(/<!--SIG_END-->/g, '</SIG_BLOCK>');

  // STEP 4: Handle TTD markers
  text = text.replace(/\[TTD_LEFT\]\s*\[TTD_RIGHT\]/g, '<TTD_LINE></TTD_LINE>');

  // STEP 5: Handle **Name** **Name** signature lines
  // Detect line with two **Name** tokens separated by spaces
  text = text.replace(/^\*\*(.+?)\*\*\s+\*\*(.+?)\*\*$/gm, (m, name1, name2) => {
    return `<SIG_NAMES><name>${name1}</name><name>${name2}</name></SIG_NAMES>`;
  });

  // STEP 6: Handle [TTD_LEFT] [TTD_RIGHT] (already done)
  // STEP 7: Handle Demikian statements
  // Just let them pass through as regular text (italic)

  return text;
}

// ═══════════════════════════════════════════
// POSTPROCESSOR — convert custom tags to HTML
// ═══════════════════════════════════════════
function postprocess(html, doc) {
  // INFO boxes
  const infoTags = [...html.matchAll(/<INFO>([^<]+)<\/INFO>/g)];
  if (infoTags.length > 0) {
    const infoHtml = infoTags.map(m => m[1]).map(line => {
      // Handle bold markers
      line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return `<p>${line}</p>`;
    }).join('');
    // Remove original INFO tags and replace with one box
    html = html.replace(/(<INFO>[^<]*<\/INFO>\s*)+/g, '');
    // But we'll inject at the start of body - handled in the wrapping
    html = html.replace('<div class="doc-body">', `<div class="doc-body">\n<div class="info-box">${infoHtml}</div>\n`);
  }

  // PARTY sections
  html = html.replace(/<PARTY_HEAD>(PERTAMA|KEDUA)<\/PARTY_HEAD>\n?<PARTY_DESC>([^<]+)<\/PARTY_DESC>([\s\S]*?)<PARTY_END>/g, (m, num, desc, detail) => {
    // Clean detail - remove leading/trailing empty lines, bold markers
    const cleaned = detail
      .replace(/<p>/g, '')
      .replace(/<\/p>/g, '<br>')
      .replace(/<br>\s*<br>/g, '<br>')
      .replace(/\*\*/g, '')
      .replace(/^<br>/, '')
      .replace(/<br>$/, '')
      .split('<br>')
      .filter(l => l.trim())
      .map(l => l.trim())
      .join('<br>');

    return `<div class="party-section">
      <div class="party-header">PIHAK ${num}</div>
      <div class="party-desc">${desc}</div>
      <div class="party-details">${cleaned}</div>
    </div>`;
  });

  // SIG_BLOCK
  html = html.replace(/<SIG_BLOCK>([\s\S]*?)<\/SIG_BLOCK>/g, (m, inner) => {
    // Extract the two names from SIG_NAMES tags
    const names = [...inner.matchAll(/<name>([^<]+)<\/name>/g)].map(x => x[1]);

    // Also check for plain ** ** in remaining text
    const plainNames = [...inner.matchAll(/\*\*([^*]+)\*\*/g)].map(x => x[1]);

    const allNames = names.length >= 2 ? names : (plainNames.length >= 2 ? plainNames : ['Pihak I', 'Pihak II']);

    // Check if we have a TTD line
    const hasTtd = inner.includes('<TTD_LINE>');

    // Build signature columns — take LAST 2 names
    const cols = allNames.slice(-2).map(n => {
      const isNameBracket = n.includes('[') || n.includes(']') || n.includes('Nama');
      return `<div class="sig-col">
        <div class="sig-space"></div>
        <div class="sig-line">${n.replace(/[*\[\]]/g, '')}</div>
        ${hasTtd ? '<div class="sig-mark">(Tanda tangan &amp; meterai)</div>' : ''}
      </div>`;
    }).join('');

    return `<div class="signature-block">
      <div class="signature-row">${cols}</div>
    </div>`;
  });

  // Remove leftover TTD_LINE tags
  html = html.replace(/<TTD_LINE><\/TTD_LINE>/g, '');

  // Handle remaining Demikian as closing
  html = html.replace(/<p>\*\*Demikian([^*]+)\*\*<\/p>/g, (m, text) => {
    return `<div class="closing-statement"><p>Demikian${text}</p></div>`;
  });

  // Clean up party end tags
  html = html.replace(/<PARTY_END>/g, '');

  // Checkbox inputs
  html = html.replace(/<input[^>]*type="checkbox"[^>]*>/g, '☐ ');

  // Clean empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Clean multiple <br>s
  html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

  // Clean extra spacing in strong/em
  html = html.replace(/<\/strong>\s*<strong>/g, ' / ');

  return html;
}

// ═══════════════════════════════════════════
// BUILD HTML
// ═══════════════════════════════════════════
function buildHtml(md, doc) {
  const titleMatch = md.match(/^# (.+)$/m);
  const docTitle = titleMatch ? titleMatch[1].replace(/\*\*/g, '') : doc.title;
  let body = md.replace(/^# .+\n?/, '');
  body = preprocess(body);
  let content = marked.parse(body);
  content = postprocess(content, doc);

  const today = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <style>${css}</style>
</head>
<body>
  <div class="doc-wrapper">
    <div class="doc-header">
      <div class="doc-header-row">
        <div class="doc-id">${doc.id}</div>
        <div class="doc-title">${docTitle}</div>
        <div class="doc-date">${today}</div>
      </div>
      <div class="doc-header-line"></div>
    </div>
    <div class="doc-body">
      ${content}
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════
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
    margin: { top: '32mm', bottom: '30mm', left: '30mm', right: '28mm' },
    displayHeaderFooter: true,
    headerTemplate: `<div style="width:100%;font-size:7pt;color:#888;font-family:'Times New Roman',serif;padding:0 28mm;text-align:right;"><span class="title"></span></div>`,
    footerTemplate: `<div style="width:100%;font-size:8pt;color:#888;font-family:'Times New Roman',serif;padding:0 28mm;text-align:center;">
      <div style="border-top:0.5px solid #aaa;padding-top:1mm;">— <span class="pageNumber"></span> —</div>
    </div>`,
  });
  await browser.close();
  const size = (readFileSync(outPath).length / 1024).toFixed(0);
  console.log(`✅ ${outPath.split('/').pop()} (${size}KB)`);
}

// ═══════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════
console.log('🚀 Generating legal PDF documents...\n');

for (const doc of docs) {
  const md = readFileSync(join(__dirname, doc.file), 'utf-8');
  const html = buildHtml(md, doc);
  const outPath = join(outDir, doc.file.replace(/\.md$/, '.pdf'));
  await genPdf(html, outPath);
}

console.log(`\n🎉 ${docs.length} PDF selesai!`);
