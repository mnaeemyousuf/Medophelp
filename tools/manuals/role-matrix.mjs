// Generates docs/role_permission_matrix.md from build/roles.json (exported from the source code)
// plus the descriptive data in content/roles.mjs. Run after export-roles.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES } from './content/roles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const data = JSON.parse(fs.readFileSync(path.join(here, 'build/roles.json'), 'utf8'));

const EXTRA = {
  'Super Admin': { approvals: 'Can act as second approver for purchase requests/POs, payroll, offers and lab verification (two-person rules still apply: never their own item).', sensitive: 'All patient demographics and clinical records (emr.view_all, clinical notes), payroll and salary data, audit log.', notifications: 'Purchase approvals, low-stock/expiry alerts, emergency critical alerts (as staff with the relevant permissions).' },
  'Hospital Admin': { approvals: 'Same as Super Admin for operational approvals.', sensitive: 'Patient demographics, billing, HR and payroll data, audit log. Not other doctors’ clinical notes or all-patient EMR.', notifications: 'Purchase approvals, stock alerts.' },
  Receptionist: { approvals: 'None.', sensitive: 'Patient demographics, CNIC, contact details, insurance, invoices (read). No vitals or clinical notes.', notifications: 'Leave decisions (own).' },
  Nurse: { approvals: 'Team leave approval only if set as reporting manager (head nurse).', sensitive: 'Clinical data of patients under care: vitals, prescriptions, lab results.', notifications: 'Emergency alerts, missed-dose alerts for inpatients, leave decisions.' },
  Doctor: { approvals: 'Discharge of own inpatients; review of verified lab results.', sensitive: 'Full EMR of patients under their care, clinical notes.', notifications: 'Patient ready (after nursing), lab result available / critical, emergency alerts, missed-dose alerts, leave decisions.' },
  'Lab Technician': { approvals: 'Verifies results entered by another technician (lab.verify).', sensitive: 'Patient identity and lab results.', notifications: 'Test assigned, urgent/STAT orders.' },
  Pharmacist: { approvals: 'None (purchase requests are approved by someone else).', sensitive: 'Prescriptions, allergies, controlled medicine register.', notifications: 'New prescription available, stock alerts.' },
  'Inventory Manager': { approvals: 'Approves purchase requests and POs raised by others.', sensitive: 'Supplier prices and purchase data.', notifications: 'Purchase requests submitted, low stock and expiry alerts.' },
  Accountant: { approvals: 'Refunds; insurance claim decisions recording.', sensitive: 'Invoices, payments, patient contact and insurance policy data.', notifications: 'Payment-related events.' },
  'HR Manager': { approvals: 'Leave (HR step), payroll runs prepared by others, offers drafted by others, hiring.', sensitive: 'Employee personal data, contracts, performance reviews, payroll totals.', notifications: 'Leave requests, payroll submitted for approval, recruitment updates.' },
  'Payroll Officer': { approvals: 'None — cannot approve own runs.', sensitive: 'Salary structures, employee bank details, payslips.', notifications: 'Payroll approved/processed.' },
  'Recruitment Officer': { approvals: 'None — offers are approved by HR.', sensitive: 'Candidate CVs and contact details.', notifications: 'Recruitment updates.' },
  Patient: { approvals: 'None.', sensitive: 'Only own records.', notifications: 'Appointment confirmation and reminders, medicine reminders, refill/follow-up reminders, lab result available (after verification), payment due/received, payment reminders. External channels (SMS/email) only when configured and not opted out.' },
  Management: { approvals: 'None (read-only).', sensitive: 'Aggregated clinical, financial and HR report data (reports can include names).', notifications: 'None specific.' },
};

const lines = [];
lines.push('# Role & Permission Matrix', '');
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from \`shared/src/permissions.ts\` (default role permissions) and \`client/src/app/nav.ts\` (menus) by \`tools/manuals/role-matrix.mjs\`. Administrators can change role permissions at runtime; this file documents the seeded defaults. Every permission is enforced by the API (\`requirePermission\` on each route) — hiding menus is only a convenience.`, '');
lines.push('## Roles in the system', '', 'The application has exactly the 14 roles required by the specification (§3). There are no separate HR Executive, Procurement Officer or Lab Manager roles; those responsibilities are combined as shown below. Every staff role also has `self.service` (My workspace).', '');
lines.push('| # | Role | Demo account | Manual | Combined responsibilities |', '|---|---|---|---|---|');
for (const r of ROLES) lines.push(`| ${r.n} | ${r.role} | ${r.account} | \`deliverables/user_manuals/${r.file}.pdf\` | ${r.combined ? r.combined.replace(/\|/g, '/') : '—'} |`);
lines.push('');

// Permission × role grid
const roles = data.roles.map((r) => r.role);
const abbrev = { 'Super Admin': 'SA', 'Hospital Admin': 'HA', Receptionist: 'REC', Nurse: 'NUR', Doctor: 'DOC', 'Lab Technician': 'LAB', Pharmacist: 'PHA', 'Inventory Manager': 'INV', Accountant: 'ACC', 'HR Manager': 'HR', 'Payroll Officer': 'PAY', 'Recruitment Officer': 'RCT', Patient: 'PAT', Management: 'MGT' };
lines.push('## Permission grid', '', `Legend: ${roles.map((r) => `${abbrev[r]} = ${r}`).join(', ')}.`, '');
lines.push(`| Module | Permission | ${roles.map((r) => abbrev[r]).join(' | ')} |`, `|---|---|${roles.map(() => ':-:').join('|')}|`);
for (const [key, p] of Object.entries(data.allPermissions)) {
  lines.push(`| ${p.module} | \`${key}\` — ${p.description} | ${data.roles.map((r) => (r.permissions.some((x) => x.key === key) ? '✔' : '')).join(' | ')} |`);
}
lines.push('');

lines.push('## Per-role detail', '');
for (const r of ROLES) {
  const d = data.roles.find((x) => x.role === r.role);
  const e = EXTRA[r.role];
  lines.push(`### ${r.n}. ${r.role}`, '');
  lines.push(`* **Dashboard:** ${r.dashboard[1]}`);
  lines.push(`* **Menus / screens:** ${d.menus.map((m) => `${m.section}: ${m.items.map((i) => `${i.label} (\`${i.to}\`)`).join(', ')}`).join('; ')}`);
  lines.push(`* **Modules (by permission):** ${[...new Set(d.permissions.map((p) => p.module))].join(', ')}`);
  lines.push(`* **Permitted actions:** ${d.permissions.map((p) => p.description).join('; ')}.`);
  lines.push(`* **Restricted actions:** ${r.restrictions ?? 'Everything not listed above is refused by the API with 403.'}`);
  lines.push(`* **Approvals:** ${e.approvals}`);
  lines.push(`* **Reports:** ${d.reports.length ? d.reports.map((x) => x.title).join(', ') : 'None'}`);
  lines.push(`* **Sensitive data access:** ${e.sensitive}`);
  lines.push(`* **Notifications received:** ${e.notifications}`);
  lines.push('');
}
lines.push('## Segregation-of-duties rules enforced by the server', '');
for (const s of [
  'Lab results: “Results must be verified by someone other than the technician who entered them”.',
  'Purchase requests: “A request must be approved by someone other than the requester”.',
  'Purchase orders: “You cannot approve a purchase order you raised”.',
  'Payroll: “Payroll must be approved by someone other than the preparer”.',
  'Recruitment offers: “Offers must be approved by someone other than the person who drafted them”.',
  'Leave: “You cannot approve your own leave”; the reporting manager decides before HR.',
  'Prescriptions: “Only the prescribing doctor can cancel this prescription”.',
  'Clinical notes: only the visit’s doctor can write; closed visits are read-only; amendments keep the earlier version with a reason.',
  'Refunds: only roles with `refunds.process` (Accountant, admins) — receptionists are refused (tested in `tests/e2e.workflow.test.ts`).',
]) lines.push(`* ${s}`);
lines.push('', 'Role restrictions verified by automated tests: see `docs/qa_and_test_report.md` (role-restriction section).');
fs.writeFileSync(path.join(root, 'docs/role_permission_matrix.md'), lines.join('\n') + '\n');
console.log('wrote docs/role_permission_matrix.md');
