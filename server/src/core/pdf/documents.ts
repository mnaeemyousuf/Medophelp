import PDFDocument from 'pdfkit';
import { ageFromDob, BRAND as PRODUCT, POWERED_BY } from '@hms/shared';
import { requireCtx } from '../context';
import { createdAtOf, orNotFound, toDateString } from '../http';
import { recordAudit } from '../audit/audit';
import { Hospital } from '../../modules/organization/organization.models';
import { Patient } from '../../modules/patients/patient.models';
import { Prescription } from '../../modules/clinical/clinical.models';
import { Invoice, Payment } from '../../modules/billing/billing.models';
import { assertClinicalAccess } from '../../modules/patients/access';
import { ForbiddenError } from '../errors';

type Doc = PDFKit.PDFDocument;
const BRAND = PRODUCT.colors.blue;
const MUTED = PRODUCT.colors.slate;
const INK = PRODUCT.colors.navy;

/** Medophelp mark (same geometry as branding/logo/medophelp-mark.svg), drawn as vectors. */
export function drawBrandMark(doc: Doc, x: number, y: number, size: number) {
  const k = size / 64;
  doc.save();
  const grad = doc.linearGradient(x, y, x + size, y + size).stop(0, PRODUCT.colors.blue).stop(1, PRODUCT.colors.teal);
  doc.roundedRect(x, y, size, size, 16 * k).fill(grad);
  const pts = [[10, 41], [19, 41], [24.5, 23], [32, 39], [39.5, 23], [45, 41], [54, 41]];
  doc.moveTo(x + pts[0][0] * k, y + pts[0][1] * k);
  for (const [px, py] of pts.slice(1)) doc.lineTo(x + px * k, y + py * k);
  doc.lineWidth(5 * k).lineCap('round').lineJoin('round').strokeColor('#FFFFFF').stroke();
  doc.translate(x, y).scale(k).path('M48.5 9.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z').fill('#FFFFFF');
  doc.restore();
}

/** Bottom line on every page: small mark + 'Powered by Medophelp — <brand line>'. */
export function drawPoweredBy(doc: Doc, y: number, left = 48) {
  const width = doc.page.width - left * 2;
  doc.fontSize(7.5).font('Helvetica');
  const textW = doc.widthOfString(POWERED_BY);
  const x0 = left + (width - (textW + 13)) / 2;
  drawBrandMark(doc, x0, y - 1, 9);
  doc.fillColor(MUTED).text(POWERED_BY, x0 + 13, y, { lineBreak: false });
}

function render(build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Producer: PRODUCT.name, Creator: PRODUCT.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

async function loadHospital() {
  return orNotFound(await Hospital.findById(requireCtx().hospitalId).lean(), 'Hospital');
}

function header(doc: Doc, h: Awaited<ReturnType<typeof loadHospital>>, title: string, number?: string) {
  doc.rect(0, 0, doc.page.width, 6).fill(doc.linearGradient(0, 0, doc.page.width, 0).stop(0, PRODUCT.colors.blue).stop(1, PRODUCT.colors.teal));
  doc.fillColor(BRAND).fontSize(18).font('Helvetica-Bold').text(h.name, 48, 30);
  doc.fillColor(MUTED).fontSize(9).font('Helvetica')
    .text([h.address, h.city].filter(Boolean).join(', '))
    .text([h.phone && `Tel ${h.phone}`, h.email, h.website].filter(Boolean).join('  ·  '));
  doc.fillColor(INK).fontSize(14).font('Helvetica-Bold').text(title, 48, 30, { align: 'right' });
  if (number) doc.fontSize(10).font('Helvetica').fillColor(MUTED).text(number, { align: 'right' });
  doc.moveTo(48, 92).lineTo(doc.page.width - 48, 92).strokeColor(PRODUCT.colors.line).stroke();
  doc.y = 104;
  doc.x = 48;
}

function kv(doc: Doc, rows: Array<[string, string | undefined | null]>, x = 48, width = 250) {
  const y0 = doc.y;
  rows.forEach(([k, v], i) => {
    const y = y0 + i * 15;
    doc.fontSize(9).fillColor(MUTED).font('Helvetica').text(k, x, y, { width: 95 });
    doc.fillColor(INK).font('Helvetica-Bold').text(v || '—', x + 95, y, { width: width - 95 });
  });
  return y0 + rows.length * 15;
}

function footer(doc: Doc, note: string) {
  const y = doc.page.height - 64;
  // Writing below the bottom margin would make pdfkit start a new page.
  const bottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(48, y).lineTo(doc.page.width - 48, y).strokeColor(PRODUCT.colors.line).stroke();
  doc.fontSize(8).fillColor(MUTED).font('Helvetica').text(note, 48, y + 7, { width: doc.page.width - 96, align: 'center' });
  drawPoweredBy(doc, doc.page.height - 30);
  doc.page.margins.bottom = bottom;
}

function table(doc: Doc, cols: Array<{ label: string; width: number; align?: 'left' | 'right' }>, rows: string[][]) {
  let y = doc.y + 6;
  const x0 = 48;
  doc.rect(x0, y, doc.page.width - 96, 18).fill(PRODUCT.colors.tint);
  let x = x0 + 6;
  doc.fillColor('#334155').fontSize(8.5).font('Helvetica-Bold');
  for (const c of cols) {
    doc.text(c.label, x, y + 5, { width: c.width - 8, align: c.align ?? 'left' });
    x += c.width;
  }
  y += 22;
  doc.font('Helvetica').fillColor(INK).fontSize(9);
  for (const r of rows) {
    x = x0 + 6;
    const h = Math.max(...r.map((cell, i) => doc.heightOfString(cell, { width: cols[i].width - 8 })));
    if (y + h > doc.page.height - 90) {
      doc.addPage();
      y = 60;
    }
    r.forEach((cell, i) => {
      doc.text(cell, x, y, { width: cols[i].width - 8, align: cols[i].align ?? 'left' });
      x += cols[i].width;
    });
    y += h + 6;
    doc.moveTo(x0, y - 3).lineTo(doc.page.width - 48, y - 3).strokeColor(PRODUCT.colors.tint).stroke();
  }
  doc.y = y + 4;
  doc.x = 48;
}

const money = (n: number, cur: string) => `${cur} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function patientRegistrationPdf(patientId: string) {
  const h = await loadHospital();
  const p = orNotFound(await Patient.findById(patientId).lean(), 'Patient');
  await recordAudit({ action: 'patient.registration_printed', module: 'Patients', entity: 'Patient', entityId: p._id });
  return render((doc) => {
    header(doc, h, 'Patient Registration', p.mrn);
    const y1 = kv(doc, [
      ['Name', `${p.firstName} ${p.lastName}`],
      ['Father/Husband', p.guardianName],
      ['CNIC / ID', p.cnic],
      ['Date of birth', `${toDateString(p.dateOfBirth)} (${ageFromDob(p.dateOfBirth)} y)`],
      ['Gender', p.gender],
      ['Blood group', p.bloodGroup],
    ]);
    doc.y = 104;
    const y2 = kv(doc, [
      ['Phone', p.phone],
      ['Email', p.email],
      ['Address', [p.address, p.city].filter(Boolean).join(', ')],
      ['Emergency contact', [p.emergencyContactName, p.emergencyContactRelation, p.emergencyContactPhone].filter(Boolean).join(' · ')],
      ['Insurance', p.insurances?.filter((i) => !i.removedAt).map((i) => `${i.provider} ${i.policyNumber}`).join(', ')],
      ['Registered', toDateString(createdAtOf(p))],
    ], 310, 240);
    doc.y = Math.max(y1, y2) + 14;
    doc.x = 48;
    const allergies = p.allergies.filter((a) => !a.removedAt);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#b91c1c').text('Allergies');
    doc.fontSize(9).font('Helvetica').fillColor(INK).text(allergies.length ? allergies.map((a) => `${a.allergen} (${a.severity})`).join(', ') : 'No known allergies');
    doc.moveDown();
    doc.fontSize(11).font('Helvetica-Bold').fillColor(INK).text('Medical history');
    const hx = p.medicalHistory.filter((m) => !m.removedAt);
    doc.fontSize(9).font('Helvetica').text(hx.length ? hx.map((m) => `${m.condition}${m.isChronic ? ' (chronic)' : ''}`).join(', ') : 'None recorded');
    footer(doc, 'Please bring this summary and your MRN to every visit.');
  });
}

export async function prescriptionPdf(id: string) {
  const h = await loadHospital();
  const rx = orNotFound(await Prescription.findById(id).populate('doctorId', 'name specialization licenseNumber qualification').lean(), 'Prescription');
  await assertClinicalAccessOrPharmacy(rx.patientId);
  const p = orNotFound(await Patient.findById(rx.patientId).lean(), 'Patient');
  const d = rx.doctorId as unknown as { name: string; specialization: string; licenseNumber: string; qualification?: string };
  await recordAudit({ action: 'prescription.printed', module: 'Clinical', entity: 'Prescription', entityId: rx._id });
  return render((doc) => {
    header(doc, h, 'Prescription', rx.prescriptionNo);
    const y1 = kv(doc, [
      ['Patient', `${p.firstName} ${p.lastName}`],
      ['MRN', p.mrn],
      ['Age / Gender', `${ageFromDob(p.dateOfBirth)} y / ${p.gender}`],
    ]);
    doc.y = 104;
    const y2 = kv(doc, [
      ['Doctor', d.name],
      ['Speciality', d.specialization],
      ['Date', rx.prescribedAt.toLocaleString('en-GB')],
    ], 310, 240);
    doc.y = Math.max(y1, y2) + 6;
    const allergies = p.allergies.filter((a) => !a.removedAt);
    if (allergies.length) {
      doc.fontSize(9).fillColor('#b91c1c').font('Helvetica-Bold').text(`Allergies: ${allergies.map((a) => a.allergen).join(', ')}`, 48);
    }
    doc.fontSize(20).fillColor(BRAND).font('Helvetica-BoldOblique').text('Rx', 48, doc.y + 6);
    table(
      doc,
      [
        { label: '#', width: 22 },
        { label: 'Medicine', width: 140 },
        { label: 'Dose', width: 62 },
        { label: 'Frequency', width: 80 },
        { label: 'Route', width: 50 },
        { label: 'Days', width: 36, align: 'right' },
        { label: 'Qty', width: 36, align: 'right' },
        { label: 'Instructions', width: 73 },
      ],
      rx.items.map((i, n) => [String(n + 1), i.medicineName, i.dosage, i.frequency, i.route ?? 'Oral', String(i.durationDays), String(i.quantity), i.instructions ?? '']),
    );
    if (rx.notes) doc.fontSize(9).fillColor(INK).font('Helvetica').text(`Notes: ${rx.notes}`, 48);
    doc.moveDown(3);
    doc.fontSize(9).font('Helvetica-Bold').text(d.name, { align: 'right' });
    doc.font('Helvetica').fillColor(MUTED).text(`${d.qualification ?? ''} · PMDC ${d.licenseNumber}`, { align: 'right' });
    footer(doc, 'Electronically generated prescription. Valid with prescription number. Dispense only as prescribed.');
  });
}

async function assertClinicalAccessOrPharmacy(patientId: import('mongoose').Types.ObjectId) {
  const c = requireCtx();
  if (c.permissions.has('pharmacy.dispense') && !c.patientId) return;
  await assertClinicalAccess(patientId);
}

/** Verified lab report. `order` is already access-checked by the lab service. */
export async function labReportPdf(order: {
  _id: unknown;
  orderNo: string;
  patientId: import('mongoose').Types.ObjectId;
  doctorName?: string | null;
  priority?: string | null;
  createdAt?: Date;
  sample?: { type?: string | null; collectedAt?: Date | null; collectedByName?: string | null } | null;
  items: Array<{ testName: string; results: Array<{ parameter: string; value: string; unit?: string | null; refRange?: string | null; flag?: string | null }> }>;
  comments?: string | null;
  technicianName?: string | null;
  resultsEnteredAt?: Date | null;
  verifiedByName?: string | null;
  verifiedAt?: Date | null;
}) {
  const h = await loadHospital();
  const p = orNotFound(await Patient.findById(order.patientId).lean(), 'Patient');
  await recordAudit({ action: 'lab_report.generated', module: 'Laboratory', entity: 'LabOrder', entityId: String(order._id) });
  const FLAG_TEXT: Record<string, string> = { L: 'Low', H: 'High', LL: 'Critical low', HH: 'Critical high', A: 'Abnormal' };
  return render((doc) => {
    header(doc, h, 'Laboratory Report', order.orderNo);
    const y1 = kv(doc, [
      ['Patient', `${p.firstName} ${p.lastName}`],
      ['MRN', p.mrn],
      ['Age / Gender', `${ageFromDob(p.dateOfBirth)} y / ${p.gender}`],
      ['Referred by', order.doctorName],
    ]);
    doc.y = 104;
    const y2 = kv(doc, [
      ['Sample', order.sample?.type ?? '—'],
      ['Collected', order.sample?.collectedAt ? order.sample.collectedAt.toLocaleString('en-GB') : '—'],
      ['Reported', order.verifiedAt ? order.verifiedAt.toLocaleString('en-GB') : '—'],
      ['Priority', order.priority ?? 'Routine'],
    ], 310, 240);
    doc.y = Math.max(y1, y2) + 8;
    for (const item of order.items) {
      doc.x = 48;
      doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND).text(item.testName, 48, doc.y + 6);
      table(
        doc,
        [
          { label: 'Parameter', width: 170 },
          { label: 'Result', width: 90, align: 'right' },
          { label: 'Unit', width: 70 },
          { label: 'Reference range', width: 110 },
          { label: 'Flag', width: 59 },
        ],
        item.results.map((r) => [r.parameter, r.value, r.unit ?? '', r.refRange ?? '', r.flag && r.flag !== 'N' ? FLAG_TEXT[r.flag] ?? r.flag : '']),
      );
    }
    if (order.comments) doc.fontSize(9).font('Helvetica').fillColor(INK).text(`Comments: ${order.comments}`, 48);
    doc.moveDown(2);
    const y = doc.y;
    doc.fontSize(9).font('Helvetica').fillColor(MUTED).text('Performed by', 48, y).text('Verified by', 330, y);
    doc.fillColor(INK).font('Helvetica-Bold')
      .text(order.technicianName ?? '—', 48, y + 12)
      .text(order.verifiedByName ?? '—', 330, y + 12);
    doc.font('Helvetica').fillColor(MUTED)
      .text(order.resultsEnteredAt ? order.resultsEnteredAt.toLocaleString('en-GB') : '', 48, y + 24)
      .text(order.verifiedAt ? order.verifiedAt.toLocaleString('en-GB') : '', 330, y + 24);
    footer(doc, 'Results relate only to the sample received. Values flagged High/Low are outside the reference range. Interpret with clinical findings.');
  });
}

/** Discharge summary. `adm` comes from ipd.getAdmission (already access-checked). */
export async function dischargeSummaryPdf(adm: {
  admissionNo: string;
  patientId: import('mongoose').Types.ObjectId;
  attendingDoctorName?: string | null;
  admittedAt: Date;
  reason: string;
  provisionalDiagnosis?: string | null;
  stays: Array<{ wardName?: string | null; roomNo?: string | null; bedNo?: string | null; from: Date; to?: Date | null }>;
  discharge?: { at?: Date | null; type?: string | null; finalDiagnosis?: string | null; treatmentGiven?: string | null; conditionAtDischarge?: string | null; medications?: string | null; instructions?: string | null; followUpDate?: Date | null; byName?: string | null } | null;
  lengthOfStayDays: number;
}) {
  const h = await loadHospital();
  const p = orNotFound(await Patient.findById(adm.patientId).lean(), 'Patient');
  const d = adm.discharge ?? {};
  await recordAudit({ action: 'discharge_summary.printed', module: 'IPD', entity: 'Admission', entityId: adm.admissionNo });
  return render((doc) => {
    header(doc, h, 'Discharge Summary', adm.admissionNo);
    const y1 = kv(doc, [
      ['Patient', `${p.firstName} ${p.lastName}`],
      ['MRN', p.mrn],
      ['Age / Gender', `${ageFromDob(p.dateOfBirth)} y / ${p.gender}`],
      ['Consultant', adm.attendingDoctorName],
    ]);
    doc.y = 104;
    const y2 = kv(doc, [
      ['Admitted', adm.admittedAt.toLocaleString('en-GB')],
      ['Discharged', d.at ? d.at.toLocaleString('en-GB') : '—'],
      ['Length of stay', `${adm.lengthOfStayDays} day(s)`],
      ['Discharge type', d.type ?? '—'],
    ], 310, 240);
    doc.y = Math.max(y1, y2) + 10;
    const section = (title: string, body?: string | null) => {
      if (!body) return;
      doc.x = 48;
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(BRAND).text(title, 48, doc.y + 4);
      doc.fontSize(9.5).font('Helvetica').fillColor(INK).text(body, { width: doc.page.width - 96 });
      doc.moveDown(0.6);
    };
    section('Reason for admission', adm.reason);
    section('Provisional diagnosis', adm.provisionalDiagnosis);
    section('Final diagnosis', d.finalDiagnosis);
    section('Treatment given', d.treatmentGiven);
    section('Condition at discharge', d.conditionAtDischarge);
    section('Discharge medications', d.medications);
    section('Instructions', d.instructions);
    section('Follow-up', d.followUpDate ? d.followUpDate.toLocaleDateString('en-GB') : null);
    section('Bed history', adm.stays.map((s) => `${s.wardName} ${s.roomNo ?? ''}/${s.bedNo}: ${s.from.toLocaleDateString('en-GB')} – ${s.to ? s.to.toLocaleDateString('en-GB') : 'now'}`).join('\n'));
    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(INK).text(d.byName ?? adm.attendingDoctorName ?? '', { align: 'right' });
    doc.font('Helvetica').fillColor(MUTED).text('Discharging physician', { align: 'right' });
    const allergies = p.allergies.filter((a) => !a.removedAt);
    footer(doc, `Allergies: ${allergies.length ? allergies.map((a) => a.allergen).join(', ') : 'none known'}. In an emergency, return to the hospital emergency department.`);
  });
}

interface PayLine { name: string; amount: number }

/** Employee payslip. Data comes from payroll.payslipData (already access-checked). */
export async function payslipPdf(d: {
  payslip: { payslipNo: string; period: string; issuedAt: Date };
  item: {
    employeeNo?: string | null; employeeName?: string | null; designation?: string | null; departmentName?: string | null; bankName?: string | null; bankAccount?: string | null;
    basic?: number | null; allowances: PayLine[]; deductions: PayLine[]; overtimeHours?: number | null; overtimePay?: number | null; bonus?: number | null; otherDeduction?: number | null;
    unpaidLeaveDeduction?: number | null; absenceDeduction?: number | null; tax?: number | null; gross?: number | null; totalDeductions?: number | null; net?: number | null;
    workingDays?: number | null; presentDays?: number | null; absentDays?: number | null; unpaidLeaveDays?: number | null; paidLeaveDays?: number | null;
  };
}) {
  const h = await loadHospital();
  const it = d.item;
  const [y, m] = d.payslip.period.split('-').map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return render((doc) => {
    header(doc, h, `Payslip — ${monthName}`, d.payslip.payslipNo);
    const y1 = kv(doc, [['Employee', it.employeeName], ['Employee no.', it.employeeNo], ['Designation', it.designation], ['Department', it.departmentName]]);
    doc.y = 104;
    const y2 = kv(doc, [['Working days', String(it.workingDays ?? '—')], ['Present / absent', `${it.presentDays ?? 0} / ${it.absentDays ?? 0}`], ['Paid / unpaid leave', `${it.paidLeaveDays ?? 0} / ${it.unpaidLeaveDays ?? 0}`], ['Bank', [it.bankName, it.bankAccount].filter(Boolean).join(' · ') || '—']], 310, 240);
    doc.y = Math.max(y1, y2) + 10;
    const earnings: Array<[string, number]> = [['Basic salary', it.basic ?? 0], ...it.allowances.map((a) => [a.name, a.amount] as [string, number])];
    if (it.overtimePay) earnings.push([`Overtime (${it.overtimeHours} h)`, it.overtimePay]);
    if (it.bonus) earnings.push(['Bonus', it.bonus]);
    const deductions: Array<[string, number]> = [...it.deductions.map((x) => [x.name, x.amount] as [string, number])];
    if (it.unpaidLeaveDeduction) deductions.push(['Unpaid leave', it.unpaidLeaveDeduction]);
    if (it.absenceDeduction) deductions.push(['Absence', it.absenceDeduction]);
    if (it.otherDeduction) deductions.push(['Other deduction', it.otherDeduction]);
    if (it.tax) deductions.push(['Income tax', it.tax]);
    const rows = Math.max(earnings.length, deductions.length);
    table(
      doc,
      [
        { label: 'Earnings', width: 160 },
        { label: 'Amount', width: 90, align: 'right' },
        { label: 'Deductions', width: 160 },
        { label: 'Amount', width: 89, align: 'right' },
      ],
      Array.from({ length: rows }, (_, i) => [earnings[i]?.[0] ?? '', earnings[i] ? money(earnings[i][1], h.currency) : '', deductions[i]?.[0] ?? '', deductions[i] ? money(deductions[i][1], h.currency) : '']),
    );
    table(
      doc,
      [
        { label: 'Gross earnings', width: 160 },
        { label: money(it.gross ?? 0, h.currency), width: 90, align: 'right' },
        { label: 'Total deductions', width: 160 },
        { label: money(it.totalDeductions ?? 0, h.currency), width: 89, align: 'right' },
      ],
      [],
    );
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(BRAND).text(`Net pay: ${money(it.net ?? 0, h.currency)}`, 48, doc.y, { align: 'right', width: doc.page.width - 96 });
    footer(doc, `Issued ${d.payslip.issuedAt.toLocaleDateString('en-GB')}. This is a computer-generated payslip and does not require a signature.`);
  });
}

/** Offer letter on hospital letterhead. */
export async function offerLetterPdf(o: {
  offerNo: string; candidateName?: string | null; designation: string; departmentId?: unknown; employmentType?: string | null;
  basicSalary: number; allowances: Array<{ name?: string | null; amount?: number | null }>; joiningDate: Date; expiresOn: Date; terms?: string | null; status: string; approvedByName?: string | null;
}) {
  const h = await loadHospital();
  const dept = (o.departmentId as { name?: string } | undefined)?.name ?? '';
  const total = o.basicSalary + o.allowances.reduce((s, a) => s + (a.amount ?? 0), 0);
  return render((doc) => {
    header(doc, h, o.status === 'Draft' || o.status === 'PendingApproval' ? 'Offer Letter (DRAFT)' : 'Offer of Employment', o.offerNo);
    doc.fontSize(10).font('Helvetica').fillColor(INK);
    doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
    doc.moveDown();
    doc.text(`Dear ${o.candidateName},`);
    doc.moveDown(0.6);
    doc.text(`We are pleased to offer you the position of ${o.designation}${dept ? ` in the ${dept} department` : ''} at ${h.name}, on a ${(o.employmentType ?? 'FullTime').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()} basis, starting on ${o.joiningDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`, { width: doc.page.width - 96, lineGap: 2 });
    doc.moveDown(0.6);
    doc.text('Your monthly remuneration will be:');
    table(
      doc,
      [
        { label: 'Component', width: 300 },
        { label: 'Monthly amount', width: 199, align: 'right' },
      ],
      [['Basic salary', money(o.basicSalary, h.currency)], ...o.allowances.map((a) => [a.name ?? '', money(a.amount ?? 0, h.currency)]), ['Total monthly salary', money(total, h.currency)]],
    );
    if (o.terms) {
      doc.fontSize(10).font('Helvetica-Bold').text('Terms', 48);
      doc.font('Helvetica').text(o.terms, { width: doc.page.width - 96, lineGap: 2 });
      doc.moveDown(0.6);
    }
    doc.font('Helvetica').text(`This offer is valid until ${o.expiresOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. It is subject to verification of your documents and a satisfactory medical assessment. Please confirm your acceptance by signing below.`, 48, doc.y, { width: doc.page.width - 96, lineGap: 2 });
    doc.moveDown(3);
    const y = doc.y;
    doc.font('Helvetica-Bold').text(o.approvedByName ?? 'Human Resources', 48, y).text(o.candidateName ?? '', 330, y);
    doc.font('Helvetica').fillColor(MUTED).text(`For ${h.name}`, 48, y + 14).text('Accepted by candidate (signature & date)', 330, y + 14);
    footer(doc, `${h.name} · ${[h.address, h.city].filter(Boolean).join(', ')}`);
  });
}

export async function invoicePdf(id: string) {
  const h = await loadHospital();
  const inv = orNotFound(await Invoice.findById(id).lean(), 'Invoice');
  const c = requireCtx();
  if (c.patientId && !c.patientId.equals(inv.patientId)) throw new ForbiddenError();
  await recordAudit({ action: 'invoice.printed', module: 'Billing', entity: 'Invoice', entityId: inv._id });
  return render((doc) => {
    header(doc, h, inv.status === 'Draft' ? 'Draft Invoice' : 'Invoice', inv.invoiceNo);
    const y1 = kv(doc, [
      ['Patient', inv.patientName],
      ['MRN', inv.mrn],
      ['Department', inv.source],
    ]);
    doc.y = 104;
    const y2 = kv(doc, [
      ['Issued', inv.issuedAt ? inv.issuedAt.toLocaleDateString('en-GB') : '—'],
      ['Status', inv.status],
    ], 310, 240);
    doc.y = Math.max(y1, y2) + 6;
    table(
      doc,
      [
        { label: 'Description', width: 200 },
        { label: 'Qty', width: 40, align: 'right' },
        { label: 'Unit price', width: 75, align: 'right' },
        { label: 'Discount', width: 60, align: 'right' },
        { label: 'Tax', width: 50, align: 'right' },
        { label: 'Total', width: 74, align: 'right' },
      ],
      inv.items.map((i) => [i.description, String(i.quantity), i.unitPrice.toFixed(2), (i.discount ?? 0).toFixed(2), (i.tax ?? 0).toFixed(2), i.total.toFixed(2)]),
    );
    const right = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.fontSize(9.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? INK : MUTED).text(label, 330, y, { width: 100, align: 'right' });
      doc.fillColor(INK).text(value, 430, y, { width: 117, align: 'right' });
      doc.y = y + 15;
    };
    right('Subtotal', money(inv.subtotal, h.currency));
    right('Discount', `- ${money(inv.discountTotal, h.currency)}`);
    right('Tax', money(inv.taxTotal, h.currency));
    right('Total', money(inv.total, h.currency), true);
    right('Paid', money(inv.paid - inv.refunded, h.currency));
    right('Balance due', money(inv.balance, h.currency), true);
    footer(doc, 'Thank you. Please quote the invoice number with any payment.');
  });
}

export async function receiptPdf(paymentId: string) {
  const h = await loadHospital();
  const pay = orNotFound(await Payment.findById(paymentId).lean(), 'Payment');
  const c = requireCtx();
  if (c.patientId && !c.patientId.equals(pay.patientId)) throw new ForbiddenError();
  const inv = orNotFound(await Invoice.findById(pay.invoiceId).lean(), 'Invoice');
  await recordAudit({ action: 'receipt.printed', module: 'Billing', entity: 'Payment', entityId: pay._id });
  return render((doc) => {
    header(doc, h, 'Payment Receipt', pay.receiptNo);
    kv(doc, [
      ['Received from', inv.patientName],
      ['MRN', inv.mrn],
      ['Invoice', inv.invoiceNo],
      ['Amount', money(pay.amount, h.currency)],
      ['Method', pay.method + (pay.reference ? ` (ref ${pay.reference})` : '')],
      ['Date', pay.receivedAt.toLocaleString('en-GB')],
      ['Received by', pay.receivedByName ?? ''],
      ['Invoice balance', money(inv.balance, h.currency)],
    ], 48, 420);
    footer(doc, 'This is a computer-generated receipt.');
  });
}
