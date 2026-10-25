import { can, requireCtx } from '../../core/context';
import { dateOnly, todayString } from '../../core/http';
import { Patient } from '../patients/patient.models';
import { Appointment, Visit } from '../appointments/appointment.models';
import { Prescription } from '../clinical/clinical.models';
import { Invoice, Payment, Refund } from '../billing/billing.models';
import { labStats } from '../laboratory/lab.service';
import { stockSummary } from '../inventory/inventory.service';
import { ipdStats } from '../ipd/ipd.service';
import { emergencyStats } from '../emergency/emergency.service';
import { attendanceTrend } from '../hr/hr.service';

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';

/** Resolves a preset to [from, to) in local calendar days. */
export function resolveRange(preset: RangePreset, from?: string, to?: string) {
  const today = dateOnly(todayString());
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  switch (preset) {
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    case 'week': {
      const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
      return { from: addDays(today, -dow), to: addDays(today, 1) };
    }
    case 'month':
      return { from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)), to: addDays(today, 1) };
    case 'lastMonth':
      return {
        from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
      };
    case 'custom':
      return { from: from ? dateOnly(from) : today, to: addDays(to ? dateOnly(to) : today, 1) };
    default:
      return { from: today, to: addDays(today, 1) };
  }
}

const dayKey = { $dateToString: { format: '%Y-%m-%d', date: '$_d' } };

/**
 * Executive dashboard. Each block is computed only if the caller may see it, so the same endpoint
 * serves admins, management and accountants without leaking figures across roles.
 * Modules not live yet (lab, pharmacy stock, IPD, emergency, HR) are reported as `null`,
 * never as made-up numbers.
 */
export async function summary(range: { from: Date; to: Date }) {
  requireCtx();
  const executive = can('dashboard.executive');
  const financial = can('dashboard.financial') || executive;
  const today = { from: dateOnly(todayString()), to: new Date(dateOnly(todayString()).getTime() + 86_400_000) };

  const kpis: Record<string, number | null> = {};
  const charts: Record<string, unknown> = {};

  if (executive) {
    const [lab, stock, ipd, er, erToday] = await Promise.all([labStats(), stockSummary(), ipdStats(), emergencyStats(range), emergencyStats(today)]);
    const [totalPatients, newPatients, todaysAppointments, pendingPrescriptions, visitsByType] = await Promise.all([
      Patient.countDocuments({}),
      Patient.countDocuments({ createdAt: { $gte: range.from, $lt: range.to } }),
      Appointment.countDocuments({ date: today.from, status: { $nin: ['Cancelled'] } }),
      Prescription.countDocuments({ status: { $in: ['Active', 'PartiallyDispensed'] } }),
      Visit.aggregate([{ $match: { startedAt: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ]);
    Object.assign(kpis, {
      totalPatients,
      newPatients,
      todaysAppointments,
      todaysAdmissions: ipd.admittedToday,
      todaysDischarges: ipd.dischargedToday,
      emergencyCases: erToday.total,
      inpatients: ipd.inpatients,
      bedOccupancyPct: ipd.occupancyPct,
      pendingLabTests: lab.pending,
      pendingPrescriptions,
      lowStockMedicines: stock.lowStockMedicines,
      expiringBatches: stock.expiringIn30Days,
      expiredBatches: stock.expiredBatches,
    });

    const [inflow, apptByDoctor, apptByStatus] = await Promise.all([
      Visit.aggregate([
        { $match: { startedAt: { $gte: range.from, $lt: range.to } } },
        { $set: { _d: '$startedAt' } },
        { $group: { _id: dayKey, visits: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Appointment.aggregate([
        { $match: { date: { $gte: range.from, $lt: range.to } } },
        { $group: { _id: '$doctorId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } } } },
        { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'd' } },
        { $project: { doctor: { $ifNull: [{ $first: '$d.name' }, 'Unknown'] }, total: 1, completed: 1 } },
        { $sort: { total: -1 } },
        { $limit: 10 },
      ]),
      Appointment.aggregate([{ $match: { date: { $gte: range.from, $lt: range.to } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const newByDay = await Patient.aggregate([
      { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
      { $set: { _d: '$createdAt' } },
      { $group: { _id: dayKey, registrations: { $sum: 1 } } },
    ]);
    const regMap = new Map(newByDay.map((r) => [r._id, r.registrations]));
    const visitMap = new Map(inflow.map((r) => [r._id, r.visits]));
    const days: Array<{ date: string; visits: number; registrations: number }> = [];
    for (let d = new Date(range.from); d < range.to; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      days.push({ date: k, visits: visitMap.get(k) ?? 0, registrations: regMap.get(k) ?? 0 });
    }
    charts.patientInflow = days;
    charts.opdVsIpd = ['OPD', 'IPD', 'Emergency'].map((t) => ({ type: t, count: visitsByType.find((v) => v._id === t)?.count ?? 0 }));
    charts.doctorAppointments = apptByDoctor;
    charts.appointmentStatus = apptByStatus.map((s) => ({ status: s._id, count: s.count }));
    charts.emergencyCases = er.byDay;
    charts.emergencyResponse = er.responseTimes;
    charts.bedOccupancy = ipd.bedsByStatus;
    charts.labTurnaround = lab.turnaround;
    charts.pharmacyStock = stock.byCategory;
    charts.medicineExpiry = stock.expiryByMonth;
    charts.staffAttendance = await attendanceTrend(14);
  }

  if (financial) {
    const [rev, ref, outstanding, revenueBySource] = await Promise.all([
      Payment.aggregate([{ $match: { receivedAt: { $gte: range.from, $lt: range.to } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
      Refund.aggregate([{ $match: { processedAt: { $gte: range.from, $lt: range.to } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
      Invoice.aggregate([{ $match: { status: { $in: ['Issued', 'PartiallyPaid'] } } }, { $group: { _id: null, sum: { $sum: '$balance' }, count: { $sum: 1 } } }]),
      Payment.aggregate([
        { $match: { receivedAt: { $gte: range.from, $lt: range.to } } },
        { $lookup: { from: 'invoices', localField: 'invoiceId', foreignField: '_id', as: 'inv' } },
        { $group: { _id: { $first: '$inv.source' }, amount: { $sum: '$amount' } } },
        { $sort: { amount: -1 } },
      ]),
    ]);
    kpis.revenue = (rev[0]?.sum ?? 0) - (ref[0]?.sum ?? 0);
    const [revToday, refToday] = await Promise.all([
      Payment.aggregate([{ $match: { receivedAt: { $gte: today.from, $lt: today.to } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
      Refund.aggregate([{ $match: { processedAt: { $gte: today.from, $lt: today.to } } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
    ]);
    kpis.todaysRevenue = (revToday[0]?.sum ?? 0) - (refToday[0]?.sum ?? 0);
    kpis.outstandingAmount = outstanding[0]?.sum ?? 0;
    kpis.outstandingInvoices = outstanding[0]?.count ?? 0;
    charts.revenueByDepartment = revenueBySource.map((r) => ({ department: r._id ?? 'Other', amount: r.amount }));
    const revByDay = await Payment.aggregate([
      { $match: { receivedAt: { $gte: range.from, $lt: range.to } } },
      { $set: { _d: '$receivedAt' } },
      { $group: { _id: dayKey, amount: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]);
    charts.revenueByDay = revByDay.map((r) => ({ date: r._id, amount: r.amount }));
  }

  return { range: { from: range.from.toISOString().slice(0, 10), to: new Date(range.to.getTime() - 1).toISOString().slice(0, 10) }, kpis, charts };
}

/** Front-desk numbers for reception and nursing dashboards. */
export async function frontDesk() {
  const today = dateOnly(todayString());
  const byStatus = await Appointment.aggregate([{ $match: { date: today } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const count = (s: string) => byStatus.find((b) => b._id === s)?.count ?? 0;
  const registeredToday = await Patient.countDocuments({ createdAt: { $gte: today } });
  return {
    registeredToday,
    scheduled: count('Scheduled') + count('Confirmed'),
    checkedIn: count('CheckedIn'),
    inNursing: count('NurseAssessment'),
    waitingForDoctor: count('WaitingForDoctor'),
    inConsultation: count('InConsultation'),
    completed: count('Completed'),
    cancelled: count('Cancelled'),
    noShow: count('NoShow'),
  };
}
