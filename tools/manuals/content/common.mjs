// Content shared by every staff manual. Error messages quoted here are copied from the source code
// (server/src/**, shared/src/schemas/**). Guidance not verified against the running system is
// marked "unverified" in the troubleshooting tables.

export const PRODUCT = 'Medophelp';
export const TAGLINE = 'Smarter Healthcare. Seamless Operations.';
export const VERSION = '1.0.0 (MVP demonstration build)';

export const login = {
  name: 'Signing in',
  purpose: 'Open your personal, role-based workspace. Every account belongs to one person; never share it.',
  permission: 'Any active account.',
  prereq: 'An account created by an administrator (staff) or by the front desk (patient portal), and the web address of your hospital’s Medophelp site.',
  nav: 'Open your hospital’s Medophelp web address in a browser. The Sign in page opens automatically.',
  steps: [
    'Type your work email address in Email.',
    'Type your password in Password. Use the eye icon to check what you typed.',
    'Tick Remember me only on a personal device; it keeps you signed in for longer.',
    'Click Sign in. Your dashboard opens.',
  ],
  shot: ['login', 'The Sign in page'],
  fields: [
    ['Email', 'Your account email (not case-sensitive).'],
    ['Password', 'Your password. Required.'],
    ['Remember me', 'Optional. Keeps the session on this browser longer.'],
  ],
  example: 'Email: reception@hospital.com (demonstration account in a development environment).',
  result: 'The dashboard for your role opens and your name and role appear at the top right.',
  validation: ['Email must be a valid email address (“Enter a valid email”).', 'Password is required (“Password is required”).'],
  errors: [
    ['Invalid email or password', 'Wrong email or password, or the account is inactive. Check spelling and Caps Lock; ask an administrator if it persists.'],
    ['Account locked after repeated failed attempts. Try again in N minute(s).', 'Five wrong passwords lock the account for 15 minutes.'],
  ],
  warnings: ['Every sign-in, failed attempt and lockout is written to the audit log.'],
  next: ['If you were given a temporary password, you are taken to Change password first (see “First-time setup”).'],
  extraShots: [['login-error', 'Sign in rejected with “Invalid email or password”']],
};

export const firstTime = {
  name: 'First-time setup: change a temporary password',
  purpose: 'Accounts created by an administrator (or portal access created by the front desk) start with a temporary password that must be replaced before anything else can be used.',
  permission: 'Any account.',
  prereq: 'You signed in with a temporary password, or you want to change your password.',
  nav: 'Automatic after the first sign-in; otherwise click your name (top right) → Change password.',
  steps: [
    'Enter your Current password (the temporary one).',
    'Enter a New password that follows the policy shown below.',
    'Enter it again in Confirm password.',
    'Click the save button. You stay signed in with the new password.',
  ],
  shot: ['change-password', 'Change password'],
  fields: [
    ['Current password', 'The password you used to sign in.'],
    ['New password', 'At least 10 characters with an uppercase letter, a lowercase letter, a digit and a symbol.'],
    ['Confirm password', 'Must match the new password.'],
  ],
  example: 'New password: a long passphrase such as “Blue-Lantern-River-42” (example only — do not use it).',
  result: 'The password is changed and other sessions using the old password are signed out.',
  validation: ['At least 10 characters', 'Needs a lowercase letter / an uppercase letter / a digit / a symbol', 'Passwords do not match', 'New password must differ from current'],
  errors: [
    ['Current password is incorrect', 'Re-type the password you signed in with.'],
    ['Change your temporary password before continuing', 'Shown by the server if any other screen is used before the temporary password is changed.'],
  ],
  warnings: ['Until a temporary password is changed the server refuses every other request — this is enforced on the server, not only in the browser.'],
  next: ['Forgotten password: use “Forgot password?” on the Sign in page.'],
};

export const forgot = {
  name: 'Forgotten password',
  purpose: 'Request a password-reset link by email.',
  permission: 'Anyone with an account.',
  prereq: 'Email delivery must be configured by the hospital. In the demonstration build no email provider is configured, so reset emails are only logged by the server — ask an administrator to reset your password instead.',
  nav: 'Sign in page → Forgot password?',
  steps: ['Enter your account email.', 'Submit the form. The page always shows the same confirmation, whether or not the email exists (this protects account privacy).', 'Open the link in the email and choose a new password.'],
  shot: ['forgot-password', 'Forgot password'],
  fields: [['Email', 'The address you sign in with.']],
  example: 'nurse@hospital.com',
  result: 'If the address belongs to an account and email is configured, a single-use reset link is sent.',
  validation: ['Enter a valid email'],
  errors: [['This reset link is invalid or has expired', 'The link was already used or is too old. Request a new one.']],
  warnings: ['Unconfigured email is never reported as sent. Check Hospital settings → Message delivery providers (administrators).'],
  next: ['Sign in with the new password.'],
};

export const myWorkspace = {
  name: 'My workspace — attendance, leave and payslips',
  purpose: 'Personal self-service available to every staff member: clock in and out, see your attendance calendar, apply for leave, download your own payslips and read your performance reviews.',
  permission: 'self.service (all staff roles).',
  prereq: 'Your user account must be linked to an employee record by HR; otherwise the server answers “Your account is not linked to an employee record”.',
  nav: 'Sidebar → People → My workspace.',
  steps: [
    'Click Clock in when you start your shift; the button changes to Clock out.',
    'Open the Leave tab to see balances per leave type and your requests.',
    'Click Apply for leave, choose the type and dates, give a reason and submit. Your reporting manager (or HR) decides.',
    'Open Payslips to view or download payslips of approved payroll runs.',
    'Open Reviews to read and acknowledge performance reviews.',
  ],
  shot: ['my-workspace', 'My workspace — today’s clock-in status and the attendance calendar'],
  fields: [
    ['Leave type', 'Annual, Sick, Casual, Maternity, Unpaid or Other — balances come from HR policy.'],
    ['From / To', 'Dates of absence. Non-working days are not counted.'],
    ['Reason', 'Short explanation for the approver.'],
  ],
  example: 'Casual leave, 3–4 November, reason “Family event”.',
  result: 'A Pending request appears in the list and the approver is notified.',
  validation: [
    'Only sick leave can be applied for past dates',
    'The selected dates contain no working days',
    'You already have leave requested for some of these dates',
    'Split leave that crosses a year end into two requests',
  ],
  errors: [
    ['You are on approved leave today', 'Clock-in is refused on approved leave days.'],
    ['You have not clocked in today', 'Clock out needs a clock-in first.'],
    ['Already clocked out', 'Only one clock-out per day.'],
    ['Leave that has started cannot be cancelled', 'Ask HR to correct it.'],
  ],
  warnings: ['Clock in only for yourself, on your own device or a supervised terminal — attendance feeds payroll.'],
  next: ['HR or your manager approves the leave; you receive a notification.'],
  extraShots: [
    ['my-workspace-leave', 'My workspace — leave balances and requests'],
    ['my-workspace-apply-leave', 'Apply for leave dialog'],
    ['my-workspace-payslips', 'My workspace — payslips'],
  ],
};

export const notifications = {
  name: 'Notifications',
  purpose: 'In-app messages for events that need your attention (for example a verified lab result, a leave decision, low stock). The bell icon shows the unread count.',
  permission: 'Every account.',
  prereq: 'None.',
  nav: 'Bell icon (top bar) for the latest items; the full history is at /notifications (“View all”).',
  steps: ['Click the bell to open the latest notifications.', 'Click a notification to open the related record; it is marked as read.', 'Open the full list to review older messages and their delivery status per channel.'],
  shot: ['notifications', 'Notification history with delivery status per channel'],
  fields: [
    ['Delivery status', 'Sent (delivered to a configured provider), “demo – not sent” (channel has no provider: logged only), Skipped (channel disabled by the hospital), Opted out (patient declined that channel), Failed (provider error).'],
  ],
  example: '“Lab result ready — CBC for Ayesha Khan” → opens the lab order.',
  result: 'The item is marked read and the unread counter decreases.',
  validation: [],
  errors: [],
  warnings: ['SMS and email are not secure channels. The system only sends short reminders through them, never detailed clinical results.'],
  next: [],
};

export const search = {
  name: 'Global search',
  purpose: 'Find patients, invoices and other records from any page.',
  permission: 'Results are limited to what your role can view.',
  prereq: 'None.',
  nav: 'Search box at the top of every page, or press Ctrl K.',
  steps: ['Type at least two characters of a name, MRN, CNIC, phone number or invoice number.', 'Use the arrow keys or the mouse to pick a result.'],
  shot: ['global-search', 'Global search results'],
  fields: [['Search', 'Name, MRN, CNIC, phone, invoice number…']],
  example: 'Typing “Ayesha” lists patients and staff called Ayesha that you are allowed to see.',
  result: 'The selected record opens.',
  validation: [],
  errors: [],
  warnings: [],
  next: [],
};

export const signOut = [
  'Click your name at the top right and choose Sign out.',
  'Always sign out on shared computers. Sessions also end automatically after a period of inactivity.',
];

export const bestPracticesCommon = [
  'Never share your account or password; every action is recorded under your name in the audit log.',
  'Lock or sign out of the computer when you walk away.',
  'Use only synthetic (made-up) data for training and demonstrations. Never photograph screens that show real patients.',
  'Check the patient’s name and MRN on the header banner before recording anything.',
  'Report suspected wrong access or data errors to your administrator immediately.',
];

export const glossaryCommon = [
  ['MRN', 'Medical Record Number — the unique patient number generated at registration (for example SH-2026-000032).'],
  ['CNIC', 'Computerised National Identity Card number (Pakistan), format 12345-1234567-1.'],
  ['OPD / IPD', 'Out-patient department / In-patient department (admissions).'],
  ['Audit log', 'Permanent, read-only record of who did what and when.'],
  ['Role', 'A named set of permissions assigned to a user (for example Receptionist).'],
  ['Demo mode', 'An external channel (SMS, email) without a configured provider: messages are logged, not sent.'],
];

export const commonTroubleshooting = [
  ['A menu item described in this manual is missing', 'Your role does not have that permission, or an administrator changed the role.', 'Ask your administrator to review your role under Roles & permissions.', true],
  ['“Session expired”', 'You were inactive too long, or your password was changed elsewhere.', 'Sign in again.', true],
  ['“You do not have permission…” / 403 message after clicking a button', 'The server enforces permissions even if a button is visible.', 'Ask your administrator; do not use another person’s account.', true],
  ['Page shows a spinner for a long time', 'Network problem or server unavailable.', 'Refresh the page; if it continues, contact your IT support (unverified general guidance).', false],
];
