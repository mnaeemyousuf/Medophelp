import { Router } from 'express';
import { z } from 'zod';
import { can, requireCtx } from '../../core/context';
import { ah, escapeRegex } from '../../core/http';
import { validate } from '../../core/middleware/validate';
import { Patient } from '../patients/patient.models';
import { Appointment } from '../appointments/appointment.models';
import { Prescription } from '../clinical/clinical.models';
import { Invoice } from '../billing/billing.models';
import { Employee } from '../staff/staff.models';
import { LabOrder } from '../laboratory/lab.models';
import { Item } from '../inventory/inventory.models';
import { PurchaseOrder } from '../purchasing/purchasing.models';
import { EmergencyCase } from '../emergency/emergency.models';
import { Admission } from '../ipd/ipd.models';
import { InsuranceClaim } from '../insurance/insurance.models';
import { Candidate } from '../recruitment/recruitment.models';

export const searchRouter = Router();

/**
 * Global search. Each result group is searched only if the caller has the permission to see that
 * kind of record, so results never reveal what the user could not open anyway.
 */
searchRouter.get('/', validate(z.object({ q: z.string().trim().min(2).max(60) }), 'query'), ah(async (req, res) => {
  const c = requireCtx();
  const q = (req.query as unknown as { q: string }).q;
  if (c.patientId) return res.json({ groups: [] }); // portal users don't get hospital-wide search
  const rx = new RegExp(escapeRegex(q), 'i');
  const prefix = new RegExp(`^${escapeRegex(q)}`, 'i');
  const digits = q.replace(/\D/g, '');
  const groups: Array<{ type: string; label: string; items: Array<{ id: string; title: string; subtitle?: string; href: string }> }> = [];
  const tasks: Promise<void>[] = [];

  if (can('patients.view')) {
    const or: Record<string, unknown>[] = [{ mrn: prefix }, { searchName: new RegExp(`(^|\\s)${escapeRegex(q.toLowerCase())}`) }];
    if (digits.length >= 5) or.push({ cnic: new RegExp(`^${escapeRegex(q)}`) }, { phone: new RegExp(escapeRegex(digits)) });
    tasks.push(
      Patient.find({ $or: or }).select('mrn firstName lastName phone').limit(6).lean().then((rows) => {
        groups.push({ type: 'patient', label: 'Patients', items: rows.map((p) => ({ id: p._id.toString(), title: `${p.firstName} ${p.lastName}`, subtitle: `${p.mrn} · ${p.phone}`, href: `/patients/${p._id}` })) });
      }),
    );
  }
  if (can('appointments.view')) {
    tasks.push(
      Appointment.find({ appointmentNo: prefix }).populate('patientId', 'firstName lastName').limit(5).lean().then((rows) => {
        groups.push({ type: 'appointment', label: 'Appointments', items: rows.map((a) => ({ id: a._id.toString(), title: a.appointmentNo, subtitle: `${(a.patientId as any)?.firstName ?? ''} ${(a.patientId as any)?.lastName ?? ''} · ${a.status}`, href: `/appointments?focus=${a._id}` })) });
      }),
    );
  }
  if (can('prescriptions.view') || can('pharmacy.dispense')) {
    tasks.push(
      Prescription.find({ prescriptionNo: prefix }).limit(5).lean().then((rows) => {
        groups.push({ type: 'prescription', label: 'Prescriptions', items: rows.map((r) => ({ id: r._id.toString(), title: r.prescriptionNo, subtitle: r.status, href: `/patients/${r.patientId}?tab=prescriptions` })) });
      }),
    );
  }
  if (can('billing.view')) {
    tasks.push(
      Invoice.find({ $or: [{ invoiceNo: prefix }, { mrn: prefix }] }).select('invoiceNo patientName status balance').limit(5).lean().then((rows) => {
        groups.push({ type: 'invoice', label: 'Invoices', items: rows.map((i) => ({ id: i._id.toString(), title: i.invoiceNo, subtitle: `${i.patientName} · ${i.status}`, href: `/billing/invoices/${i._id}` })) });
      }),
    );
  }
  if (can('lab.process') || can('lab.verify')) {
    tasks.push(
      LabOrder.find({ orderNo: prefix }).select('orderNo status items.testName').limit(5).lean().then((rows) => {
        groups.push({ type: 'lab', label: 'Lab orders', items: rows.map((o) => ({ id: o._id.toString(), title: o.orderNo, subtitle: `${o.items.map((i) => i.testName).join(', ')} · ${o.status}`, href: `/laboratory/orders/${o._id}` })) });
      }),
    );
  }
  if (can('inventory.view')) {
    tasks.push(
      Item.find({ $or: [{ sku: prefix }, { searchName: new RegExp(escapeRegex(q.toLowerCase())) }] }).select('sku name currentStock unit').limit(5).lean().then((rows) => {
        groups.push({ type: 'item', label: 'Stock items', items: rows.map((i) => ({ id: i._id.toString(), title: i.name, subtitle: `${i.sku} · ${i.currentStock} ${i.unit} in stock`, href: `/inventory/items/${i._id}` })) });
      }),
    );
  }
  if (can('purchasing.manage') || can('purchasing.approve')) {
    tasks.push(
      PurchaseOrder.find({ poNo: prefix }).select('poNo supplierName status').limit(5).lean().then((rows) => {
        groups.push({ type: 'po', label: 'Purchase orders', items: rows.map((p) => ({ id: p._id.toString(), title: p.poNo, subtitle: `${p.supplierName} · ${p.status}`, href: `/purchasing/orders/${p._id}` })) });
      }),
    );
  }
  if (can('emergency.view')) {
    tasks.push(
      EmergencyCase.find({ caseNo: prefix }).select('caseNo status triageLevel presentingComplaint').limit(5).lean().then((rows) => {
        groups.push({ type: 'er', label: 'Emergency cases', items: rows.map((e) => ({ id: e._id.toString(), title: e.caseNo, subtitle: `${e.triageLevel ?? 'Untriaged'} · ${e.status} · ${e.presentingComplaint}`, href: `/emergency/${e._id}` })) });
      }),
    );
  }
  if (can('ipd.view')) {
    tasks.push(
      Admission.find({ admissionNo: prefix }).select('admissionNo status reason').limit(5).lean().then((rows) => {
        groups.push({ type: 'admission', label: 'Admissions', items: rows.map((a) => ({ id: a._id.toString(), title: a.admissionNo, subtitle: `${a.status} · ${a.reason}`, href: `/ipd/admissions/${a._id}` })) });
      }),
    );
  }
  if (can('insurance.manage')) {
    tasks.push(
      InsuranceClaim.find({ claimNo: prefix }).select('claimNo status provider patientName').limit(5).lean().then((rows) => {
        groups.push({ type: 'claim', label: 'Insurance claims', items: rows.map((x) => ({ id: x._id.toString(), title: x.claimNo, subtitle: `${x.patientName} · ${x.provider} · ${x.status}`, href: `/insurance/claims/${x._id}` })) });
      }),
    );
  }
  if (can('recruitment.manage') || can('recruitment.approve')) {
    tasks.push(
      Candidate.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }).select('firstName lastName stage email').limit(5).lean().then((rows) => {
        groups.push({ type: 'candidate', label: 'Candidates', items: rows.map((x) => ({ id: x._id.toString(), title: `${x.firstName} ${x.lastName}`, subtitle: `${x.email} · ${x.stage}`, href: `/recruitment/candidates/${x._id}` })) });
      }),
    );
  }
  if (can('hr.employees') || can('staff.manage')) {
    tasks.push(
      Employee.find({ $or: [{ employeeNo: prefix }, { firstName: rx }, { lastName: rx }] }).select('employeeNo firstName lastName designation').limit(5).lean().then((rows) => {
        groups.push({ type: 'employee', label: 'Employees', items: rows.map((e) => ({ id: e._id.toString(), title: `${e.firstName} ${e.lastName}`, subtitle: `${e.employeeNo} · ${e.designation}`, href: `/hr/employees/${e._id}` })) });
      }),
    );
  }
  await Promise.all(tasks);
  res.json({ groups: groups.filter((g) => g.items.length) });
}));
