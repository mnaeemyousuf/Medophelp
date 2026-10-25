import mongoose, { Types } from 'mongoose';
import { DEFAULT_ROLE_PERMISSIONS, SYSTEM_ROLES, calculateBmi, lineTotals, passwordPolicy, vitalFlags } from '@hms/shared';
import { runWithContext } from '../core/context';
import { formatNumber, nextNumber } from '../core/numbering/numbering';
import { dateOnly, todayString } from '../core/http';
import { hashPassword } from '../modules/identity/auth.service';
import { Department, Hospital, Service } from '../modules/organization/organization.models';
import { Role, User } from '../modules/identity/identity.models';
import { Doctor, Employee, Nurse } from '../modules/staff/staff.models';
import { Patient } from '../modules/patients/patient.models';
import { Appointment, SlotLock, Visit } from '../modules/appointments/appointment.models';
import { ClinicalNote, Diagnosis, NursingAssessment, Prescription, TreatmentPlan, VitalSign } from '../modules/clinical/clinical.models';
import { Invoice, Payment } from '../modules/billing/billing.models';
import { seedPhase2 } from './seed-phase2';
import { seedPhase3 } from './seed-phase3';
import { seedPhase4 } from './seed-phase4';
import { seedPhase5 } from './seed-phase5';

// Deterministic PRNG so every seed run produces the same dataset.
let state = 42;
const rnd = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));

const FIRST_M = ['Ahmed', 'Bilal', 'Usman', 'Hamza', 'Imran', 'Faisal', 'Kashif', 'Zain', 'Omar', 'Tariq', 'Saad', 'Yasir'];
const FIRST_F = ['Ayesha', 'Fatima', 'Sana', 'Hira', 'Maryam', 'Zainab', 'Amna', 'Nadia', 'Rabia', 'Sadia', 'Khadija', 'Iqra'];
const LAST = ['Khan', 'Ahmed', 'Malik', 'Qureshi', 'Siddiqui', 'Butt', 'Chaudhry', 'Raza', 'Hussain', 'Sheikh', 'Iqbal', 'Mirza'];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar'];

const DEPARTMENTS = [
  ['GM', 'General Medicine', true],
  ['CARD', 'Cardiology', true],
  ['PED', 'Pediatrics', true],
  ['ORTH', 'Orthopedics', true],
  ['GYN', 'Gynecology & Obstetrics', true],
  ['ENT', 'ENT', true],
  ['DERM', 'Dermatology', true],
  ['ER', 'Emergency', true],
  ['LAB', 'Laboratory', true],
  ['PHAR', 'Pharmacy', false],
  ['ADMIN', 'Administration', false],
  ['ACC', 'Accounts', false],
  ['HR', 'Human Resources', false],
] as const;

const DOCTORS = [
  ['Ayesha', 'Khan', 'Female', 'GM', 'General Physician', 2000],
  ['Imran', 'Qureshi', 'Male', 'CARD', 'Cardiologist', 3500],
  ['Sana', 'Malik', 'Female', 'PED', 'Pediatrician', 2500],
  ['Faisal', 'Raza', 'Male', 'ORTH', 'Orthopedic Surgeon', 3000],
  ['Nadia', 'Siddiqui', 'Female', 'GYN', 'Gynecologist', 3000],
  ['Tariq', 'Hussain', 'Male', 'ENT', 'ENT Specialist', 2500],
  ['Hira', 'Butt', 'Female', 'DERM', 'Dermatologist', 2500],
  ['Omar', 'Sheikh', 'Male', 'ER', 'Emergency Physician', 2000],
  ['Kashif', 'Iqbal', 'Male', 'GM', 'Internal Medicine', 2500],
  ['Maryam', 'Mirza', 'Female', 'CARD', 'Cardiologist', 3500],
] as const;

const COMPLAINTS = [
  ['Fever and body aches for 3 days', 'Viral fever', 'B34.9'],
  ['Persistent dry cough', 'Acute bronchitis', 'J20.9'],
  ['Headache and dizziness', 'Essential hypertension', 'I10'],
  ['Increased thirst and urination', 'Type 2 diabetes mellitus', 'E11.9'],
  ['Lower back pain', 'Lumbago', 'M54.5'],
  ['Sore throat and difficulty swallowing', 'Acute pharyngitis', 'J02.9'],
  ['Itchy skin rash', 'Contact dermatitis', 'L25.9'],
  ['Burning epigastric pain', 'Gastritis', 'K29.7'],
] as const;

const MEDS = [
  ['Paracetamol 500mg', '1 tablet', '3 times daily', 3, 5],
  ['Amoxicillin 500mg', '1 capsule', '3 times daily', 3, 7],
  ['Omeprazole 20mg', '1 capsule', 'Once daily before breakfast', 1, 14],
  ['Amlodipine 5mg', '1 tablet', 'Once daily', 1, 30],
  ['Metformin 500mg', '1 tablet', 'Twice daily with meals', 2, 30],
  ['Cetirizine 10mg', '1 tablet', 'Once daily at night', 1, 7],
  ['Ibuprofen 400mg', '1 tablet', 'Twice daily after meals', 2, 5],
  ['Dextromethorphan syrup', '10 ml', '3 times daily', 3, 5],
] as const;

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function seed(password: string) {
  const policy = passwordPolicy.safeParse(password);
  if (!policy.success) throw new Error(`SEED_DEMO_PASSWORD does not meet the password policy: ${policy.error.issues.map((i) => i.message).join(', ')}`);

  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const hospital = await runWithContext({ roles: [], permissions: new Set(), system: true }, () =>
    Hospital.create({
      code: 'SH',
      name: 'Shamsi Hospital',
      address: '12 Main Boulevard, Gulberg III',
      city: 'Lahore',
      phone: '+92 42 3570 0000',
      email: 'info@shamsihospital.pk',
      website: 'www.shamsihospital.pk',
      currency: 'PKR',
      defaultTaxRate: 0,
    }),
  );
  const hid = hospital._id;
  const ctx = { roles: [], permissions: new Set<string>(), hospitalId: hid, system: true };

  return runWithContext(ctx, async () => {
    const passwordHash = await hashPassword(password);
    const today = dateOnly(todayString());

    // Departments & services
    const depts = await Department.insertMany(DEPARTMENTS.map(([code, name, isClinical]) => ({ hospitalId: hid, code, name, isClinical })));
    const dept = (code: string) => depts.find((d) => d.code === code)!._id;
    await Service.insertMany([
      { code: 'REG', name: 'Registration fee', category: 'OPD', price: 300 },
      { code: 'CONS-GEN', name: 'General consultation', category: 'OPD', price: 2000, departmentId: dept('GM') },
      { code: 'ECG', name: 'ECG', category: 'Procedure', price: 1500, departmentId: dept('CARD') },
      { code: 'DRESS', name: 'Wound dressing', category: 'Procedure', price: 800 },
      { code: 'NEB', name: 'Nebulization', category: 'Procedure', price: 600 },
      { code: 'INJ', name: 'Injection administration', category: 'Procedure', price: 300 },
      { code: 'ER-CONS', name: 'Emergency consultation', category: 'Emergency', price: 2500, departmentId: dept('ER') },
      { code: 'ROOM-GEN', name: 'General ward bed (per day)', category: 'IPD', price: 5000 },
    ].map((s) => ({ ...s, hospitalId: hid })));

    // Roles
    const roles = await Role.insertMany(
      Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([name, permissions]) => ({ hospitalId: hid, name, permissions, isSystem: true, description: `${name} (system role)` })),
    );
    const role = (name: string) => roles.find((r) => r.name === name)!._id;

    const mkUser = (email: string, fullName: string, roleName: string, extra: Record<string, unknown> = {}) =>
      User.create({ hospitalId: hid, email, fullName, passwordHash, roleIds: [role(roleName)], ...extra });

    await mkUser('superadmin@hospital.com', 'System Super Admin', SYSTEM_ROLES.SUPER_ADMIN);
    await mkUser('admin@hospital.com', 'Hospital Administrator', SYSTEM_ROLES.HOSPITAL_ADMIN);
    await mkUser('reception@hospital.com', 'Rabia Chaudhry', SYSTEM_ROLES.RECEPTIONIST);
    await mkUser('accounts@hospital.com', 'Saad Mirza', SYSTEM_ROLES.ACCOUNTANT);
    await mkUser('hr@hospital.com', 'Amna Sheikh', SYSTEM_ROLES.HR_MANAGER);
    await mkUser('management@hospital.com', 'Board Member', SYSTEM_ROLES.MANAGEMENT);

    // Staff
    let empSeq = 0;
    const mkEmployee = (first: string, last: string, gender: string, deptId: Types.ObjectId, designation: string, userId?: Types.ObjectId) =>
      Employee.create({
        hospitalId: hid,
        employeeNo: formatNumber('EMP-{n:5}', { code: 'SH', year: 2026, seq: ++empSeq }),
        firstName: first,
        lastName: last,
        gender,
        departmentId: deptId,
        designation,
        joiningDate: addDays(today, -between(200, 3000)),
        phone: `+92 300 ${between(1000000, 9999999)}`,
        userId,
      });

    const doctors: Array<InstanceType<typeof Doctor>> = [];
    for (const [i, [first, last, gender, dcode, spec, fee]] of DOCTORS.entries()) {
      const user = i === 0 ? await mkUser('doctor@hospital.com', `Dr. ${first} ${last}`, SYSTEM_ROLES.DOCTOR) : await mkUser(`dr.${first.toLowerCase()}.${last.toLowerCase()}@hospital.com`, `Dr. ${first} ${last}`, SYSTEM_ROLES.DOCTOR);
      const emp = await mkEmployee(first, last, gender, dept(dcode), spec, user._id);
      doctors.push(
        await Doctor.create({
          hospitalId: hid,
          employeeId: emp._id,
          userId: user._id,
          name: `Dr. ${first} ${last}`,
          departmentId: dept(dcode),
          specialization: spec,
          qualification: 'MBBS, FCPS',
          licenseNumber: `PMDC-${10000 + i * 137}`,
          consultationFee: fee,
          followUpFee: Math.round(fee * 0.6),
          slotMinutes: 15,
          dutyStart: '09:00',
          dutyEnd: '17:00',
          workingDays: [1, 2, 3, 4, 5, 6, 7],
        }),
      );
    }

    const nurseUsers: Types.ObjectId[] = [];
    for (let i = 0; i < 10; i++) {
      const female = i % 4 !== 3;
      const first = female ? FIRST_F[i] : FIRST_M[i];
      const last = LAST[(i + 3) % LAST.length];
      const user = i === 0 ? await mkUser('nurse@hospital.com', `${first} ${last}`, SYSTEM_ROLES.NURSE) : await mkUser(`nurse.${first.toLowerCase()}${i}@hospital.com`, `${first} ${last}`, SYSTEM_ROLES.NURSE);
      nurseUsers.push(user._id);
      const emp = await mkEmployee(first, last, female ? 'Female' : 'Male', dept(pick(['GM', 'PED', 'ER', 'CARD'])), 'Staff Nurse', user._id);
      await Nurse.create({ hospitalId: hid, employeeId: emp._id, userId: user._id, name: `${first} ${last}`, departmentId: emp.departmentId, qualification: 'BSc Nursing', licenseNumber: `PNC-${20000 + i * 71}` });
    }
    for (let i = 0; i < 5; i++) {
      const first = FIRST_M[(i + 5) % FIRST_M.length];
      const last = LAST[(i + 7) % LAST.length];
      // A second lab account so results can be verified by someone other than the technician.
      const user =
        i === 0
          ? await mkUser('lab@hospital.com', `${first} ${last}`, SYSTEM_ROLES.LAB_TECHNICIAN)
          : i === 1
            ? await mkUser('labsupervisor@hospital.com', `${first} ${last}`, SYSTEM_ROLES.LAB_TECHNICIAN)
            : undefined;
      await mkEmployee(first, last, 'Male', dept('LAB'), 'Lab Technician', user?._id);
    }
    for (let i = 0; i < 5; i++) {
      const first = FIRST_F[(i + 6) % FIRST_F.length];
      const last = LAST[(i + 2) % LAST.length];
      const user = i === 0 ? await mkUser('pharmacy@hospital.com', `${first} ${last}`, SYSTEM_ROLES.PHARMACIST) : undefined;
      await mkEmployee(first, last, 'Female', dept('PHAR'), 'Pharmacist', user?._id);
    }

    // Patients
    const patients: Array<InstanceType<typeof Patient>> = [];
    for (let i = 0; i < 24; i++) {
      const female = i % 2 === 0;
      // Offsets chosen so first/last name pairs don't repeat across the 24 demo patients.
      const first = female ? FIRST_F[(i * 7) % FIRST_F.length] : FIRST_M[(i * 5 + 3) % FIRST_M.length];
      const last = LAST[(i * 5 + Math.floor(i / 12)) % LAST.length];
      const dob = new Date(Date.UTC(between(1950, 2020), between(0, 11), between(1, 28)));
      const cnic = dob.getUTCFullYear() < 2008 ? `35202-${between(1000000, 9999999)}-${between(1, 9)}` : undefined;
      const mrn = await nextNumber('mrn', hospital.numbering!.mrn!, hospital.code, hid);
      const createdAt = addDays(today, -between(0, 60));
      patients.push(
        await Patient.create({
          hospitalId: hid,
          mrn,
          firstName: first,
          lastName: last,
          guardianName: `${pick(FIRST_M)} ${last}`,
          cnic,
          dateOfBirth: dob,
          gender: female ? 'Female' : 'Male',
          bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'A-', 'O-', 'B-'] as const),
          phone: `+92 3${between(0, 4)}${between(0, 9)} ${between(1000000, 9999999)}`,
          email: i < 5 ? `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com` : undefined,
          address: `House ${between(1, 300)}, Street ${between(1, 40)}`,
          city: pick(CITIES),
          emergencyContactName: `${pick(FIRST_M)} ${last}`,
          emergencyContactRelation: pick(['Father', 'Spouse', 'Brother', 'Son']),
          emergencyContactPhone: `+92 321 ${between(1000000, 9999999)}`,
          allergies: i % 4 === 0 ? [{ allergen: pick(['Penicillin', 'Sulfa drugs', 'Aspirin', 'Peanuts']), severity: pick(['Moderate', 'Severe'] as const), reaction: 'Rash, swelling' }] : [],
          medicalHistory: i % 3 === 0 ? [{ condition: pick(['Hypertension', 'Type 2 diabetes', 'Asthma', 'Hypothyroidism']), isChronic: true }] : [],
          insurances: i % 5 === 0 ? [{ provider: pick(['State Life', 'Jubilee Health', 'Adamjee Insurance']), policyNumber: `POL-${between(100000, 999999)}`, coveragePercent: 80, coverageLimit: 500000, expiresOn: addDays(today, 365) }] : [],
          createdAt,
        }),
      );
    }
    // Portal account bound to the first patient
    await mkUser('patient@hospital.com', `${patients[0].firstName} ${patients[0].lastName}`, SYSTEM_ROLES.PATIENT, { patientId: patients[0]._id });

    // Appointments: 14 past (completed with full clinical record), 8 today in various states, 6 upcoming
    const docUser = await User.findOne({ email: 'doctor@hospital.com' });
    let invoiceCount = 0;
    const mkAppointment = async (patientIdx: number, doctorIdx: number, date: Date, slot: number, status: string, extra: Record<string, unknown> = {}) => {
      const d = doctors[doctorIdx];
      const start = `${String(9 + Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}`;
      const endMin = 9 * 60 + slot * 15 + 15;
      const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      const a = await Appointment.create({
        hospitalId: hid,
        appointmentNo: await nextNumber('appointment', hospital.numbering!.appointment!, hospital.code, hid),
        patientId: patients[patientIdx]._id,
        doctorId: d._id,
        departmentId: d.departmentId,
        date,
        startTime: start,
        endTime: end,
        type: rnd() > 0.7 ? 'FollowUp' : 'New',
        status,
        reason: COMPLAINTS[patientIdx % COMPLAINTS.length][0],
        history: [{ status: 'Scheduled', at: addDays(date, -2), by: docUser?._id }],
        ...extra,
      });
      if (!['Cancelled', 'NoShow'].includes(status)) {
        await SlotLock.create({ hospitalId: hid, key: `${d._id}|${iso(date)}|${start}`, appointmentId: a._id });
      }
      return a;
    };

    const completeVisit = async (a: InstanceType<typeof Appointment>, closed: boolean) => {
      const d = doctors.find((x) => x._id.equals(a.doctorId))!;
      const p = patients.find((x) => x._id.equals(a.patientId))!;
      const startedAt = new Date(`${iso(a.date)}T${a.startTime}:00`);
      const visit = await Visit.create({
        hospitalId: hid,
        visitNo: await nextNumber('visit', hospital.numbering!.visit!, hospital.code, hid),
        patientId: p._id,
        doctorId: d._id,
        departmentId: d.departmentId,
        appointmentId: a._id,
        type: 'OPD',
        status: closed ? 'Closed' : 'Open',
        startedAt,
        endedAt: closed ? new Date(startedAt.getTime() + 25 * 60_000) : undefined,
        chiefComplaint: a.reason,
      });
      const v = { systolicBp: between(105, 155), diastolicBp: between(65, 98), heartRate: between(62, 108), temperatureC: Math.round((36.4 + rnd() * 2.2) * 10) / 10, spo2: between(93, 99), respiratoryRate: between(14, 22), weightKg: between(48, 95), heightCm: between(150, 185), painScale: between(0, 6) };
      const bmi = calculateBmi(v.weightKg, v.heightCm);
      const nurseId = pick(nurseUsers);
      const vitals = await VitalSign.create({ hospitalId: hid, patientId: p._id, visitId: visit._id, ...v, bmi, flags: vitalFlags({ ...v, bmi }), recordedAt: new Date(startedAt.getTime() - 10 * 60_000), recordedBy: nurseId, recordedByName: 'Staff Nurse' });
      await NursingAssessment.create({ hospitalId: hid, patientId: p._id, visitId: visit._id, appointmentId: a._id, vitalSignId: vitals._id, symptoms: a.reason, nurseUserId: nurseId, nurseName: 'Staff Nurse', submittedAt: vitals.recordedAt });
      a.visitId = visit._id;
      a.checkedInAt = new Date(startedAt.getTime() - 20 * 60_000);
      if (!closed) return { visit };

      const [cc, dx, icd] = COMPLAINTS[patients.indexOf(p) % COMPLAINTS.length];
      await ClinicalNote.create({ hospitalId: hid, patientId: p._id, visitId: visit._id, type: 'Consultation', chiefComplaint: cc, content: `History: ${cc.toLowerCase()}. On examination patient alert and oriented. Chest clear, abdomen soft. Plan as below.`, authorUserId: d.userId, authorName: d.name, authorRole: 'Doctor', createdAt: startedAt });
      await Diagnosis.create({ hospitalId: hid, patientId: p._id, visitId: visit._id, icdCode: icd, description: dx, type: 'Final', doctorId: d._id, doctorName: d.name, createdAt: startedAt });
      await TreatmentPlan.create({ hospitalId: hid, patientId: p._id, visitId: visit._id, plan: 'Symptomatic treatment, hydration, review if symptoms persist.', followUpDate: addDays(a.date, 14), doctorId: d._id });
      const meds = [pick(MEDS), pick(MEDS)].filter((m, i, arr) => arr.indexOf(m) === i);
      await Prescription.create({
        hospitalId: hid,
        prescriptionNo: await nextNumber('prescription', hospital.numbering!.prescription!, hospital.code, hid),
        patientId: p._id,
        visitId: visit._id,
        doctorId: d._id,
        doctorName: d.name,
        prescribedAt: startedAt,
        status: rnd() > 0.5 ? 'Dispensed' : 'Active',
        items: meds.map(([name, dose, freq, tpd, days]) => ({ medicineName: name, dosage: dose, frequency: freq, timesPerDay: tpd, durationDays: days, quantity: tpd * days, route: name.includes('syrup') ? 'Oral' : 'Oral', instructions: 'After meals' })),
      });
      a.consultationStartedAt = startedAt;
      a.completedAt = new Date(startedAt.getTime() + 25 * 60_000);

      // Consultation invoice + payment (paid, partially paid or unpaid)
      const fee = a.type === 'FollowUp' ? d.followUpFee : d.consultationFee;
      const t = lineTotals({ quantity: 1, unitPrice: fee });
      const inv = await Invoice.create({
        hospitalId: hid,
        invoiceNo: await nextNumber('invoice', hospital.numbering!.invoice!, hospital.code, hid),
        patientId: p._id,
        mrn: p.mrn,
        patientName: `${p.firstName} ${p.lastName}`,
        visitId: visit._id,
        departmentId: d.departmentId,
        source: 'OPD',
        status: 'Issued',
        items: [{ description: `Consultation — ${d.name}`, quantity: 1, unitPrice: fee, discount: 0, taxRate: 0, tax: 0, total: t.total, sourceRef: `consultation:${a._id}` }],
        subtotal: t.total,
        total: t.total,
        balance: t.total,
        issuedAt: a.completedAt,
        createdAt: a.completedAt,
      });
      invoiceCount++;
      const mode = invoiceCount % 3; // 0 paid, 1 partial, 2 unpaid
      if (mode !== 2) {
        const amount = mode === 0 ? t.total : Math.round(t.total / 2);
        await Payment.create({
          hospitalId: hid,
          receiptNo: await nextNumber('receipt', hospital.numbering!.receipt!, hospital.code, hid),
          invoiceId: inv._id,
          patientId: p._id,
          amount,
          method: pick(['Cash', 'Card', 'Online'] as const),
          reference: 'TXN-' + between(100000, 999999),
          receivedAt: a.completedAt,
          receivedBy: docUser!._id,
          receivedByName: 'Front desk',
        });
        inv.paid = amount;
        inv.balance = t.total - amount;
        inv.status = mode === 0 ? 'Paid' : 'PartiallyPaid';
        await inv.save();
      }
      return { visit };
    };

    // past completed
    for (let i = 0; i < 14; i++) {
      const date = addDays(today, -between(1, 30));
      const a = await mkAppointment(i % patients.length, i % doctors.length, date, i % 28, 'Completed');
      await completeVisit(a, true);
      a.history.push({ status: 'Completed', at: a.completedAt ?? date });
      await a.save();
    }
    // two cancelled / no-show in the past
    await mkAppointment(14, 1, addDays(today, -3), 6, 'Cancelled', { cancellationReason: 'Patient travelling' });
    await mkAppointment(15, 2, addDays(today, -2), 7, 'NoShow');

    // today — the demo doctor (index 0) gets a real queue
    const todayStates: Array<[number, number, number, string]> = [
      [0, 0, 0, 'WaitingForDoctor'],
      [16, 0, 1, 'CheckedIn'],
      [17, 0, 2, 'Confirmed'],
      [18, 0, 3, 'Scheduled'],
      [19, 0, 24, 'Scheduled'],
      [20, 2, 4, 'CheckedIn'],
      [21, 1, 5, 'Scheduled'],
      [22, 3, 6, 'Confirmed'],
    ];
    let token = 0;
    for (const [pi, di, slot, status] of todayStates) {
      const a = await mkAppointment(pi, di, today, slot, status);
      if (['CheckedIn', 'WaitingForDoctor'].includes(status)) {
        if (status === 'WaitingForDoctor') await completeVisit(a, false);
        else {
          const d = doctors[di];
          const visit = await Visit.create({ hospitalId: hid, visitNo: await nextNumber('visit', hospital.numbering!.visit!, hospital.code, hid), patientId: a.patientId, doctorId: d._id, departmentId: d.departmentId, appointmentId: a._id, type: 'OPD' });
          a.visitId = visit._id;
          a.checkedInAt = new Date();
        }
        a.tokenNumber = ++token;
        a.history.push({ status: 'CheckedIn', at: new Date() });
        await a.save();
      }
    }
    // upcoming
    for (let i = 0; i < 6; i++) await mkAppointment((i + 3) % patients.length, (i + 4) % doctors.length, addDays(today, between(1, 10)), i + 8, i % 2 ? 'Confirmed' : 'Scheduled');

    // Phase 2: stores, purchasing, pharmacy formulary, laboratory
    const storeKeeper = await mkUser('inventory@hospital.com', 'Kashif Store', SYSTEM_ROLES.INVENTORY_MANAGER);
    const phase2 = await seedPhase2(hid, hospital, { id: storeKeeper._id, name: storeKeeper.fullName }, patients[0]._id);

    // Phase 3: wards & beds, inpatients, emergency cases, insurance claims
    const accountsUser = await User.findOne({ email: 'accounts@hospital.com' });
    const phase3 = await seedPhase3(hid, { doctorUserId: docUser!._id, doctorId: doctors[0]._id, doctorName: doctors[0].name, accountsUserId: accountsUser!._id });

    // Phase 4: HR records, attendance, leave, payroll, recruitment
    const phase4 = await seedPhase4(hid, hospital.code, (email, fullName, role) => mkUser(email, fullName, role));

    // Phase 5: dispensed courses with medication reminder schedules and adherence history
    const phase5 = await seedPhase5(hid, hospital.code, hospital.numbering!.prescription!);

    return {
      ...phase2,
      ...phase3,
      ...phase4,
      ...phase5,
      hospital: hospital.name,
      users: await User.countDocuments({}),
      doctors: doctors.length,
      nurses: await Nurse.countDocuments({}),
      employees: await Employee.countDocuments({}),
      patients: patients.length,
      appointments: await Appointment.countDocuments({}),
      invoices: await Invoice.countDocuments({}),
      payments: await Payment.countDocuments({}),
    };
  });
}
