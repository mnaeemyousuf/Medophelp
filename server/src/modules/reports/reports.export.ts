import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { BRAND, type ReportColumn, type ReportResult } from '@hms/shared';
import { drawBrandMark } from '../../core/pdf/documents';
import { requireCtx } from '../../core/context';
import { Hospital } from '../organization/organization.models';

type Cell = string | number | null | undefined;

async function hospitalInfo() {
  const h = await Hospital.findById(requireCtx().hospitalId).select('name address city phone currency').lean();
  return { name: h?.name ?? 'Hospital', address: [h?.address, h?.city].filter(Boolean).join(', '), currency: h?.currency ?? 'PKR' };
}

function display(v: Cell, col: ReportColumn, currency: string) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (col.type === 'money') return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (col.type === 'percent') return `${v}%`;
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** CSV with a UTF-8 BOM so Excel opens non-ASCII text correctly; formula-like cells are neutralised. */
export function toCsv(r: ReportResult) {
  const esc = (v: Cell) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s) && typeof v === 'string') s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => esc(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => esc(row[c.key])).join(','));
  if (r.totals) lines.push(r.columns.map((c) => esc(r.totals![c.key])).join(','));
  return Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8');
}

export async function toXlsx(r: ReportResult) {
  const h = await hospitalInfo();
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.name;
  wb.created = new Date();
  const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
  const ws = wb.addWorksheet(r.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.addRow([h.name]).font = { bold: true, size: 14, color: { argb: argb(BRAND.colors.blue) } };
  ws.addRow([`${r.title} — ${r.subtitle}`]).font = { bold: true, color: { argb: argb(BRAND.colors.navy) } };
  ws.addRow([`Generated ${new Date(r.generatedAt).toLocaleString('en-GB')} · Powered by ${BRAND.name}`]).font = { italic: true, color: { argb: argb(BRAND.colors.slate) } };
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
  for (const row of r.rows) ws.addRow(r.columns.map((c) => row[c.key] ?? null));
  if (r.totals) ws.addRow(r.columns.map((c) => r.totals![c.key] ?? null)).font = { bold: true };
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    else if (c.type === 'percent') col.numFmt = '0.0"%"';
    else if (c.type === 'number') col.numFmt = '#,##0.##';
    const width = Math.max(c.label.length, ...r.rows.slice(0, 200).map((row) => String(row[c.key] ?? '').length));
    col.width = Math.min(45, Math.max(10, width + 2));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(r: ReportResult) {
  const h = await hospitalInfo();
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: r.columns.length > 6 ? 'landscape' : 'portrait', margin: 36, bufferPages: true, info: { Title: r.title, Producer: BRAND.name, Creator: BRAND.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - 72;
    const head = () => {
      doc.rect(0, 0, doc.page.width, 5).fill(doc.linearGradient(0, 0, doc.page.width, 0).stop(0, BRAND.colors.blue).stop(1, BRAND.colors.teal));
      doc.fillColor(BRAND.colors.blue).font('Helvetica-Bold').fontSize(13).text(h.name, 36, 22);
      doc.fillColor(BRAND.colors.slate).font('Helvetica').fontSize(8).text(h.address);
      doc.fillColor(BRAND.colors.navy).font('Helvetica-Bold').fontSize(12).text(r.title, 36, 22, { align: 'right', width: W });
      doc.fillColor(BRAND.colors.slate).font('Helvetica').fontSize(8).text(r.subtitle, { align: 'right', width: W });
      doc.y = 62;
    };
    // Column widths proportional to content, numbers right-aligned.
    const weights = r.columns.map((c) => Math.min(30, Math.max(c.label.length, ...r.rows.slice(0, 100).map((row) => display(row[c.key], c, h.currency).length))) + 2);
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * W);
    const numeric = (c: ReportColumn) => ['number', 'money', 'percent'].includes(c.type ?? '');
    const fs = r.columns.length > 9 ? 6.5 : 7.5;

    const headerRow = () => {
      let x = 36;
      doc.rect(36, doc.y, W, 16).fill(BRAND.colors.tint);
      doc.fillColor('#334155').font('Helvetica-Bold').fontSize(fs);
      const y = doc.y + 4;
      r.columns.forEach((c, i) => {
        doc.text(c.label, x + 3, y, { width: widths[i] - 6, align: numeric(c) ? 'right' : 'left', lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + 14;
    };
    const line = (row: Record<string, Cell>, bold = false) => {
      const cells = r.columns.map((c) => display(row[c.key], c, h.currency));
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
      const hgt = Math.max(...cells.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i] - 6 })));
      if (doc.y + hgt > doc.page.height - 50) {
        doc.addPage();
        head();
        headerRow();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fs);
      }
      const y = doc.y;
      let x = 36;
      doc.fillColor(BRAND.colors.navy);
      cells.forEach((t, i) => {
        doc.text(t, x + 3, y, { width: widths[i] - 6, align: numeric(r.columns[i]) ? 'right' : 'left' });
        x += widths[i];
      });
      doc.y = y + hgt + 4;
      doc.moveTo(36, doc.y - 2).lineTo(36 + W, doc.y - 2).strokeColor(BRAND.colors.line).lineWidth(0.5).stroke();
    };

    head();
    headerRow();
    if (!r.rows.length) doc.fillColor(BRAND.colors.slate).font('Helvetica').fontSize(9).text('No data for the selected filters.', 36, doc.y + 6);
    for (const row of r.rows) line(row);
    if (r.totals) line(r.totals, true);

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      // Writing below the bottom margin would otherwise make pdfkit start a new page.
      doc.page.margins.bottom = 0;
      const foot = `Generated ${new Date(r.generatedAt).toLocaleString('en-GB')} · Page ${i + 1} of ${pages.count} · Confidential · Powered by ${BRAND.name}`;
      doc.font('Helvetica').fontSize(7);
      const fx = 36 + (W - doc.widthOfString(foot) - 12) / 2;
      drawBrandMark(doc, fx, doc.page.height - 31, 8);
      doc.fillColor(BRAND.colors.slate).text(foot, fx + 12, doc.page.height - 30, { lineBreak: false });
    }
    doc.end();
  });
}
