import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import type { loadOrder } from './orderService.js';

type OrderData = Awaited<ReturnType<typeof loadOrder>>;
export interface StoreInfo { name: string; address: string | null; phone: string | null; email: string | null }

const LOGO = fileURLToPath(new URL('../assets/logo.png', import.meta.url));
const BRAND = '#0B5ED7';
const INK = '#0F2147';
const MUTED = '#5B6B8A';
const LINE = '#DCE5F5';
const SOFT = '#EEF4FF';

// Helvetica has no rupee sign, so amounts are written as "Rs."
const money = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-');
const dateTime = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '-');
const METHOD: Record<string, string> = { cod: 'Cash on delivery', razorpay: 'Online payment' };

/** Invoices exist once the customer has accepted the amount. */
export const INVOICE_STATUSES = ['ready_to_dispatch', 'out_for_delivery', 'delivered'];

/** Streams a one-page A4 invoice (store header, customer, items, totals, payment, footer) to the response. */
export function streamInvoice(res: Response, o: OrderData, store: StoreInfo, prescriptionImages: Buffer[] = []) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Invoice ${o.orderNumber}`, Author: store.name } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Invoice-${o.orderNumber}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  doc.pipe(res);

  const W = doc.page.width, L = 40, R = W - 40, inner = R - L;

  // Header band
  doc.rect(0, 0, W, 104).fill(BRAND);
  // App logo on a white tile so it stays readable on the blue band.
  let textX = L;
  if (existsSync(LOGO)) {
    doc.roundedRect(L, 16, 72, 72, 12).fill('#FFFFFF');
    doc.image(LOGO, L + 4, 20, { fit: [64, 64], align: 'center', valign: 'center' });
    textX = L + 86;
  }
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(20).text(store.name, textX, 32, { width: inner * 0.55 - (textX - L) + 40 });
  doc.font('Helvetica').fontSize(9.5).fillColor('#DDE8FF').text('Medicines delivered to your door', textX, 60, { width: inner * 0.55 });
  doc.font('Helvetica-Bold').fontSize(26).fillColor('#FFFFFF').text('INVOICE', L, 30, { width: inner, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#DDE8FF').text(`No. ${o.orderNumber}`, L, 64, { width: inner, align: 'right' });

  // Meta + customer
  let y = 128;
  const colW = inner / 2 - 10;
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8.5).text('INVOICE DETAILS', L, y).text('BILLED TO', L + colW + 20, y);
  y += 16;
  const meta: [string, string][] = [
    ['Invoice no.', o.orderNumber], ['Order date', date(o.createdAt)],
    ['Delivery', o.deliverySlot ? `${date(o.deliveryDate)}, ${o.deliverySlot}` : date(o.deliveryDate)], ...(o.deliveredAt ? [['Delivered on', dateTime(o.deliveredAt)] as [string, string]] : []),
  ];
  let my = y;
  for (const [k, v] of meta) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(k, L, my, { width: 80 });
    doc.font('Helvetica-Bold').fillColor(INK).text(v, L + 84, my, { width: colW - 84 });
    my += 16;
  }
  const a = o.address;
  const addr = [a.line1, a.line2, a.landmark, `${a.city} - ${a.pincode}`].filter(Boolean).join(', ');
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(o.customer?.name ?? a.recipientName, L + colW + 20, y, { width: colW });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(addr, L + colW + 20, doc.y + 2, { width: colW });
  if (a.phone ?? o.customer?.phone) doc.text(`Phone: ${a.phone ?? o.customer?.phone}`, L + colW + 20, doc.y + 2, { width: colW });
  y = Math.max(my, doc.y) + 22;

  // Items table
  doc.roundedRect(L, y, inner, 26, 6).fill(SOFT);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND).text('#', L + 12, y + 8, { width: 24 }).text('ITEM', L + 44, y + 8, { width: inner - 140 }).text('QTY', R - 70, y + 8, { width: 58, align: 'right' });
  y += 34;
  const rows = o.items.length ? o.items : [{ id: 'rx', name: 'Medicines as per your uploaded prescription', quantity: 1 }];
  rows.forEach((it, i) => {
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(String(i + 1), L + 12, y, { width: 24 }).text(it.name, L + 44, y, { width: inner - 140 }).text(String(it.quantity), R - 70, y, { width: 58, align: 'right' });
    y = Math.max(y + 18, doc.y + 6);
    doc.moveTo(L, y - 4).lineTo(R, y - 4).strokeColor(LINE).lineWidth(0.6).stroke();
    if (y > 640) { doc.addPage(); y = 50; }
  });

  // Totals
  y += 12;
  const bx = L + inner * 0.52, bw = inner * 0.48;
  const line = (k: string, v: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10.5).fillColor(bold ? INK : MUTED).text(k, bx, y, { width: bw * 0.5 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(INK).text(v, bx + bw * 0.4, y, { width: bw * 0.6, align: 'right' });
    y += bold ? 24 : 19;
  };
  line('Items total', money(o.quotedAmount ?? 0));
  line('Delivery charges', 'Free');
  doc.moveTo(bx, y).lineTo(R, y).strokeColor(LINE).lineWidth(0.8).stroke();
  y += 8;
  doc.roundedRect(bx - 8, y - 4, bw + 8, 32, 6).fill(SOFT);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text('Total amount', bx, y + 6, { width: bw * 0.5 });
  doc.text(money(o.quotedAmount ?? 0), bx + bw * 0.4, y + 6, { width: bw * 0.6 - 8, align: 'right' });
  y += 46;

  // Payment + delivery
  const paid = o.paymentStatus === 'paid' || o.paymentStatus === 'cod_collected';
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('PAYMENT', L, y - 40 + 0, { width: colW });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(`${METHOD[o.paymentMethod ?? ''] ?? 'To be confirmed'}`, L, y - 26, { width: colW });
  doc.font('Helvetica').fontSize(10).fillColor(paid ? '#14804A' : MUTED).text(paid ? 'Payment received' : 'Payment pending', L, doc.y + 2, { width: colW });
  if (o.partner?.name) doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Delivered by ${o.partner.name}`, L, doc.y + 8, { width: colW });
  y = Math.max(y, doc.y) + 30;

  // Footer
  const fy = Math.max(y, 700);
  doc.moveTo(L, fy).lineTo(R, fy).strokeColor(LINE).lineWidth(0.8).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Thank you for choosing ${store.name}.`, L, fy + 12, { width: inner, align: 'center' });
  const contact = [store.address, store.phone ? `Phone: ${store.phone}` : null, store.email].filter(Boolean).join('   |   ');
  if (contact) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(contact, L, fy + 30, { width: inner, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('This is a computer-generated invoice and does not need a signature. Amount is inclusive of applicable taxes.', L, fy + 48, { width: inner, align: 'center' });

  // The prescription the customer uploaded, so the invoice shows what the order was made from.
  if (prescriptionImages.length) {
    doc.addPage();
    let py = 50;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('PRESCRIPTION SUBMITTED WITH THIS ORDER', L, py);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Order ${o.orderNumber} · ${o.address.recipientName}`, L, py + 14);
    py += 40;
    for (const buf of prescriptionImages) {
      let img: { width: number; height: number };
      try { img = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(buf); } catch { continue; }
      const maxH = 340;
      if (py + 120 > doc.page.height - 50) { doc.addPage(); py = 50; }
      const room = Math.min(maxH, doc.page.height - 50 - py);
      const scale = Math.min(inner / img.width, room / img.height, 1.5);
      const w = img.width * scale, h = img.height * scale;
      doc.roundedRect(L + (inner - w) / 2 - 4, py - 4, w + 8, h + 8, 6).lineWidth(0.8).strokeColor(LINE).stroke();
      doc.image(buf, L + (inner - w) / 2, py, { width: w, height: h });
      py += h + 22;
    }
  }

  doc.end();
}
