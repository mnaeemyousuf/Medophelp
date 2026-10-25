import { REPORTS, adherencePercent, round2, type ReportColumn, type ReportQuery, type ReportResult } from '@hms/shared';
import { can, requireCtx } from '../../core/context';
import { ForbiddenError, NotFoundError } from '../../core/errors';
import { recordAudit } from '../../core/audit/audit';
import { dateOnly, oid, todayString } from '../../core/http';
import { Department } from '../organization/organization.models';
import { Doctor } from '../staff/staff.models';
import { Patient } from '../patients/patient.models';
import { Appointment, Visit } from '../appointments/appointment.models';
import { Admission } from '../ipd/ipd.models';
import { LabOrder } from '../laboratory/lab.models';
import { EmergencyCase } from '../emergency/emergency.models';
import { Invoice } from '../billing/billing.models';
import { InsuranceClaim } from '../insurance/insurance.models';
import { Batch, Item } from '../inventory/inventory.models';
import { GoodsReceipt, PurchaseOrder } from '../purchasing/purchasing.models';
import { Attendance, LeaveRequest } from '../hr/hr.models';
import { PayrollItem, PayrollRun } from '../payroll/payroll.models';
import { adherenceReport } from '../medication/medication.service';

const DAY = 86_400_000;
type Row = Record<string, string | number | null>;

interface Ctx {
  from: Date; // inclusive, local midnight
  to: Date; // exclusive
  fromStr: string;
  toStr: string;
  departmentId?: string;
  doctorId?: string;
  explicitRange: boolean;
}

function resolve(q: ReportQuery): Ctx {
  const today = todayString();
  const fromStr = q.from ?? `${today.slice(0, 7)}-01`;
  const toStr = q.to ?? today;
  return { from: dateOnly(fromStr), to: new Date(dateOnly(toStr).getTime() + DAY), fromStr, toStr, departmentId: q.departmentId, doctorId: q.doctorId, explicitRange: !!(q.from || q.to) };
}

const deptMatch = (c: Ctx, field = 'departmentId') => (c.departmentId ? { [field]: oid(c.departmentId) } : {});
const doctorMatch = (c: Ctx, field = 'doctorId') => (c.doctorId ? { [field]: oid(c.doctorId) } : {});
/** Restricts doctor-linked records to doctors of the selected department. */
async function deptDoctors(c: Ctx, field = 'doctorId') {
  return c.departmentId ? { [field]: { $in: await Doctor.distinct('_id', { departmentId: oid(c.departmentId) }) } } : {};
}
const sum = (rows: Row[], k: string) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
const pct = (a: number, b: number) => (b ? round2((a / b) * 100) : null);
// Calendar days use the same convention as dateOnly() and the dashboards.
const dayKey = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field } });
function daysOf(c: Ctx) {
  const out: string[] = [];
  for (let t = Date.parse(`${c.fromStr}T00:00:00Z`); t <= Date.parse(`${c.toStr}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

type Builder = (c: Ctx) => Promise<{ columns: ReportColumn[]; rows: Row[]; totals?: Row; chart?: ReportResult['chart'] }>;

const builders: Record<string, Builder> = {
  async 'patient-inflow'(c) {
    const [reg, visits] = await Promise.all([
      Patient.aggregate([{ $match: { createdAt: { $gte: c.from, $lt: c.to } } }, { $group: { _id: dayKey('$createdAt'), n: { $sum: 1 } } }]),
      Visit.aggregate([{ $match: { startedAt: { $gte: c.from, $lt: c.to }, ...deptMatch(c) } }, { $group: { _id: { d: dayKey('$startedAt'), t: '$type' }, n: { $sum: 1 } } }]),
    ]);
    const v = (d: string, t: string) => visits.find((x) => x._id.d === d && x._id.t === t)?.n ?? 0;
    const rows = daysOf(c).map((date) => {
      const opd = v(date, 'OPD');
      const ipd = v(date, 'IPD');
      const er = v(date, 'Emergency');
      return { date, registrations: reg.find((r) => r._id === date)?.n ?? 0, opd, ipd, emergency: er, total: opd + ipd + er };
    });
    return {
      columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'registrations', label: 'New registrations', type: 'number' }, { key: 'opd', label: 'OPD visits', type: 'number' }, { key: 'ipd', label: 'IPD visits', type: 'number' }, { key: 'emergency', label: 'Emergency visits', type: 'number' }, { key: 'total', label: 'Total visits', type: 'number' }],
      rows,
      totals: { date: 'Total', registrations: sum(rows, 'registrations'), opd: sum(rows, 'opd'), ipd: sum(rows, 'ipd'), emergency: sum(rows, 'emergency'), total: sum(rows, 'total') },
      chart: { type: 'line', x: 'date', series: ['registrations', 'opd', 'ipd', 'emergency'] },
    };
  },

  async demographics(c) {
    const ids = await Visit.distinct('patientId', { startedAt: { $gte: c.from, $lt: c.to }, ...deptMatch(c) });
    const patients = await Patient.find({ _id: { $in: ids } }).select('dateOfBirth gender city').lean();
    const bands = ['0–4', '5–14', '15–24', '25–44', '45–64', '65+'];
    const band = (dob: Date) => {
      const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * DAY));
      return age < 5 ? bands[0] : age < 15 ? bands[1] : age < 25 ? bands[2] : age < 45 ? bands[3] : age < 65 ? bands[4] : bands[5];
    };
    const rows: Row[] = bands.map((b) => {
      const inBand = patients.filter((p) => band(p.dateOfBirth) === b);
      const g = (x: string) => inBand.filter((p) => p.gender === x).length;
      return { band: b, male: g('Male'), female: g('Female'), other: g('Other'), total: inBand.length, share: pct(inBand.length, patients.length) };
    });
    return {
      columns: [{ key: 'band', label: 'Age band' }, { key: 'male', label: 'Male', type: 'number' }, { key: 'female', label: 'Female', type: 'number' }, { key: 'other', label: 'Other', type: 'number' }, { key: 'total', label: 'Patients', type: 'number' }, { key: 'share', label: 'Share', type: 'percent' }],
      rows,
      totals: { band: 'All patients seen', male: sum(rows, 'male'), female: sum(rows, 'female'), other: sum(rows, 'other'), total: patients.length, share: patients.length ? 100 : null },
      chart: { type: 'bar', x: 'band', series: ['male', 'female'] },
    };
  },

  async 'opd-ipd'(c) {
    const [visits, admitted, discharged, depts] = await Promise.all([
      Visit.aggregate([{ $match: { startedAt: { $gte: c.from, $lt: c.to }, ...deptMatch(c) } }, { $group: { _id: { d: '$departmentId', t: '$type' }, n: { $sum: 1 } } }]),
      Admission.aggregate([{ $match: { admittedAt: { $gte: c.from, $lt: c.to }, ...deptMatch(c) } }, { $group: { _id: '$departmentId', n: { $sum: 1 } } }]),
      Admission.aggregate([{ $match: { 'discharge.at': { $gte: c.from, $lt: c.to }, ...deptMatch(c) } }, { $group: { _id: '$departmentId', n: { $sum: 1 }, los: { $avg: { $divide: [{ $subtract: ['$discharge.at', '$admittedAt'] }, DAY] } } } }]),
      Department.find(c.departmentId ? { _id: oid(c.departmentId) } : {}).select('name').sort({ name: 1 }).lean(),
    ]);
    const rows = depts
      .map((d) => {
        const v = (t: string) => visits.find((x) => x._id.d?.equals(d._id) && x._id.t === t)?.n ?? 0;
        const dis = discharged.find((x) => x._id?.equals(d._id));
        return { department: d.name, opd: v('OPD'), emergency: v('Emergency'), admissions: admitted.find((x) => x._id?.equals(d._id))?.n ?? 0, discharges: dis?.n ?? 0, avgLos: dis ? round2(dis.los) : null };
      })
      .filter((r) => r.opd + r.emergency + r.admissions + r.discharges > 0);
    return {
      columns: [{ key: 'department', label: 'Department' }, { key: 'opd', label: 'OPD visits', type: 'number' }, { key: 'emergency', label: 'Emergency visits', type: 'number' }, { key: 'admissions', label: 'Admissions', type: 'number' }, { key: 'discharges', label: 'Discharges', type: 'number' }, { key: 'avgLos', label: 'Avg stay (days)', type: 'number' }],
      rows,
      totals: { department: 'Total', opd: sum(rows, 'opd'), emergency: sum(rows, 'emergency'), admissions: sum(rows, 'admissions'), discharges: sum(rows, 'discharges'), avgLos: null },
      chart: { type: 'bar', x: 'department', series: ['opd', 'admissions'] },
    };
  },

  async 'doctor-appointments'(c) {
    const agg = await Appointment.aggregate([
      { $match: { date: { $gte: c.from, $lt: c.to }, ...deptMatch(c), ...doctorMatch(c) } },
      {
        $group: {
          _id: '$doctorId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
          noShow: { $sum: { $cond: [{ $eq: ['$status', 'NoShow'] }, 1, 0] } },
          patients: { $addToSet: '$patientId' },
        },
      },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } },
      { $project: { doctor: { $ifNull: [{ $first: '$d.name' }, 'Unknown'] }, specialization: { $first: '$d.specialization' }, total: 1, completed: 1, cancelled: 1, noShow: 1, patients: { $size: '$patients' } } },
      { $sort: { total: -1 } },
    ]);
    const rows = agg.map((r) => ({ doctor: r.doctor, specialization: r.specialization ?? '', patients: r.patients, total: r.total, completed: r.completed, cancelled: r.cancelled, noShow: r.noShow, completionRate: pct(r.completed, r.total), noShowRate: pct(r.noShow, r.total) }));
    return {
      columns: [{ key: 'doctor', label: 'Doctor' }, { key: 'specialization', label: 'Specialization' }, { key: 'patients', label: 'Patients', type: 'number' }, { key: 'total', label: 'Booked', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' }, { key: 'cancelled', label: 'Cancelled', type: 'number' }, { key: 'noShow', label: 'No-show', type: 'number' }, { key: 'completionRate', label: 'Completion', type: 'percent' }, { key: 'noShowRate', label: 'No-show rate', type: 'percent' }],
      rows,
      totals: { doctor: 'Total', specialization: '', patients: sum(rows, 'patients'), total: sum(rows, 'total'), completed: sum(rows, 'completed'), cancelled: sum(rows, 'cancelled'), noShow: sum(rows, 'noShow'), completionRate: pct(sum(rows, 'completed'), sum(rows, 'total')), noShowRate: pct(sum(rows, 'noShow'), sum(rows, 'total')) },
      chart: { type: 'bar', x: 'doctor', series: ['total', 'completed'] },
    };
  },

  async 'lab-tat'(c) {
    const orders = await LabOrder.find({ verifiedAt: { $gte: c.from, $lt: c.to }, status: { $ne: 'Cancelled' }, ...(await deptDoctors(c)) }).select('items.testName createdAt verifiedAt priority').lean();
    const byTest = new Map<string, number[]>();
    for (const o of orders) {
      const created = (o as unknown as { createdAt: Date }).createdAt;
      const h = (o.verifiedAt!.getTime() - created.getTime()) / 3_600_000;
      for (const i of o.items) byTest.set(i.testName, [...(byTest.get(i.testName) ?? []), h]);
    }
    const rows = [...byTest.entries()]
      .map(([test, hs]) => {
        const s = [...hs].sort((a, b) => a - b);
        return { test, count: hs.length, avgHours: round2(hs.reduce((a, b) => a + b, 0) / hs.length), medianHours: round2(s[Math.floor((s.length - 1) / 2)]), p90Hours: round2(s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)]), maxHours: round2(s[s.length - 1]) };
      })
      .sort((a, b) => b.count - a.count);
    return {
      columns: [{ key: 'test', label: 'Test' }, { key: 'count', label: 'Verified', type: 'number' }, { key: 'avgHours', label: 'Average (h)', type: 'number' }, { key: 'medianHours', label: 'Median (h)', type: 'number' }, { key: 'p90Hours', label: '90th pct (h)', type: 'number' }, { key: 'maxHours', label: 'Longest (h)', type: 'number' }],
      rows,
      totals: { test: 'All tests', count: sum(rows, 'count'), avgHours: rows.length ? round2(rows.reduce((s, r) => s + r.avgHours * r.count, 0) / sum(rows, 'count')) : null, medianHours: null, p90Hours: null, maxHours: rows.length ? Math.max(...rows.map((r) => r.maxHours)) : null },
      chart: { type: 'bar', x: 'test', series: ['avgHours', 'p90Hours'] },
    };
  },

  async 'er-response'(c) {
    const cases = await EmergencyCase.find({ arrivalAt: { $gte: c.from, $lt: c.to } }).select('arrivalAt triageLevel triage.at treatmentStartedAt disposition.type').lean();
    const levels = ['Critical', 'Urgent', 'SemiUrgent', 'NonUrgent', 'Untriaged'];
    const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const rows = levels
      .map((level) => {
        const cs = cases.filter((x) => (x.triageLevel ?? 'Untriaged') === level);
        const toTriage = cs.filter((x) => x.triage?.length).map((x) => (x.triage[0].at!.getTime() - x.arrivalAt.getTime()) / 60_000);
        const toDoctor = cs.filter((x) => x.treatmentStartedAt).map((x) => (x.treatmentStartedAt!.getTime() - x.arrivalAt.getTime()) / 60_000);
        const disp = (t: string) => cs.filter((x) => x.disposition?.type === t).length;
        return { level: level === 'SemiUrgent' ? 'Semi-urgent' : level === 'NonUrgent' ? 'Non-urgent' : level, cases: cs.length, doorToTriage: avg(toTriage), doorToDoctor: avg(toDoctor), admitted: disp('Admitted'), discharged: disp('Discharged'), referred: disp('Referred'), other: cs.length - disp('Admitted') - disp('Discharged') - disp('Referred') };
      })
      .filter((r) => r.cases > 0);
    return {
      columns: [{ key: 'level', label: 'Triage level' }, { key: 'cases', label: 'Cases', type: 'number' }, { key: 'doorToTriage', label: 'Door→triage (min)', type: 'number' }, { key: 'doorToDoctor', label: 'Door→doctor (min)', type: 'number' }, { key: 'admitted', label: 'Admitted', type: 'number' }, { key: 'discharged', label: 'Discharged', type: 'number' }, { key: 'referred', label: 'Referred', type: 'number' }, { key: 'other', label: 'Open / other', type: 'number' }],
      rows,
      totals: { level: 'All', cases: sum(rows, 'cases'), doorToTriage: null, doorToDoctor: null, admitted: sum(rows, 'admitted'), discharged: sum(rows, 'discharged'), referred: sum(rows, 'referred'), other: sum(rows, 'other') },
      chart: { type: 'bar', x: 'level', series: ['doorToTriage', 'doorToDoctor'] },
    };
  },

  async 'medication-adherence'(c) {
    const rows = (await adherenceReport({ from: c.from, to: c.to, doctorId: c.doctorId, departmentDoctorIds: c.departmentId ? await Doctor.distinct('_id', { departmentId: oid(c.departmentId) }) : undefined })) as Row[];
    const totals = { taken: sum(rows, 'taken'), missed: sum(rows, 'missed'), skipped: sum(rows, 'skipped') };
    return {
      columns: [{ key: 'mrn', label: 'MRN' }, { key: 'patient', label: 'Patient' }, { key: 'medicine', label: 'Medicine' }, { key: 'prescriptionNo', label: 'Prescription' }, { key: 'doctor', label: 'Prescriber' }, { key: 'taken', label: 'Taken', type: 'number' }, { key: 'missed', label: 'Missed', type: 'number' }, { key: 'skipped', label: 'Skipped', type: 'number' }, { key: 'adherence', label: 'Adherence', type: 'percent' }],
      rows,
      totals: { mrn: 'Total', patient: '', medicine: '', prescriptionNo: '', doctor: '', ...totals, adherence: adherencePercent(totals) },
    };
  },

  async 'revenue-department'(c) {
    const agg = await Invoice.aggregate([
      { $match: { issuedAt: { $gte: c.from, $lt: c.to }, status: { $nin: ['Draft', 'Cancelled'] }, ...deptMatch(c) } },
      { $lookup: { from: 'departments', localField: 'departmentId', foreignField: '_id', as: 'd' } },
      { $group: { _id: { $ifNull: [{ $first: '$d.name' }, { $concat: ['$source', ' (no department)'] }] }, invoices: { $sum: 1 }, billed: { $sum: '$total' }, discounts: { $sum: '$discountTotal' }, collected: { $sum: '$paid' }, refunded: { $sum: '$refunded' }, outstanding: { $sum: '$balance' } } },
      { $sort: { billed: -1 } },
    ]);
    const rows = agg.map((r) => ({ department: r._id, invoices: r.invoices, billed: round2(r.billed), discounts: round2(r.discounts), collected: round2(r.collected - r.refunded), outstanding: round2(r.outstanding), collectionRate: pct(r.collected - r.refunded, r.billed) }));
    return {
      columns: [{ key: 'department', label: 'Department' }, { key: 'invoices', label: 'Invoices', type: 'number' }, { key: 'billed', label: 'Billed', type: 'money' }, { key: 'discounts', label: 'Discounts', type: 'money' }, { key: 'collected', label: 'Collected (net)', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'collectionRate', label: 'Collected %', type: 'percent' }],
      rows,
      totals: { department: 'Total', invoices: sum(rows, 'invoices'), billed: sum(rows, 'billed'), discounts: sum(rows, 'discounts'), collected: sum(rows, 'collected'), outstanding: sum(rows, 'outstanding'), collectionRate: pct(sum(rows, 'collected'), sum(rows, 'billed')) },
      chart: { type: 'bar', x: 'department', series: ['billed', 'collected'] },
    };
  },

  async 'revenue-doctor'(c) {
    const agg = await Invoice.aggregate([
      { $match: { issuedAt: { $gte: c.from, $lt: c.to }, status: { $nin: ['Draft', 'Cancelled'] }, visitId: { $ne: null }, ...deptMatch(c) } },
      { $lookup: { from: 'visits', localField: 'visitId', foreignField: '_id', as: 'v' } },
      { $set: { doctorId: { $first: '$v.doctorId' } } },
      { $match: { doctorId: { $ne: null }, ...doctorMatch(c) } },
      { $group: { _id: '$doctorId', patients: { $addToSet: '$patientId' }, invoices: { $sum: 1 }, consultation: { $sum: { $cond: [{ $eq: ['$source', 'OPD'] }, '$total', 0] } }, billed: { $sum: '$total' }, collected: { $sum: { $subtract: ['$paid', '$refunded'] } } } },
      { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } },
      { $project: { doctor: { $ifNull: [{ $first: '$d.name' }, 'Unknown'] }, patients: { $size: '$patients' }, invoices: 1, consultation: 1, billed: 1, collected: 1 } },
      { $sort: { billed: -1 } },
    ]);
    const rows = agg.map((r) => ({ doctor: r.doctor, patients: r.patients, invoices: r.invoices, consultation: round2(r.consultation), billed: round2(r.billed), collected: round2(r.collected) }));
    return {
      columns: [{ key: 'doctor', label: 'Doctor' }, { key: 'patients', label: 'Patients', type: 'number' }, { key: 'invoices', label: 'Invoices', type: 'number' }, { key: 'consultation', label: 'OPD consultation', type: 'money' }, { key: 'billed', label: 'All billed (visits)', type: 'money' }, { key: 'collected', label: 'Collected', type: 'money' }],
      rows,
      totals: { doctor: 'Total', patients: sum(rows, 'patients'), invoices: sum(rows, 'invoices'), consultation: sum(rows, 'consultation'), billed: sum(rows, 'billed'), collected: sum(rows, 'collected') },
      chart: { type: 'bar', x: 'doctor', series: ['billed', 'collected'] },
    };
  },

  async outstanding(c) {
    const invoices = await Invoice.find({ status: { $in: ['Issued', 'PartiallyPaid'] }, balance: { $gt: 0 }, issuedAt: { $gte: c.from, $lt: c.to }, ...deptMatch(c) }).select('invoiceNo patientName mrn source issuedAt total paid balance').sort({ issuedAt: 1 }).lean();
    const now = Date.now();
    const rows = invoices.map((i) => {
      const age = Math.floor((now - (i.issuedAt?.getTime() ?? now)) / DAY);
      return { invoiceNo: i.invoiceNo, patient: i.patientName, mrn: i.mrn, source: i.source, issued: i.issuedAt?.toISOString().slice(0, 10) ?? null, total: i.total, paid: i.paid, balance: i.balance, ageDays: age, bucket: age <= 30 ? '0–30' : age <= 60 ? '31–60' : age <= 90 ? '61–90' : '90+' };
    });
    return {
      columns: [{ key: 'invoiceNo', label: 'Invoice' }, { key: 'patient', label: 'Patient' }, { key: 'mrn', label: 'MRN' }, { key: 'source', label: 'Source' }, { key: 'issued', label: 'Issued', type: 'date' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }, { key: 'ageDays', label: 'Age (days)', type: 'number' }, { key: 'bucket', label: 'Ageing' }],
      rows,
      totals: { invoiceNo: `${rows.length} invoices`, patient: '', mrn: '', source: '', issued: null, total: sum(rows, 'total'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance'), ageDays: null, bucket: '' },
    };
  },

  async 'insurance-claims'(c) {
    const agg = await InsuranceClaim.aggregate([
      { $match: { createdAt: { $gte: c.from, $lt: c.to } } },
      ...(c.departmentId ? [{ $lookup: { from: 'invoices', localField: 'invoiceId', foreignField: '_id', as: 'inv' } }, { $match: { 'inv.departmentId': oid(c.departmentId) } }] : []),
      { $group: { _id: { p: '$provider', s: '$status' }, claims: { $sum: 1 }, claimed: { $sum: '$claimAmount' }, approved: { $sum: '$approvedAmount' }, paid: { $sum: '$paidAmount' } } },
      { $sort: { '_id.p': 1, '_id.s': 1 } },
    ]);
    const rows = agg.map((r) => ({ provider: r._id.p, status: r._id.s, claims: r.claims, claimed: round2(r.claimed), approved: round2(r.approved), paid: round2(r.paid) }));
    return {
      columns: [{ key: 'provider', label: 'Insurer' }, { key: 'status', label: 'Status' }, { key: 'claims', label: 'Claims', type: 'number' }, { key: 'claimed', label: 'Claimed', type: 'money' }, { key: 'approved', label: 'Approved', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }],
      rows,
      totals: { provider: 'Total', status: '', claims: sum(rows, 'claims'), claimed: sum(rows, 'claimed'), approved: sum(rows, 'approved'), paid: sum(rows, 'paid') },
    };
  },

  async 'pharmacy-stock'() {
    const items = await Item.find({ category: 'Medicine', isActive: true }).select('sku name genericName strength unit currentStock reorderLevel purchasePrice sellingPrice').sort({ name: 1 }).lean();
    const rows = items.map((i) => ({ sku: i.sku, name: `${i.name}${i.strength ? ` ${i.strength}` : ''}`, generic: i.genericName ?? '', stock: i.currentStock, unit: i.unit, reorderLevel: i.reorderLevel, costValue: round2(i.currentStock * i.purchasePrice), retailValue: round2(i.currentStock * i.sellingPrice), status: i.currentStock === 0 ? 'Out of stock' : i.currentStock <= i.reorderLevel ? 'Reorder' : 'OK' }));
    return {
      columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Medicine' }, { key: 'generic', label: 'Generic' }, { key: 'stock', label: 'On hand', type: 'number' }, { key: 'unit', label: 'Unit' }, { key: 'reorderLevel', label: 'Reorder at', type: 'number' }, { key: 'costValue', label: 'Cost value', type: 'money' }, { key: 'retailValue', label: 'Retail value', type: 'money' }, { key: 'status', label: 'Status' }],
      rows,
      totals: { sku: `${rows.length} items`, name: `${rows.filter((r) => r.status !== 'OK').length} need reorder`, generic: '', stock: null, unit: '', reorderLevel: null, costValue: sum(rows, 'costValue'), retailValue: sum(rows, 'retailValue'), status: '' },
    };
  },

  async 'medicine-expiry'(c) {
    const now = Date.now();
    // Default window: everything expired or expiring within 90 days; an explicit date range narrows to expiries in that range.
    // Already-expired stock is always listed (it must be written off).
    const window = c.explicitRange ? { $or: [{ expiryDate: { $lte: new Date(now) } }, { expiryDate: { $gte: c.from, $lt: c.to } }] } : { expiryDate: { $lte: new Date(now + 90 * DAY) } };
    const batches = await Batch.find({ quantity: { $gt: 0 }, ...window }).populate('itemId', 'name sku category').sort({ expiryDate: 1 }).lean();
    const rows = batches.map((b) => {
      const item = b.itemId as unknown as { name: string; sku: string };
      const days = Math.ceil((b.expiryDate.getTime() - now) / DAY);
      return { item: item?.name ?? '', sku: item?.sku ?? '', batchNo: b.batchNo, location: b.location, expiry: b.expiryDate.toISOString().slice(0, 10), daysLeft: days, quantity: b.quantity, value: round2(b.quantity * (b.unitCost ?? 0)), status: days <= 0 ? 'Expired' : days <= 30 ? '≤ 30 days' : '≤ 90 days' };
    });
    return {
      columns: [{ key: 'item', label: 'Item' }, { key: 'sku', label: 'SKU' }, { key: 'batchNo', label: 'Batch' }, { key: 'location', label: 'Location' }, { key: 'expiry', label: 'Expiry', type: 'date' }, { key: 'daysLeft', label: 'Days left', type: 'number' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'value', label: 'Cost value', type: 'money' }, { key: 'status', label: 'Status' }],
      rows,
      totals: { item: `${rows.length} batches`, sku: '', batchNo: '', location: '', expiry: null, daysLeft: null, quantity: sum(rows, 'quantity'), value: sum(rows, 'value'), status: `${rows.filter((r) => r.status === 'Expired').length} expired` },
    };
  },

  async purchases(c) {
    const [pos, grns] = await Promise.all([
      PurchaseOrder.aggregate([{ $match: { createdAt: { $gte: c.from, $lt: c.to }, status: { $nin: ['Draft', 'Cancelled'] } } }, { $group: { _id: '$supplierName', orders: { $sum: 1 }, ordered: { $sum: '$total' }, open: { $sum: { $cond: [{ $in: ['$status', ['Approved', 'Ordered', 'PartiallyReceived']] }, 1, 0] } } } }]),
      GoodsReceipt.aggregate([{ $match: { receivedAt: { $gte: c.from, $lt: c.to } } }, { $unwind: '$lines' }, { $lookup: { from: 'suppliers', localField: 'supplierId', foreignField: '_id', as: 's' } }, { $group: { _id: { $first: '$s.name' }, receipts: { $addToSet: '$_id' }, received: { $sum: { $multiply: ['$lines.quantity', '$lines.unitCost'] } } } }]),
    ]);
    const names = [...new Set([...pos.map((p) => p._id), ...grns.map((g) => g._id)].filter(Boolean))].sort();
    const rows = names.map((n) => {
      const p = pos.find((x) => x._id === n);
      const g = grns.find((x) => x._id === n);
      return { supplier: n, orders: p?.orders ?? 0, ordered: round2(p?.ordered ?? 0), openOrders: p?.open ?? 0, receipts: g?.receipts.length ?? 0, received: round2(g?.received ?? 0) };
    });
    return {
      columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'orders', label: 'POs raised', type: 'number' }, { key: 'ordered', label: 'Ordered value', type: 'money' }, { key: 'openOrders', label: 'Still open', type: 'number' }, { key: 'receipts', label: 'Goods receipts', type: 'number' }, { key: 'received', label: 'Received value', type: 'money' }],
      rows,
      totals: { supplier: 'Total', orders: sum(rows, 'orders'), ordered: sum(rows, 'ordered'), openOrders: sum(rows, 'openOrders'), receipts: sum(rows, 'receipts'), received: sum(rows, 'received') },
      chart: { type: 'bar', x: 'supplier', series: ['ordered', 'received'] },
    };
  },

  async 'staff-attendance'(c) {
    const agg = await Attendance.aggregate([
      { $match: { date: { $gte: c.fromStr, $lte: c.toStr }, ...deptMatch(c) } },
      {
        $group: {
          _id: '$employeeId',
          present: { $sum: { $cond: [{ $in: ['$status', ['Present', 'Late']] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'Late'] }, 1, 0] } },
          halfDay: { $sum: { $cond: [{ $eq: ['$status', 'HalfDay'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'Absent'] }, 1, 0] } },
          onLeave: { $sum: { $cond: [{ $eq: ['$status', 'OnLeave'] }, 1, 0] } },
          lateMinutes: { $sum: '$lateMinutes' },
          overtimeMinutes: { $sum: '$overtimeMinutes' },
        },
      },
      { $lookup: { from: 'employees', localField: '_id', foreignField: '_id', as: 'e' } },
      { $set: { e: { $first: '$e' } } },
      { $lookup: { from: 'departments', localField: 'e.departmentId', foreignField: '_id', as: 'd' } },
      { $project: { _id: 0, employeeNo: '$e.employeeNo', name: { $concat: ['$e.firstName', ' ', '$e.lastName'] }, department: { $first: '$d.name' }, present: 1, late: 1, halfDay: 1, absent: 1, onLeave: 1, lateMinutes: 1, overtimeHours: { $round: [{ $divide: ['$overtimeMinutes', 60] }, 1] } } },
      { $sort: { department: 1, name: 1 } },
    ]);
    const rows = agg.map((r) => ({ ...r, attendanceRate: pct(r.present + r.halfDay * 0.5, r.present + r.halfDay + r.absent) }));
    return {
      columns: [{ key: 'employeeNo', label: 'Emp. no.' }, { key: 'name', label: 'Employee' }, { key: 'department', label: 'Department' }, { key: 'present', label: 'Present', type: 'number' }, { key: 'late', label: 'Late', type: 'number' }, { key: 'halfDay', label: 'Half day', type: 'number' }, { key: 'absent', label: 'Absent', type: 'number' }, { key: 'onLeave', label: 'Leave', type: 'number' }, { key: 'lateMinutes', label: 'Late min', type: 'number' }, { key: 'overtimeHours', label: 'Overtime h', type: 'number' }, { key: 'attendanceRate', label: 'Attendance', type: 'percent' }],
      rows,
      totals: { employeeNo: `${rows.length} staff`, name: '', department: '', present: sum(rows, 'present'), late: sum(rows, 'late'), halfDay: sum(rows, 'halfDay'), absent: sum(rows, 'absent'), onLeave: sum(rows, 'onLeave'), lateMinutes: sum(rows, 'lateMinutes'), overtimeHours: sum(rows, 'overtimeHours'), attendanceRate: pct(sum(rows, 'present') + sum(rows, 'halfDay') * 0.5, sum(rows, 'present') + sum(rows, 'halfDay') + sum(rows, 'absent')) },
    };
  },

  async 'payroll-summary'(c) {
    const runs = await PayrollRun.find({ status: 'Processed', period: { $gte: c.fromStr.slice(0, 7), $lte: c.toStr.slice(0, 7) } }).select('_id runNo period').lean();
    const agg = await PayrollItem.aggregate([
      { $match: { runId: { $in: runs.map((r) => r._id) }, ...deptMatch(c) } },
      { $group: { _id: { period: '$period', dept: '$departmentName' }, employees: { $sum: 1 }, basic: { $sum: '$basic' }, allowances: { $sum: '$allowanceTotal' }, overtime: { $sum: '$overtimePay' }, gross: { $sum: '$gross' }, tax: { $sum: '$tax' }, deductions: { $sum: '$totalDeductions' }, net: { $sum: '$net' } } },
      { $sort: { '_id.period': 1, '_id.dept': 1 } },
    ]);
    const rows = agg.map((r) => ({ period: r._id.period, department: r._id.dept ?? 'Unassigned', employees: r.employees, basic: round2(r.basic), allowances: round2(r.allowances), overtime: round2(r.overtime), gross: round2(r.gross), tax: round2(r.tax), deductions: round2(r.deductions), net: round2(r.net) }));
    return {
      columns: [{ key: 'period', label: 'Month' }, { key: 'department', label: 'Department' }, { key: 'employees', label: 'Staff', type: 'number' }, { key: 'basic', label: 'Basic', type: 'money' }, { key: 'allowances', label: 'Allowances', type: 'money' }, { key: 'overtime', label: 'Overtime', type: 'money' }, { key: 'gross', label: 'Gross', type: 'money' }, { key: 'tax', label: 'Tax', type: 'money' }, { key: 'deductions', label: 'All deductions', type: 'money' }, { key: 'net', label: 'Net pay', type: 'money' }],
      rows,
      totals: { period: `${runs.length} run(s)`, department: '', employees: sum(rows, 'employees'), basic: sum(rows, 'basic'), allowances: sum(rows, 'allowances'), overtime: sum(rows, 'overtime'), gross: sum(rows, 'gross'), tax: sum(rows, 'tax'), deductions: sum(rows, 'deductions'), net: sum(rows, 'net') },
      chart: { type: 'bar', x: 'department', series: ['gross', 'net'] },
    };
  },

  async 'leave-summary'(c) {
    const agg = await LeaveRequest.aggregate([
      { $match: { status: 'Approved', from: { $lte: c.toStr }, to: { $gte: c.fromStr }, ...deptMatch(c) } },
      { $lookup: { from: 'departments', localField: 'departmentId', foreignField: '_id', as: 'd' } },
      { $group: { _id: { dept: { $first: '$d.name' }, type: '$type' }, requests: { $sum: 1 }, days: { $sum: '$days' }, staff: { $addToSet: '$employeeId' } } },
      { $sort: { '_id.dept': 1, '_id.type': 1 } },
    ]);
    const rows = agg.map((r) => ({ department: r._id.dept ?? 'Unassigned', type: r._id.type, staff: r.staff.length, requests: r.requests, days: r.days }));
    return {
      columns: [{ key: 'department', label: 'Department' }, { key: 'type', label: 'Leave type' }, { key: 'staff', label: 'Staff', type: 'number' }, { key: 'requests', label: 'Requests', type: 'number' }, { key: 'days', label: 'Days', type: 'number' }],
      rows,
      totals: { department: 'Total', type: '', staff: null, requests: sum(rows, 'requests'), days: sum(rows, 'days') },
    };
  },
};

export function availableReports() {
  return REPORTS.filter((r) => r.anyOf.some(can));
}

export async function runReport(key: string, q: ReportQuery): Promise<ReportResult> {
  requireCtx();
  const def = REPORTS.find((r) => r.key === key);
  if (!def || !builders[key]) throw new NotFoundError('Report');
  if (!def.anyOf.some(can)) throw new ForbiddenError('You do not have access to this report');
  const c = resolve(q);
  const out = await builders[key](c);
  const parts: string[] = [];
  if (def.filters.includes('dateRange')) parts.push(`${c.fromStr} to ${c.toStr}`);
  else parts.push(`As of ${todayString()}`);
  if (c.departmentId) parts.push(`Department: ${(await Department.findById(c.departmentId).select('name').lean())?.name ?? '—'}`);
  if (c.doctorId) parts.push(`Doctor: ${(await Doctor.findById(c.doctorId).select('name').lean())?.name ?? '—'}`);
  await recordAudit({ action: q.format === 'json' ? 'report.viewed' : 'report.exported', module: 'Reports', entity: 'Report', entityId: key, meta: { format: q.format, from: c.fromStr, to: c.toStr, departmentId: c.departmentId, doctorId: c.doctorId, rows: out.rows.length } });
  return { key, title: def.title, subtitle: parts.join(' · '), ...out, generatedAt: new Date().toISOString() };
}
