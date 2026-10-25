import type { Types } from 'mongoose';
import { ALL_PERMISSIONS } from '@hms/shared';
import { runWithContext } from '../core/context';
import { nextNumber } from '../core/numbering/numbering';
import { User } from '../modules/identity/identity.models';
import { Doctor } from '../modules/staff/staff.models';
import { Visit } from '../modules/appointments/appointment.models';
import { Prescription } from '../modules/clinical/clinical.models';
import { Item } from '../modules/inventory/inventory.models';
import { dispense } from '../modules/pharmacy/pharmacy.service';
import { createSchedulesForDispense } from '../modules/medication/medication.service';
import { runMedicationPass } from '../modules/medication/medication.jobs';
import { MedicationDose, MedicationSchedule } from '../modules/medication/medication.models';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Phase 5 demo data: medicines prescribed and dispensed through the real services, with reminder
 * schedules started in the past so the portal shows adherence history (mostly taken, some missed
 * or skipped), plus a chronic course about to run out (refill reminder).
 */
export async function seedPhase5(hid: Types.ObjectId, hospitalCode: string, prescriptionTemplate: string) {
  const pharmacist = await User.findOne({ email: 'pharmacy@hospital.com' }).lean();
  const portal = await User.findOne({ email: 'patient@hospital.com' }).lean();
  return runWithContext(
    { hospitalId: hid, userId: pharmacist?._id, userName: pharmacist?.fullName ?? 'Pharmacist', roles: ['Seed'], permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== 'portal.self')) },
    async () => {
      const items = await Item.find({ category: 'Medicine' }).lean();
      const med = (name: string) => items.find((i) => i.name === name)!;

      const course = async (patientId: Types.ObjectId, startDaysAgo: number, lines: Array<[string, string, string, number, number]>) => {
        const visit = await Visit.findOne({ patientId }).sort({ startedAt: -1 }).lean();
        if (!visit?.doctorId) return null;
        const doctor = await Doctor.findById(visit.doctorId).select('name').lean();
        const rx = await Prescription.create({
          prescriptionNo: await nextNumber('prescription', prescriptionTemplate, hospitalCode, hid),
          patientId,
          visitId: visit._id,
          doctorId: visit.doctorId,
          doctorName: doctor?.name,
          prescribedAt: new Date(Date.now() - startDaysAgo * DAY),
          items: lines.map(([name, dosage, frequency, timesPerDay, durationDays]) => ({ medicineId: med(name)._id, medicineName: name, dosage, frequency, timesPerDay, durationDays, quantity: timesPerDay * durationDays, route: 'Oral', instructions: 'After meals' })),
        });
        // Schedules start on the (past) prescription day; dispensing then finds them and skips.
        const start = new Date(Date.now() - startDaysAgo * DAY);
        start.setHours(0, 0, 0, 0);
        await createSchedulesForDispense(rx, rx.items.map((i) => i._id), start);
        await dispense(rx._id.toString(), { lines: rx.items.map((i) => ({ prescriptionItemId: i._id.toString(), itemId: i.medicineId!.toString(), quantity: i.quantity })) });
        return rx;
      };

      // Portal patient: diabetes + hypertension (chronic) and a short painkiller course. (Amoxicillin
      // is left untouched: its near-expiry batch is the FEFO fixture for the pharmacy tests.)
      if (portal?.patientId) await course(portal.patientId as Types.ObjectId, 6, [['Metformin 500mg', '1 tablet', 'Twice daily', 2, 30], ['Amlodipine 5mg', '1 tablet', 'Once daily', 1, 30], ['Ibuprofen 400mg', '1 tablet', 'Three times daily', 3, 5]]);

      // Another patient whose 30-day course ends in two days (refill reminder).
      const other = await Visit.findOne({ patientId: { $ne: portal?.patientId }, doctorId: { $ne: null } }).sort({ startedAt: -1 }).lean();
      if (other) await course(other.patientId, 28, [['Losartan 50mg', '1 tablet', 'Once daily', 1, 30]]);

      // Past doses: mostly taken by the patient, a few missed or skipped (deterministic).
      const past = await MedicationDose.find({ status: 'Pending', scheduledAt: { $lt: new Date(Date.now() - 2 * HOUR) } }).sort({ scheduledAt: 1 }).lean();
      for (const [i, d] of past.entries()) {
        const status = i % 11 === 4 ? 'Missed' : i % 17 === 9 ? 'Skipped' : 'Taken';
        await MedicationDose.updateOne(
          { _id: d._id },
          status === 'Missed'
            ? { status, recordedBy: 'System', recordedAt: new Date(d.scheduledAt.getTime() + 2 * HOUR) }
            : { status, recordedBy: 'Patient', recordedAt: new Date(d.scheduledAt.getTime() + ((i * 7) % 40) * 60_000), note: status === 'Skipped' ? 'Felt nauseous' : undefined },
        );
      }
      const pass = await runMedicationPass();
      return { medicationSchedules: await MedicationSchedule.countDocuments({}), medicationDoses: await MedicationDose.countDocuments({}), refillReminders: pass.refills };
    },
  );
}
