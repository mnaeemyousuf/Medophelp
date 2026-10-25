// Captures REAL screenshots of the running HMS (synthetic demo data) for the role user manuals.
// Prereqs: API on :4000, web on :5173, demo data seeded. Uses the locally installed Chrome/Edge.
// Usage: node capture.mjs [roleFilter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'deliverables/user_manuals/assets');
const BASE = process.env.HMS_URL ?? 'http://localhost:5173';
const BROWSERS = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
const envText = fs.readFileSync(path.join(root, 'server/.env'), 'utf8');
const PW = /^SEED_DEMO_PASSWORD=(.*)$/m.exec(envText)?.[1]?.trim(); // never printed or saved
if (!PW) throw new Error('SEED_DEMO_PASSWORD missing in server/.env');
fs.mkdirSync(OUT, { recursive: true });

const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const failures = [];
const only = process.argv[2];

const browser = await puppeteer.launch({ executablePath: BROWSERS.find((b) => fs.existsSync(b)), headless: true, args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.25 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(extra = 700) {
  try {
    await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 });
  } catch { /* long-polling queries keep the network busy; carry on */ }
  try {
    await page.waitForFunction(() => !document.querySelector('main .animate-spin'), { timeout: 10000 });
  } catch { /* ignore */ }
  await sleep(extra);
}
async function api(p, opts = {}) {
  return page.evaluate(async (p, opts) => {
    const r = await fetch(`/api${p}`, { method: opts.method ?? 'GET', headers: { 'X-Requested-With': 'hms', 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  }, p, opts);
}
async function login(email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  const status = await page.evaluate(async (email, pw) => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'hms' } });
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hms' }, body: JSON.stringify({ email, password: pw }) });
    return r.status;
  }, email, PW);
  if (status !== 204) throw new Error(`login ${email} -> ${status}`);
}
async function go(p, extra) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
  await settle(extra);
}
/** Clicks the first visible element whose text starts with `text` (case-insensitive). */
async function click(text, selector = 'button, a, [role=tab], summary, label') {
  const ok = await page.evaluate((text, selector) => {
    const t = text.toLowerCase();
    const el = [...document.querySelectorAll(selector)].find((e) => e.offsetParent !== null && (e.innerText || '').trim().toLowerCase().startsWith(t));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, text, selector);
  if (!ok) throw new Error(`button "${text}" not found`);
  await settle(500);
}
async function type(selector, value) {
  await page.waitForSelector(selector, { timeout: 5000 });
  await page.click(selector, { clickCount: 3 });
  await page.type(selector, value);
}
async function select(selector, valueOrText) {
  await page.evaluate((selector, v) => {
    const el = document.querySelector(selector);
    const opt = [...el.options].find((o) => o.value === v || o.text.startsWith(v)) ?? [...el.options].find((o) => o.value);
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, opt.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, valueOrText);
  await settle(300);
}
async function scrollTo(text) {
  await page.evaluate((text) => {
    const el = [...document.querySelectorAll('h1,h2,h3,p,span,div')].find((e) => e.childElementCount === 0 && e.textContent.trim().startsWith(text));
    el?.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -80);
  }, text);
  await sleep(400);
}
async function shot(file, title, role, { full = false } = {}) {
  await page.screenshot({ path: path.join(OUT, `${file}.png`), fullPage: full });
  manifest[file] = { title, role, file: `${file}.png`, capturedAt: new Date().toISOString() };
  console.log('  ✓', file);
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log('  ✗', name, '-', e.message);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────────
const scenarios = {
  async common() {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'hms' } }));
    await go('/login');
    await step('login', async () => { await type('input[type=email]', 'reception@hospital.com'); await shot('login', 'Login screen', 'all'); });
    await step('login-error', async () => {
      await type('input[type=password]', 'wrong-password');
      await page.click('button[type=submit]');
      await settle(800);
      await shot('login-error', 'Login with an incorrect password', 'all');
    });
    await step('forgot', async () => { await go('/forgot-password'); await shot('forgot-password', 'Forgot password screen', 'all'); });
    await step('change-password', async () => { await login('nurse@hospital.com'); await go('/account/password'); await shot('change-password', 'Change password screen', 'all'); });
    await step('me', async () => {
      await go('/me');
      await shot('my-workspace', 'My workspace — clock in/out and attendance calendar', 'staff', { full: true });
      await click('Leave');
      await shot('my-workspace-leave', 'My workspace — leave balances and requests', 'staff');
      await click('Apply for leave');
      await shot('my-workspace-apply-leave', 'Apply for leave dialog', 'staff');
      await page.keyboard.press('Escape');
      await click('Payslips');
      await shot('my-workspace-payslips', 'My workspace — payslips', 'staff');
    });
    await step('notifications', async () => { await go('/notifications'); await shot('notifications', 'Notification history', 'all'); });
  },

  async superadmin() {
    await login('superadmin@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('superadmin-dashboard', 'Executive dashboard (Super Admin)', 'superadmin', { full: true }); });
    await step('users', async () => { await go('/admin/users'); await shot('admin-users', 'User management', 'superadmin'); });
    await step('user-new', async () => { await click('New user'); await shot('admin-user-create', 'Create user drawer', 'superadmin'); await page.keyboard.press('Escape'); });
    await step('roles', async () => { await go('/admin/roles'); await shot('admin-roles', 'Roles & permissions matrix', 'superadmin'); });
    await step('settings', async () => { await go('/admin/settings'); await shot('admin-settings', 'Hospital settings — hospital information and numbering', 'superadmin'); });
    await step('settings-catalog', async () => { await scrollTo('Appointment types'); await shot('admin-settings-catalog', 'Hospital settings — appointment types, payment methods, medicine categories', 'superadmin'); });
    await step('settings-delivery', async () => { await scrollTo('Message delivery providers'); await shot('admin-settings-delivery', 'Hospital settings — message delivery providers and channels', 'superadmin'); });
    await step('audit', async () => { await go('/audit'); await shot('admin-audit', 'Audit log', 'superadmin'); });
    await step('audit-detail', async () => {
      await page.evaluate(() => document.querySelector('main tbody tr')?.click());
      await settle(500);
      await shot('admin-audit-detail', 'Audit entry with old and new values', 'superadmin');
      await page.keyboard.press('Escape');
    });
    await step('search', async () => {
      await go('/dashboard', 1200);
      const sel = 'header input';
      await page.click(sel);
      await page.type(sel, 'Ayesha');
      await settle(900);
      await shot('global-search', 'Global search results', 'superadmin');
      await page.keyboard.press('Escape');
    });
  },

  async admin() {
    await login('admin@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('admin-dashboard', 'Hospital overview dashboard', 'admin', { full: true }); });
    await step('departments', async () => { await go('/admin/departments'); await shot('admin-departments', 'Departments & services', 'admin'); });
    await step('services', async () => { await click('Services & prices'); await shot('admin-services', 'Services & prices', 'admin'); });
    await step('staff', async () => { await go('/admin/staff'); await shot('admin-staff', 'Doctors & nurses directory', 'admin'); });
    await step('reports', async () => { await go('/reports'); await shot('reports-catalogue', 'Report centre', 'admin'); });
    await step('report-run', async () => {
      await go('/reports?report=revenue-department');
      await select('main select', '90d');
      await click('Run report');
      await settle(1200);
      await shot('reports-revenue', 'Revenue by department report with chart and export buttons', 'admin', { full: true });
    });
    await step('report-attendance', async () => {
      await go('/reports?report=staff-attendance');
      await click('Run report');
      await settle(1200);
      await shot('reports-attendance', 'Staff attendance report', 'admin');
    });
  },

  async reception() {
    await login('reception@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('reception-dashboard', 'Front desk dashboard', 'reception'); });
    await step('patients', async () => { await go('/patients'); await shot('reception-patients', 'Patient search and list', 'reception'); });
    await step('register-empty', async () => {
      await go('/patients/new');
      await click('Register & generate MRN');
      await settle(500);
      await shot('reception-register-validation', 'Registration form showing validation messages', 'reception');
    });
    await step('register-filled', async () => {
      // Re-runs keep the screenshots from the first registration instead of creating a duplicate.
      const existing = (await api('/patients?search=35202-8812345-6&pageSize=1')).items?.length;
      if (existing && manifest['reception-register-result']) { console.log('  · register: synthetic patient already exists, keeping earlier screenshots'); return; }
      await go('/patients/new');
      await type('input[name=firstName]', 'Hina');
      await type('input[name=lastName]', 'Rashid');
      await type('input[name=guardianName]', 'Rashid Mehmood').catch(() => {});
      await type('input[name=cnic]', '35202-8812345-6');
      await type('input[name=dateOfBirth]', '04081992').catch(() => {});
      await page.evaluate(() => { const g = document.querySelector('select[name=gender]'); if (g) { const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(g, 'Female'); g.dispatchEvent(new Event('change', { bubbles: true })); } });
      await type('input[name=phone]', '+92 321 4567890');
      await type('input[name=city]', 'Lahore').catch(() => {});
      await shot('reception-register-form', 'Patient registration form (synthetic example)', 'reception', { full: true });
      await click('Register & generate MRN');
      await settle(1500);
      await shot('reception-register-result', 'Newly registered patient profile with generated MRN', 'reception', { full: true });
    });
    await step('book', async () => {
      const p = (await api('/patients?search=Hina%20Rashid&pageSize=1')).items?.[0];
      await go(`/appointments?book=1${p ? `&patientId=${p.id}` : ''}`);
      await shot('reception-book-appointment', 'Book appointment drawer', 'reception');
      await page.keyboard.press('Escape');
    });
    await step('appointments', async () => { await go('/appointments'); await shot('reception-appointments', 'Appointments list with check-in actions', 'reception'); });
    await step('appointments-day', async () => { await click('Day'); await shot('reception-appointments-day', 'Appointments — day calendar by doctor', 'reception'); });
    await step('appointments-week', async () => { await click('Week'); await shot('reception-appointments-week', 'Appointments — week view', 'reception'); });
    await step('profile', async () => {
      const p = (await api('/patients?pageSize=3')).items.find((x) => !x.isProvisional);
      await go(`/patients/${p.id}`);
      await shot('reception-patient-profile', 'Patient profile — overview, insurance, consent and portal access', 'reception', { full: true });
    });
    await step('er-board', async () => { await go('/emergency', 1200); await shot('reception-er-board', 'Emergency board', 'reception'); });
    await step('er-register', async () => { await click('Quick registration'); await shot('reception-er-quick-registration', 'Emergency quick registration', 'reception'); await page.keyboard.press('Escape'); });
    await step('ipd', async () => { await go('/ipd', 1200); await shot('reception-ipd-bed-board', 'Bed board (admissions)', 'reception', { full: true }); });
  },

  async nurse() {
    await login('nurse@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('nurse-dashboard', 'Nurse dashboard', 'nurse'); });
    await step('queue', async () => { await go('/nursing'); await shot('nurse-queue', 'Nursing assessment queue', 'nurse'); });
    await step('assess', async () => {
      const q = await api('/clinical/nursing/queue');
      const a = (Array.isArray(q) ? q : q.items ?? []).find((x) => ['CheckedIn', 'NurseAssessment'].includes(x.status));
      if (!a) throw new Error('nobody waiting for nursing');
      await go(`/nursing/assess/${a.id}`);
      await click('Start assessment').catch(() => {});
      await settle(600);
      const fill = async (name, v) => type(`input[name="vitals.${name}"]`, v).catch(() => {});
      await fill('systolicBp', '146'); await fill('diastolicBp', '92'); await fill('heartRate', '88'); await fill('temperatureC', '37.4');
      await fill('spo2', '97'); await fill('weightKg', '72'); await fill('heightCm', '165'); await fill('painScale', '3');
      await type('textarea[name=symptoms]', 'Headache and dizziness since morning').catch(() => {});
      await settle(400);
      await shot('nurse-assessment-form', 'Vital signs form with automatic BMI and abnormal value highlighting', 'nurse', { full: true });
    });
    await step('er-case', async () => {
      const b = await api('/emergency/board');
      const c = b.cases?.find((x) => !x.triageLevel) ?? b.cases?.[0];
      await go(`/emergency/${c._id}`);
      await shot('nurse-er-case', 'Emergency case — triage and treatment record', 'nurse', { full: true });
    });
    await step('ipd-admission', async () => {
      const list = await api('/ipd/admissions?status=Admitted&pageSize=1');
      const a = list.items?.[0];
      await go(`/ipd/admissions/${a._id}`);
      await shot('nurse-ipd-admission', 'Inpatient admission — ward notes and vitals', 'nurse', { full: true });
    });
  },

  async doctor() {
    await login('doctor@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('doctor-dashboard', 'Doctor dashboard — clinic, results to review, emergency alerts', 'doctor', { full: true }); });
    await step('queue', async () => { await go('/doctor'); await shot('doctor-queue', 'Consultation queue', 'doctor'); });
    await step('consult', async () => {
      const q = await api('/clinical/doctor/queue');
      const a = q.inConsultation?.[0] ?? q.waiting?.[0];
      if (!a) throw new Error('no patient ready');
      await go(`/doctor/consult/${a.id}`);
      await click('Start consultation').catch(() => {});
      await settle(800);
      await shot('doctor-consultation', 'Consultation workspace — vitals, note, diagnosis, plan, prescriptions, labs', 'doctor', { full: true });
      await click('New prescription').catch(() => {});
      await settle(500);
      await shot('doctor-prescription-builder', 'Prescription builder', 'doctor');
      await page.keyboard.press('Escape');
      await click('Order tests').catch(() => {});
      await settle(500);
      await shot('doctor-lab-order', 'Laboratory order dialog', 'doctor');
      await page.keyboard.press('Escape');
    });
    await step('emr', async () => {
      const q = await api('/clinical/doctor/queue');
      const a = q.completed?.[0] ?? q.inConsultation?.[0] ?? q.waiting?.[0];
      await go(`/patients/${a.patient.id}?tab=timeline`);
      await shot('doctor-emr-timeline', 'Patient EMR — chronological timeline', 'doctor', { full: true });
      await go(`/patients/${a.patient.id}?tab=vitals`);
      await shot('doctor-emr-vitals', 'Patient EMR — vital signs history and trend', 'doctor', { full: true });
      await go(`/patients/${a.patient.id}?tab=notes`);
      await shot('doctor-emr-notes', 'Patient EMR — clinical notes', 'doctor');
    });
    await step('lab-result', async () => {
      const o = (await api('/laboratory/orders?mine=true&statuses=Verified&pageSize=5')).items?.[0];
      await go(`/laboratory/orders/${o._id}`);
      await shot('doctor-lab-result', 'Verified laboratory result for review', 'doctor', { full: true });
    });
    await step('meds', async () => {
      const pts = await api('/patients?pageSize=50');
      for (const p of pts.items) {
        const s = await api(`/medications/patients/${p.id}`);
        if (Array.isArray(s) && s.length) { await go(`/patients/${p.id}?tab=medications`); await shot('doctor-patient-medications', 'Patient medications — adherence and schedules', 'doctor', { full: true }); return; }
      }
      throw new Error('no patient with schedules visible to doctor');
    });
  },

  async lab() {
    await login('lab@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('lab-dashboard', 'Laboratory dashboard', 'lab'); });
    await step('worklist', async () => { await go('/laboratory'); await shot('lab-worklist', 'Laboratory worklist', 'lab'); });
    await step('order-intake', async () => {
      const o = (await api('/laboratory/orders?statuses=Ordered,SamplePending&pageSize=5')).items?.[0];
      await go(`/laboratory/orders/${o._id}`);
      await shot('lab-order-intake', 'Lab order — receive request and collect sample', 'lab', { full: true });
    });
    await step('order-entry', async () => {
      const o = (await api('/laboratory/orders?statuses=InProgress&pageSize=5')).items?.[0];
      await go(`/laboratory/orders/${o._id}`);
      await shot('lab-result-entry', 'Result entry with reference ranges and automatic flags', 'lab', { full: true });
    });
    await step('tests', async () => { await go('/laboratory/tests'); await shot('lab-test-master', 'Lab test master', 'lab'); });
    await login('labsupervisor@hospital.com');
    await step('verify', async () => {
      const o = (await api('/laboratory/orders?statuses=Completed&pageSize=5')).items?.[0];
      await go(`/laboratory/orders/${o._id}`);
      await shot('lab-verify', 'Result verification by a second person', 'lab', { full: true });
    });
    await step('assign', async () => {
      const o = (await api('/laboratory/orders?statuses=Ordered,SamplePending,SampleCollected&pageSize=5')).items?.[0];
      await go(`/laboratory/orders/${o._id}`);
      await scrollTo('Technician assignment');
      await shot('lab-assign', 'Technician assignment and report upload', 'lab');
    });
  },

  async pharmacy() {
    await login('pharmacy@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('pharmacy-dashboard', 'Pharmacy dashboard', 'pharmacy', { full: true }); });
    await step('queue', async () => { await go('/pharmacy'); await shot('pharmacy-queue', 'Prescription queue', 'pharmacy'); });
    await step('dispense', async () => {
      const q = await api('/pharmacy/queue?pageSize=50');
      const r = q.items.find((x) => x.stockReady) ?? q.items[0];
      await go(`/pharmacy/dispense/${r._id}`);
      await shot('pharmacy-dispense', 'Dispensing screen — stock check, FEFO batches, allergies', 'pharmacy', { full: true });
    });
    await step('tabs', async () => {
      await go('/pharmacy');
      await click('Dispensing history').catch(() => click('History'));
      await shot('pharmacy-history', 'Dispensing history', 'pharmacy');
      await click('Controlled').catch(() => {});
      await shot('pharmacy-controlled', 'Controlled medicine register', 'pharmacy');
    });
    await step('pr', async () => {
      await go('/purchasing/requests');
      await click('New request');
      await shot('pharmacy-purchase-request', 'New purchase request', 'pharmacy');
      await page.keyboard.press('Escape');
    });
  },

  async inventory() {
    await login('inventory@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('inventory-dashboard', 'Stores dashboard', 'inventory', { full: true }); });
    await step('items', async () => { await go('/inventory'); await shot('inventory-items', 'Inventory items with stock levels', 'inventory'); });
    await step('item', async () => {
      const i = (await api('/inventory/items?search=Amoxicillin&pageSize=1')).items?.[0];
      await go(`/inventory/items/${i._id}`);
      await shot('inventory-item-detail', 'Item detail — batches, expiry and stock ledger', 'inventory', { full: true });
    });
    await step('alerts', async () => { await go('/inventory?tab=alerts'); await shot('inventory-alerts', 'Low-stock and expiry alerts', 'inventory', { full: true }); });
    await step('pos', async () => { await go('/purchasing'); await shot('procurement-orders', 'Purchase orders', 'inventory'); });
    await step('po', async () => {
      const po = (await api('/purchasing/orders?status=Ordered&pageSize=1')).items?.[0] ?? (await api('/purchasing/orders?pageSize=1')).items?.[0];
      await go(`/purchasing/orders/${po._id}`);
      await shot('procurement-po-detail', 'Purchase order detail', 'inventory', { full: true });
      await click('Receive goods').catch(() => {});
      await settle(500);
      await shot('procurement-goods-receipt', 'Goods receipt dialog (batch number and expiry per line)', 'inventory');
      await page.keyboard.press('Escape');
    });
    await step('suppliers', async () => { await go('/purchasing'); await click('Suppliers'); await shot('procurement-suppliers', 'Suppliers', 'inventory'); });
    await step('prs', async () => { await go('/purchasing/requests'); await shot('procurement-requests', 'Purchase requests awaiting approval', 'inventory'); });
  },

  async accounts() {
    await login('accounts@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('accounts-dashboard', 'Financial dashboard', 'accounts', { full: true }); });
    await step('invoices', async () => { await go('/billing'); await shot('accounts-invoices', 'Invoices with outstanding balances', 'accounts'); });
    await step('invoice', async () => {
      const inv = (await api('/billing/invoices?status=Issued&pageSize=1')).items?.[0] ?? (await api('/billing/invoices?pageSize=1')).items?.[0];
      await go(`/billing/invoices/${inv._id}`);
      await shot('accounts-invoice-detail', 'Invoice detail', 'accounts', { full: true });
      await click('Record payment');
      await shot('accounts-payment', 'Record payment dialog', 'accounts');
      await page.keyboard.press('Escape');
    });
    await step('paid', async () => {
      const inv = (await api('/billing/invoices?status=Paid&pageSize=1')).items?.[0] ?? (await api('/billing/invoices?status=PartiallyPaid&pageSize=1')).items?.[0];
      await go(`/billing/invoices/${inv._id}`);
      await shot('accounts-invoice-paid', 'Invoice with payments, receipts and refund action', 'accounts', { full: true });
      await click('Refund').catch(() => {});
      await settle(400);
      await shot('accounts-refund', 'Refund dialog', 'accounts');
      await page.keyboard.press('Escape');
    });
    await step('claims', async () => { await go('/insurance'); await shot('accounts-claims', 'Insurance claims', 'accounts'); });
    await step('claim', async () => {
      const c = (await api('/insurance/claims?pageSize=1')).items?.[0];
      await go(`/insurance/claims/${c._id}`);
      await shot('accounts-claim-detail', 'Insurance claim detail', 'accounts', { full: true });
    });
    await step('outstanding', async () => {
      await go('/reports?report=outstanding');
      await select('main select', '90d');
      await click('Run report');
      await settle(1000);
      await shot('accounts-report-outstanding', 'Outstanding balances report', 'accounts');
    });
  },

  async hr() {
    await login('hr@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('hr-dashboard', 'HR dashboard', 'hr', { full: true }); });
    await step('employees', async () => { await go('/hr?tab=employees'); await shot('hr-employees', 'Employee directory', 'hr'); });
    await step('employee', async () => {
      const e = (await api('/hr/employees?search=Akhtar&pageSize=1')).items?.[0];
      await go(`/hr/employees/${e._id}`);
      await shot('hr-employee-profile', 'Employee profile', 'hr');
      await click('Contracts', 'main button'); await shot('hr-employee-contracts', 'Employee contracts', 'hr');
      await click('Leave', 'main button'); await shot('hr-employee-leave', 'Employee leave balances and history', 'hr');
      await click('Performance', 'main button'); await shot('hr-employee-performance', 'Performance reviews', 'hr');
    });
    await step('attendance', async () => { await go('/hr?tab=attendance'); await shot('hr-attendance-day', 'Daily attendance register', 'hr'); });
    await step('summary', async () => { await go('/hr?tab=summary'); await shot('hr-attendance-summary', 'Monthly attendance summary', 'hr'); });
    await step('leave', async () => { await go('/hr/leave'); await shot('hr-leave-approvals', 'Leave approvals', 'hr'); });
    await step('payroll-approve', async () => {
      await go('/payroll');
      await shot('hr-payroll', 'Payroll runs (approver view)', 'hr');
    });
  },

  async payroll() {
    await login('payroll@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('payroll-dashboard', 'Payroll dashboard', 'payroll'); });
    await step('new-run', async () => { await click('New payroll run'); await shot('payroll-new-run', 'Prepare a new payroll run', 'payroll'); await page.keyboard.press('Escape'); });
    await step('run', async () => {
      const r = (await api('/payroll/runs'))[0];
      await go(`/payroll/runs/${r._id}`);
      await shot('payroll-run-detail', 'Payroll run detail with department totals and payslips', 'payroll', { full: true });
      await page.evaluate(() => document.querySelectorAll('main tbody')[1]?.querySelector('tr')?.click());
      await settle(500);
      await shot('payroll-item', 'Employee pay breakdown', 'payroll');
      await page.keyboard.press('Escape');
    });
    await step('salary', async () => {
      const e = (await api('/hr/employees?search=Sheikh&pageSize=1')).items?.[0];
      await go(`/hr/employees/${e._id}`);
      await click('Salary');
      await shot('payroll-salary-structure', 'Salary structure history', 'payroll');
      await click('Change salary').catch(() => {});
      await settle(400);
      await shot('payroll-salary-editor', 'Change salary drawer', 'payroll');
      await page.keyboard.press('Escape');
    });
  },

  async recruitment() {
    await login('recruitment@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1200); await shot('recruitment-overview', 'Recruitment overview', 'recruitment'); });
    await step('jobs', async () => { await go('/recruitment?tab=jobs'); await shot('recruitment-jobs', 'Job openings', 'recruitment'); });
    await step('job-new', async () => { await click('New opening'); await shot('recruitment-job-form', 'New job opening form', 'recruitment'); await page.keyboard.press('Escape'); });
    await step('candidates', async () => { await go('/recruitment?tab=candidates'); await shot('recruitment-candidates', 'Candidate pipeline', 'recruitment'); });
    await step('candidate', async () => {
      const list = (await api('/recruitment/candidates?pageSize=20')).items;
      const c = list.find((x) => x.stage === 'Offer') ?? list.find((x) => x.stage === 'Interview') ?? list[0];
      await go(`/recruitment/candidates/${c._id}`);
      await shot('recruitment-candidate', 'Candidate profile — interviews, evaluations and offers', 'recruitment', { full: true });
      const sel = list.find((x) => x.stage === 'Shortlisted');
      if (sel) { await go(`/recruitment/candidates/${sel._id}`); await click('Schedule interview'); await shot('recruitment-schedule-interview', 'Schedule interview dialog', 'recruitment'); await page.keyboard.press('Escape'); }
    });
  },

  async patient() {
    await login('patient@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('patient-dashboard', 'Patient portal home', 'patient', { full: true }); });
    await step('appts', async () => { await go('/portal/appointments'); await shot('patient-appointments', 'My appointments', 'patient'); });
    await step('book', async () => { await go('/portal/appointments?book=1'); await shot('patient-book', 'Book an appointment', 'patient'); await page.keyboard.press('Escape'); });
    await step('records', async () => { await go('/portal/records'); await shot('patient-records', 'My records — timeline', 'patient', { full: true }); });
    await step('rx', async () => { await go('/portal/records?tab=prescriptions'); await shot('patient-prescriptions', 'My prescriptions', 'patient'); });
    await step('lab', async () => { await go('/portal/records?tab=lab'); await shot('patient-lab-results', 'My lab results', 'patient'); });
    await step('bills', async () => { await go('/portal/bills'); await shot('patient-bills', 'My bills', 'patient'); });
    await step('meds', async () => { await go('/portal/medications'); await shot('patient-medicines', 'My medicines — today’s doses and adherence', 'patient', { full: true }); });
    await step('mobile', async () => {
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      await go('/portal/medications', 1000);
      await shot('patient-mobile-medicines', 'My medicines on a phone', 'patient');
      await go('/dashboard', 1000);
      await shot('patient-mobile-home', 'Patient portal home on a phone', 'patient');
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.25 });
    });
  },

  async management() {
    await login('management@hospital.com');
    await step('dash', async () => { await go('/dashboard', 1500); await shot('management-dashboard', 'Management dashboard', 'management', { full: true }); });
    await step('reports', async () => {
      await go('/reports?report=patient-inflow');
      await select('main select', '90d');
      await click('Run report');
      await settle(1200);
      await shot('management-report-inflow', 'Patient inflow report', 'management', { full: true });
    });
  },
};

for (const [name, fn] of Object.entries(scenarios)) {
  if (only && only !== name) continue;
  console.log(`▶ ${name}`);
  await fn();
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`\nCaptured ${Object.keys(manifest).length} screenshots. Failures: ${failures.length}`);
for (const f of failures) console.log('  -', f);
