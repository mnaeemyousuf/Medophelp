import type { Types } from 'mongoose';
import { ALL_PERMISSIONS, datesBetween, evaluateDay, isoWeekday, periodRange, toMin } from '@hms/shared';
import { runWithContext } from '../core/context';
import { ensureCounterAtLeast, formatNumber } from '../core/numbering/numbering';
import { todayString } from '../core/http';
import { Department } from '../modules/organization/organization.models';
import { User } from '../modules/identity/identity.models';
import { Employee } from '../modules/staff/staff.models';
import { Attendance, Contract, PerformanceReview } from '../modules/hr/hr.models';
import { hrDecision, managerDecision, requestLeave } from '../modules/hr/hr.service';
import { SalaryStructure } from '../modules/payroll/payroll.models';
import { actOnRun, createRun } from '../modules/payroll/payroll.service';
import { Candidate, Interview, JobPosting } from '../modules/recruitment/recruitment.models';
import { actOnOffer, addCandidate, createOffer, evaluateInterview, saveJob, scheduleInterview, setStage } from '../modules/recruitment/recruitment.service';

// Deterministic pseudo-random so the dataset is stable between runs.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** Pay grade by designation keyword: [basic, tax %]. */
function grade(designation: string): [number, number] {
  const d = designation.toLowerCase();
  if (/cardiolog|surgeon|gynecolog/.test(d)) return [380000, 15];
  if (/physician|pediatric|ent|dermatolog|internal|emergency/.test(d)) return [300000, 12.5];
  if (/hr manager|manager/.test(d)) return [180000, 10];
  if (/pharmacist/.test(d)) return [95000, 5];
  if (/nurse/.test(d)) return [80000, 2.5];
  if (/lab/.test(d)) return [75000, 2.5];
  return [70000, 2.5];
}

/** The first working day (not Sunday) at least days days from today, as YYYY-MM-DD. */
function workdayFromNow(days: number) {
  let t = Date.now() + days * 86_400_000;
  while (isoWeekday(new Date(t).toISOString().slice(0, 10)) === 7) t += 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export async function seedPhase4(hid: Types.ObjectId, hospitalCode: string, mkUser: (email: string, fullName: string, role: string) => Promise<{ _id: Types.ObjectId; fullName: string }>) {
  const depts = await Department.find({ hospitalId: hid }).lean();
  const dept = (code: string) => depts.find((d) => d.code === code)!._id;
  let empSeq = await Employee.countDocuments({ hospitalId: hid });
  const nextEmpNo = () => formatNumber('EMP-{n:5}', { code: hospitalCode, year: 2026, seq: ++empSeq });

  // Employee records for office staff who already have (or now get) user accounts.
  const office: Array<[string, string, string, string, string, 'Female' | 'Male', string | null]> = [
    ['hr@hospital.com', 'Amna', 'Sheikh', 'HR', 'HR Manager', 'Female', null],
    ['reception@hospital.com', 'Rabia', 'Chaudhry', 'ADMIN', 'Front Desk Officer', 'Female', 'hr@hospital.com'],
    ['accounts@hospital.com', 'Saad', 'Mirza', 'ACC', 'Accounts Officer', 'Male', 'hr@hospital.com'],
    ['payroll@hospital.com', 'Nadeem', 'Akhtar', 'ACC', 'Payroll Officer', 'Male', 'hr@hospital.com'],
    ['recruitment@hospital.com', 'Sara', 'Javed', 'HR', 'Recruitment Officer', 'Female', 'hr@hospital.com'],
  ];
  if (!(await User.exists({ email: 'payroll@hospital.com' }))) await mkUser('payroll@hospital.com', 'Nadeem Akhtar', 'Payroll Officer');
  if (!(await User.exists({ email: 'recruitment@hospital.com' }))) await mkUser('recruitment@hospital.com', 'Sara Javed', 'Recruitment Officer');
  const empByEmail = new Map<string, Types.ObjectId>();
  for (const [email, first, last, d, designation, gender] of office) {
    const user = await User.findOne({ email }).lean();
    const e = await Employee.create({ hospitalId: hid, employeeNo: nextEmpNo(), firstName: first, lastName: last, gender, departmentId: dept(d), designation, joiningDate: new Date(Date.now() - (400 + Math.floor(rnd() * 900)) * 86_400_000), employmentType: 'FullTime', userId: user?._id, phone: `+92 300 ${1000000 + Math.floor(rnd() * 8999999)}` });
    empByEmail.set(email, e._id);
  }
  await ensureCounterAtLeast('employee', 'EMP-{n:5}', hid, empSeq); // later hires continue the sequence
  for (const [email, , , , , , mgr] of office) if (mgr) await Employee.updateOne({ _id: empByEmail.get(email) }, { reportingManagerId: empByEmail.get(mgr) });

  // Reporting lines: nurses report to the head nurse (nurse@), other clinical staff to HR for leave.
  const nurseUser = await User.findOne({ email: 'nurse@hospital.com' }).lean();
  const headNurse = await Employee.findOne({ hospitalId: hid, userId: nurseUser!._id }).lean();
  await Employee.updateMany({ hospitalId: hid, designation: 'Staff Nurse', _id: { $ne: headNurse!._id } }, { reportingManagerId: headNurse!._id });
  await Employee.updateOne({ _id: headNurse!._id }, { designation: 'Head Nurse', reportingManagerId: empByEmail.get('hr@hospital.com') });

  // Contracts and salary structures for everyone
  const employees = await Employee.find({ hospitalId: hid, isActive: true }).lean();
  let contractSeq = 0;
  for (const e of employees) {
    const [basic, tax] = grade(e.designation);
    const start = e.joiningDate;
    await Contract.create({ hospitalId: hid, employeeId: e._id, contractNo: formatNumber('CON-{yyyy}-{n:5}', { code: hospitalCode, year: start.getFullYear(), seq: ++contractSeq }), type: e.employmentType, startDate: start, basicSalary: basic, terms: 'Standard terms of employment as per hospital HR policy.' });
    await SalaryStructure.create({
      hospitalId: hid,
      employeeId: e._id,
      effectiveFrom: start,
      basic,
      allowances: [
        { name: 'House rent', amount: Math.round(basic * 0.45) },
        { name: 'Medical', amount: Math.round(basic * 0.1) },
        { name: 'Conveyance', amount: 5000 },
      ],
      deductions: [
        { name: 'Provident fund', amount: Math.round(basic * 0.05) },
        { name: 'EOBI', amount: 370 },
      ],
      taxPercent: tax,
      bankName: ['HBL', 'Meezan Bank', 'UBL', 'MCB'][Math.floor(rnd() * 4)],
      bankAccount: `PK${10 + Math.floor(rnd() * 89)}XXXX${Math.floor(1000 + rnd() * 8999)}`,
    });
  }
  await ensureCounterAtLeast('contract', 'CON-{yyyy}-{n:5}', hid, contractSeq);

  // Context helper: act as a given user/employee through the real services.
  const as = async <T>(email: string, fn: () => Promise<T>) => {
    const user = await User.findOne({ email }).lean();
    const emp = await Employee.findOne({ hospitalId: hid, userId: user!._id }).lean();
    return runWithContext({ hospitalId: hid, userId: user!._id, userName: user!.fullName, roles: ['Seed'], permissions: new Set(ALL_PERMISSIONS.filter((p) => p !== 'portal.self')), employeeId: emp?._id }, fn);
  };

  // Leave: an approved sick leave last month (nurse via head nurse + HR), pending requests for the demo.
  const today = todayString();
  const prev = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7);
  const { from: pFrom } = periodRange(prev);
  const otherNurse = await Employee.findOne({ hospitalId: hid, reportingManagerId: headNurse!._id, userId: { $ne: null } }).lean();
  const nurseEmail = otherNurse ? (await User.findById(otherNurse.userId).lean())!.email : null;
  if (nurseEmail) {
    const lr = await as(nurseEmail, () => requestLeave({ type: 'Sick', from: `${prev}-10`, to: `${prev}-11`, halfDay: false, reason: 'Viral fever (medical certificate attached)' }));
    await as('nurse@hospital.com', () => managerDecision(lr._id.toString(), true, 'Get well soon'));
    await as('hr@hospital.com', () => hrDecision(lr._id.toString(), true));
    const future = workdayFromNow(10);
    const future2 = workdayFromNow(12);
    await as(nurseEmail, () => requestLeave({ type: 'Annual', from: future, to: future2, halfDay: false, reason: 'Family wedding' }));
  }
  const future3 = workdayFromNow(20);
  const lr2 = await as('reception@hospital.com', () => requestLeave({ type: 'Casual', from: future3, to: future3, halfDay: false, reason: 'Personal errand' }));
  await as('hr@hospital.com', () => managerDecision(lr2._id.toString(), true));

  // Attendance from the start of last month to yesterday; skips weekly off and existing (leave) rows.
  const start = toMin('09:00');
  const rows: Array<Record<string, unknown>> = [];
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const existing = new Set((await Attendance.find({ hospitalId: hid }).select('employeeId date').lean()).map((a) => `${a.employeeId}|${a.date}`));
  for (const date of datesBetween(pFrom, yesterday)) {
    if (isoWeekday(date) === 7) continue;
    for (const e of employees) {
      if (e.joiningDate.toISOString().slice(0, 10) > date || existing.has(`${e._id}|${date}`)) continue;
      const r = rnd();
      if (r < 0.03) {
        rows.push({ hospitalId: hid, employeeId: e._id, departmentId: e.departmentId, date, status: 'Absent', source: 'System' });
        continue;
      }
      const inMin = start - 15 + Math.floor(rnd() * 25) + (r > 0.9 ? 15 + Math.floor(rnd() * 40) : 0); // ~10% late
      const outMin = toMin('17:00') + Math.floor(rnd() * 20) - 5 + (r > 0.8 && r < 0.88 ? 60 + Math.floor(rnd() * 120) : 0); // some overtime
      const day = evaluateDay(inMin, outMin, { workStart: '09:00', workEnd: '17:00', graceMinutes: 10, halfDayMinutes: 240 });
      rows.push({ hospitalId: hid, employeeId: e._id, departmentId: e.departmentId, date, clockIn: new Date(`${date}T${hhmm(inMin)}:00`), clockOut: new Date(`${date}T${hhmm(outMin)}:00`), source: 'Self', ...day });
    }
  }
  if (rows.length) await Attendance.insertMany(rows, { ordered: false });

  // Last month's payroll: prepared by the payroll officer, approved by HR, processed (payslips).
  const run = await as('payroll@hospital.com', () => createRun(prev));
  await as('payroll@hospital.com', () => actOnRun(run._id.toString(), 'submit'));
  await as('hr@hospital.com', () => actOnRun(run._id.toString(), 'approve', 'Checked against attendance'));
  await as('payroll@hospital.com', () => actOnRun(run._id.toString(), 'process'));

  // Performance reviews
  for (const e of employees.slice(0, 3)) {
    await PerformanceReview.create({ hospitalId: hid, employeeId: e._id, period: `${new Date().getFullYear()} H1`, rating: 3 + Math.floor(rnd() * 3), goals: 'Maintain patient satisfaction; complete mandatory CME hours.', strengths: 'Reliable, good teamwork', improvements: 'Documentation timeliness', reviewerName: 'Amna Sheikh', status: 'Submitted', submittedAt: new Date() });
  }

  // Recruitment: jobs, candidates across the pipeline, interviews, an offer out
  const jobs = await as('recruitment@hospital.com', async () => [
    await saveJob({ title: 'Staff Nurse (ICU)', departmentId: dept('ER').toString(), employmentType: 'FullTime', openings: 3, description: 'Provide critical care nursing in a 6-bed ICU. Rotating shifts.', requirements: 'BSc Nursing, PNC registration, 2+ years ICU experience, BLS/ACLS.', salaryMin: 80000, salaryMax: 110000, status: 'Open' }),
    await saveJob({ title: 'Medical Lab Technologist', departmentId: dept('LAB').toString(), employmentType: 'FullTime', openings: 1, description: 'Haematology and biochemistry bench work, QC and analyser maintenance.', requirements: 'BS MLT, 1+ year hospital lab experience.', salaryMin: 70000, salaryMax: 90000, status: 'Open' }),
    await saveJob({ title: 'Accounts Officer', departmentId: dept('ACC').toString(), employmentType: 'FullTime', openings: 1, description: 'Patient billing reconciliation and insurance claim follow-up.', requirements: 'B.Com/BBA, 2 years healthcare billing preferred.', salaryMin: 65000, salaryMax: 85000, status: 'Draft' }),
  ]);
  const people: Array<[number, string, string, 'Female' | 'Male', string]> = [
    [0, 'Huma', 'Saleem', 'Female', 'Shortlisted'],
    [0, 'Farah', 'Naz', 'Female', 'Interview'],
    [0, 'Asif', 'Mehmood', 'Male', 'Applied'],
    [0, 'Sadaf', 'Iqbal', 'Female', 'Selected'],
    [0, 'Waqas', 'Ali', 'Male', 'Rejected'],
    [1, 'Kamran', 'Shah', 'Male', 'Interview'],
    [1, 'Mehwish', 'Riaz', 'Female', 'Applied'],
    [1, 'Junaid', 'Akram', 'Male', 'Selected'],
  ];
  let i = 0;
  for (const [j, first, last, gender, stage] of people) {
    i++;
    await as('recruitment@hospital.com', async () => {
      const c = await addCandidate({ jobId: jobs[j]._id.toString(), firstName: first, lastName: last, gender, email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`, phone: `+92 333 ${1000000 + i * 1311}`, source: i % 2 ? 'Website' : 'Referral', experienceYears: 1 + (i % 6), expectedSalary: 85000 + i * 2000 });
      const id = c._id.toString();
      if (stage === 'Applied') return;
      if (stage === 'Rejected') return void (await setStage(id, 'Rejected', 'Does not meet ICU experience requirement'));
      await setStage(id, 'Shortlisted');
      if (stage === 'Shortlisted') return;
      const iv = await scheduleInterview({ candidateId: id, scheduledAt: new Date(Date.now() + (stage === 'Interview' ? 2 : 1) * 86_400_000).toISOString(), durationMinutes: 45, mode: 'In person', location: 'HR meeting room', panel: ['Amna Sheikh', 'Dr. Ayesha Khan'] });
      if (stage === 'Interview') return;
      // completed interviews happened a few days ago (scheduling in the past is not allowed, so back-date)
      await Interview.updateOne({ _id: iv._id }, { scheduledAt: new Date(Date.now() - 3 * 86_400_000) });
      await evaluateInterview(iv._id.toString(), { technical: 4, communication: 4, experience: 3, attitude: 5, recommendation: 'Hire', comments: 'Strong clinical knowledge, calm under pressure.' });
      await setStage(id, 'Selected', 'Panel recommends hire');
    });
  }
  // One offer drafted by the recruitment officer, approved by HR and sent
  const selected = await Candidate.findOne({ hospitalId: hid, firstName: 'Sadaf' }).lean();
  if (selected) {
    const offer = await as('recruitment@hospital.com', () => createOffer({ candidateId: selected._id.toString(), designation: 'Staff Nurse', departmentId: dept('ER').toString(), employmentType: 'FullTime', basicSalary: 85000, allowances: [{ name: 'House rent', amount: 38250 }, { name: 'ICU allowance', amount: 10000 }], joiningDate: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10), expiresOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), terms: 'Probation of three months. Rotating shifts including nights.' }));
    await as('recruitment@hospital.com', () => actOnOffer(offer._id.toString(), 'submit'));
    await as('hr@hospital.com', () => actOnOffer(offer._id.toString(), 'approve'));
    await as('recruitment@hospital.com', () => actOnOffer(offer._id.toString(), 'send'));
  }

  return { employees: employees.length, attendanceRecords: rows.length, payrollRuns: 1, jobs: await JobPosting.countDocuments({ hospitalId: hid }), candidates: people.length };
}
