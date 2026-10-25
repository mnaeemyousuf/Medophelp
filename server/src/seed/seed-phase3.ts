import type { Types } from 'mongoose';
import { ALL_PERMISSIONS } from '@hms/shared';
import { runWithContext } from '../core/context';
import { Department } from '../modules/organization/organization.models';
import { Doctor, Nurse } from '../modules/staff/staff.models';
import { Patient } from '../modules/patients/patient.models';
import { Bed, Room, Ward, Admission } from '../modules/ipd/ipd.models';
import { admitCore, discharge } from '../modules/ipd/ipd.service';
import { EmergencyCase } from '../modules/emergency/emergency.models';
import { disposition, quickRegister, takeCase, triage } from '../modules/emergency/emergency.service';
import { act, createClaim, decide, eligibleInvoices, markPaid } from '../modules/insurance/insurance.service';
import { withTransaction } from '../core/db';

const HOUR = 3_600_000;

const WARDS = [
  ['GEN-M', 'General Ward (Male)', 'General', 'GM', '1st', 5000, ['101', '102', '103'], 4],
  ['GEN-F', 'General Ward (Female)', 'General', 'GM', '2nd', 5000, ['201', '202', '203'], 4],
  ['PVT', 'Private Rooms', 'Private', 'GM', '3rd', 15000, ['301', '302', '303', '304', '305', '306'], 1],
  ['ICU', 'Intensive Care Unit', 'ICU', 'ER', 'Ground', 40000, ['ICU'], 6],
  ['PED', 'Paediatric Ward', 'Pediatric', 'PED', '4th', 6000, ['401', '402'], 4],
] as const;

/**
 * Phase 3 demo data, created through the real services (so bed occupancy, numbering, billing and
 * audit are exactly what the app produces), then back-dated where a realistic history needs it.
 */
export async function seedPhase3(hid: Types.ObjectId, actors: { doctorUserId: Types.ObjectId; doctorId: Types.ObjectId; doctorName: string; accountsUserId: Types.ObjectId }) {
  const asStaff = <T>(fn: () => Promise<T>, who: 'doctor' | 'accounts' = 'doctor') =>
    runWithContext(
      {
        hospitalId: hid,
        userId: who === 'doctor' ? actors.doctorUserId : actors.accountsUserId,
        userName: who === 'doctor' ? actors.doctorName : 'Saad Mirza',
        roles: ['Seed'],
        permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== 'portal.self')),
        doctorId: who === 'doctor' ? actors.doctorId : undefined,
      },
      fn,
    );

  // Wards, rooms and beds
  const depts = await Department.find({ hospitalId: hid }).lean();
  const dept = (code: string) => depts.find((d) => d.code === code)?._id;
  let bedCount = 0;
  for (const [code, name, type, d, floor, rate, rooms, bedsPerRoom] of WARDS) {
    const ward = await Ward.create({ hospitalId: hid, code, name, type, departmentId: dept(d), floor, chargePerDay: rate });
    for (const roomNo of rooms) {
      const room = await Room.create({ hospitalId: hid, wardId: ward._id, roomNo });
      for (let b = 1; b <= bedsPerRoom; b++) {
        await Bed.create({ hospitalId: hid, wardId: ward._id, roomId: room._id, bedNo: bedsPerRoom === 1 ? 'A' : `${code === 'ICU' ? 'ICU-' : ''}${String.fromCharCode(64 + b)}`, chargePerDay: code === 'ICU' && b <= 2 ? 55000 : undefined });
        bedCount++;
      }
    }
  }
  const freeBed = async (wardCode: string) => {
    const ward = await Ward.findOne({ hospitalId: hid, code: wardCode }).lean();
    return (await Bed.findOne({ hospitalId: hid, wardId: ward!._id, status: 'Available' }).sort({ bedNo: 1 }).lean())!._id.toString();
  };

  const patients = await Patient.find({ hospitalId: hid, isProvisional: false }).sort({ mrn: 1 }).lean();
  const doctors = await Doctor.find({ hospitalId: hid }).lean();
  const nurse = await Nurse.findOne({ hospitalId: hid }).lean();
  const backdate = async (admissionId: Types.ObjectId, hoursAgo: number) => {
    const at = new Date(Date.now() - hoursAgo * HOUR);
    await Admission.updateOne({ _id: admissionId }, { $set: { admittedAt: at, 'stays.0.from': at, 'notes.0.at': at } });
  };

  // Current inpatients (patients 2,3,6,7,11,12) and two past admissions (patients 8, 9)
  const plan: Array<[number, string, number, string, number]> = [
    [2, 'GEN-M', 1, 'Community-acquired pneumonia', 52],
    [3, 'GEN-F', 4, 'Uncontrolled diabetes with DKA', 30],
    [6, 'PVT', 3, 'Elective knee arthroscopy', 20],
    [7, 'ICU', 1, 'Acute myocardial infarction', 14],
    [11, 'PED', 2, 'Severe dehydration (gastroenteritis)', 8],
    [12, 'GEN-M', 8, 'Cellulitis of the leg', 76],
  ];
  let inpatients = 0;
  for (const [pi, ward, di, reason, hoursAgo] of plan) {
    await asStaff(() =>
      withTransaction(async () => {
        const adm = await admitCore({ patientId: patients[pi]._id.toString(), bedId: await freeBed(ward), attendingDoctorId: doctors[di % doctors.length]._id.toString(), source: 'Direct', reason, assignedNurseId: nurse?._id.toString() });
        await backdate(adm._id, hoursAgo);
      }),
    );
    inpatients++;
  }
  for (const [pi, ward, reason, days] of [[8, 'GEN-F', 'Acute pyelonephritis', 4], [9, 'PVT', 'Laparoscopic cholecystectomy', 2]] as const) {
    const admission = await asStaff(async () => {
      const a = await withTransaction(async () => admitCore({ patientId: patients[pi]._id.toString(), bedId: await freeBed(ward), attendingDoctorId: actors.doctorId.toString(), source: 'Direct', reason }));
      await backdate(a._id, days * 24 + 5);
      return a;
    });
    await asStaff(() =>
      discharge(admission._id.toString(), {
        type: 'Routine',
        finalDiagnosis: reason,
        treatmentGiven: 'IV antibiotics and supportive care; responded well.',
        conditionAtDischarge: 'Stable, afebrile, ambulant',
        medications: 'As per discharge prescription',
        instructions: 'Rest, oral fluids, return if fever recurs.',
      }),
    );
    // discharged at a realistic time in the past
    await Admission.updateOne({ _id: admission._id }, { $set: { 'discharge.at': new Date(Date.now() - 5 * HOUR), 'stays.0.to': new Date(Date.now() - 5 * HOUR) } });
  }
  // Housekeeping states for the board
  const genF = await Ward.findOne({ hospitalId: hid, code: 'GEN-F' }).lean();
  const spare = await Bed.find({ hospitalId: hid, wardId: genF!._id, status: 'Available' }).limit(2).lean();
  if (spare[0]) await Bed.updateOne({ _id: spare[0]._id }, { status: 'Maintenance', statusNote: 'Bed rail repair' });

  // Emergency cases across the workflow (arrival times back-dated to make waiting times real)
  const er = async (input: Parameters<typeof quickRegister>[0], minutesAgo: number) => {
    const c = await asStaff(() => quickRegister(input));
    await EmergencyCase.updateOne({ _id: c._id }, { $set: { arrivalAt: new Date(Date.now() - minutesAgo * 60_000), 'events.0.at': new Date(Date.now() - minutesAgo * 60_000) } });
    return c;
  };
  const vitals = (sys: number, dia: number, hr: number, spo2: number, t = 37.2) => ({ systolicBp: sys, diastolicBp: dia, heartRate: hr, temperatureC: t, spo2, weightKg: 70, heightCm: 170, painScale: 8 });
  const c1 = await er({ name: 'Unknown', gender: 'Male', age: 45, arrivalMode: 'Ambulance', presentingComplaint: 'Road traffic accident, head injury, GCS 10' }, 6);
  await asStaff(() => triage(c1._id.toString(), { level: 'Critical', notes: 'Unresponsive to voice, bleeding scalp wound', vitals: vitals(90, 60, 124, 91) }));
  const c2 = await er({ name: 'Zubair Ahmed', gender: 'Male', age: 58, cnic: '35202-5551234-7', emergencyContactName: 'Asma Zubair', emergencyContactPhone: '+92 300 5551234', arrivalMode: 'Walk-in', presentingComplaint: 'Central chest pain for 1 hour, sweating' }, 22);
  await asStaff(() => triage(c2._id.toString(), { level: 'Urgent', vitals: vitals(160, 98, 104, 95) }));
  await asStaff(() => takeCase(c2._id.toString()));
  await EmergencyCase.updateOne({ _id: c2._id }, { $set: { treatmentStartedAt: new Date(Date.now() - 12 * 60_000) } });
  const c3 = await er({ name: 'Hina Shah', gender: 'Female', age: 26, arrivalMode: 'Walk-in', presentingComplaint: 'High fever and body aches for 3 days', triageLevel: 'SemiUrgent' }, 48);
  void c3;
  await er({ name: 'Ali Raza', gender: 'Male', age: 9, emergencyContactName: 'Raza Ali', emergencyContactPhone: '+92 321 7778899', arrivalMode: 'Walk-in', presentingComplaint: 'Cut on the hand while playing' }, 15);
  // finished episodes
  const c5 = await er({ name: 'Sobia Khan', gender: 'Female', age: 34, arrivalMode: 'Walk-in', presentingComplaint: 'Migraine with vomiting', triageLevel: 'NonUrgent' }, 300);
  await asStaff(() => takeCase(c5._id.toString()));
  await EmergencyCase.updateOne({ _id: c5._id }, { $set: { treatmentStartedAt: new Date(Date.now() - 280 * 60_000) } }); // seen 20 min after arrival
  await asStaff(() => disposition(c5._id.toString(), { type: 'Discharged', notes: 'Responded to IV analgesia and antiemetic. Discharged with advice.' }));
  const c6 = await er({ name: 'Rashid Mehmood', gender: 'Male', age: 67, arrivalMode: 'Ambulance', presentingComplaint: 'Sudden weakness of the right side', triageLevel: 'Critical' }, 240);
  await asStaff(() => takeCase(c6._id.toString()));
  await EmergencyCase.updateOne({ _id: c6._id }, { $set: { treatmentStartedAt: new Date(Date.now() - 236 * 60_000) } }); // critical: seen within 4 min
  await asStaff(async () => disposition(c6._id.toString(), { type: 'Admitted', notes: 'Suspected stroke, CT arranged, admitted to ICU', admission: { bedId: await freeBed('ICU'), reason: 'Acute ischaemic stroke (suspected)' } }));
  const c7 = await er({ name: 'Unknown', gender: 'Female', age: 30, arrivalMode: 'Walk-in', presentingComplaint: 'Abdominal pain', triageLevel: 'NonUrgent' }, 200);
  await asStaff(() => disposition(c7._id.toString(), { type: 'LeftWithoutBeingSeen', notes: 'Not found when called at 3 attempts.' }));

  // Insurance claims in several states (insured seeded patients' outstanding invoices)
  const invoices = (await asStaff(() => eligibleInvoices(), 'accounts')).slice(0, 5);
  const claimStates = ['Paid', 'PartiallyApproved', 'Submitted', 'Draft', 'Approved'] as const;
  let claims = 0;
  for (const [n, inv] of invoices.entries()) {
    const st = claimStates[n % claimStates.length];
    await asStaff(async () => {
      const claim = await createClaim({ invoiceId: inv._id.toString(), notes: 'Seeded demo claim' }).catch(() => null);
      if (!claim) return;
      claims++;
      const id = claim._id.toString();
      if (st === 'Draft') return;
      await act(id, 'submit');
      if (st === 'Submitted') return;
      if (st === 'PartiallyApproved') return void (await decide(id, { decision: 'PartiallyApproved', approvedAmount: Math.round(claim.claimAmount * 0.7), notes: 'Room upgrade not covered' }));
      await decide(id, { decision: 'Approved', approvedAmount: claim.claimAmount, payerReference: `PAY-${1000 + n}` });
      if (st === 'Paid') await markPaid(id, { amount: claim.claimAmount, payerReference: `REM-${5000 + n}` });
    }, 'accounts');
  }

  return { wards: WARDS.length, beds: bedCount, inpatients: inpatients + 1, emergencyCases: 7, claims };
}
