'use strict';
// Minimal dependency-free PDF writer: one or more A4 pages of Helvetica text lines.
// Used for the downloadable order receipt.

function esc(s) {
  return String(s).replace(/[^\x20-\x7e]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * lines: array of { text, size?, bold?, gap? }
 */
function buildPdf(lines) {
  const pageH = 842, margin = 56;
  const pages = [[]];
  let y = pageH - margin;
  for (const ln of lines) {
    const size = ln.size || 11;
    const lead = size * 1.5 + (ln.gap || 0);
    if (y - lead < margin) { pages.push([]); y = pageH - margin; }
    pages[pages.length - 1].push(`BT /${ln.bold ? 'F2' : 'F1'} ${size} Tf ${margin} ${y.toFixed(1)} Td (${esc(ln.text)}) Tj ET`);
    y -= lead;
  }
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages placeholder (object 2)
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids = [];
  for (const p of pages) {
    const content = p.join('\n');
    const cid = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pid = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`);
    kids.push(`${pid} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function receiptPdf(order, items, buyer) {
  const kes = (n) => 'KES ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = [
    { text: 'AgriConnect - Order Receipt', size: 20, bold: true, gap: 8 },
    { text: `Receipt No: AC-${String(order.order_id).padStart(5, '0')}`, bold: true },
    { text: `Date: ${order.created_at} UTC` },
    { text: `Status: ${order.status}` },
    { text: `Buyer: ${buyer.full_name} (${buyer.email})`, gap: 4 },
    { text: `Delivery address: ${order.delivery_address}`, gap: 12 },
    { text: 'Item                                   Qty      Unit price        Subtotal', bold: true },
  ];
  for (const it of items) {
    const name = String(it.name).slice(0, 30).padEnd(34, ' ');
    lines.push({ text: `${name}${String(it.quantity).padEnd(8)}${kes(it.unit_price).padEnd(18)}${kes(it.unit_price * it.quantity)}` });
  }
  lines.push({ text: '-----------------------------------------------------------------------------', gap: 2 });
  lines.push({ text: `TOTAL: ${kes(order.total)}`, size: 14, bold: true, gap: 10 });
  lines.push({ text: 'Thank you for buying directly from Kenyan farmers.', size: 10 });
  return buildPdf(lines);
}

module.exports = { buildPdf, receiptPdf };
