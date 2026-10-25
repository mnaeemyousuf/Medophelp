export const GENDERS = ['Male', 'Female', 'Other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const ALLERGY_SEVERITIES = ['Mild', 'Moderate', 'Severe', 'Life-threatening'] as const;

export const APPOINTMENT_TYPES = ['New', 'FollowUp'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'Scheduled',
  'Confirmed',
  'CheckedIn',
  'NurseAssessment',
  'WaitingForDoctor',
  'InConsultation',
  'Completed',
  'Cancelled',
  'NoShow',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that occupy a doctor's slot (double-booking guard). */
export const SLOT_HOLDING_STATUSES: AppointmentStatus[] = [
  'Scheduled',
  'Confirmed',
  'CheckedIn',
  'NurseAssessment',
  'WaitingForDoctor',
  'InConsultation',
  'Completed',
];

export const VISIT_TYPES = ['OPD', 'Emergency', 'IPD'] as const;
export const DIAGNOSIS_TYPES = ['Provisional', 'Final', 'Differential'] as const;
export const NOTE_TYPES = ['Consultation', 'Progress', 'Nursing'] as const;

export const PRESCRIPTION_STATUSES = ['Active', 'PartiallyDispensed', 'Dispensed', 'Cancelled'] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export const MEDICINE_ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Sublingual', 'Rectal', 'Ophthalmic', 'Otic', 'Nasal'] as const;

export const INVOICE_STATUSES = ['Draft', 'Issued', 'PartiallyPaid', 'Paid', 'Cancelled', 'Refunded'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_SOURCES = ['OPD', 'IPD', 'Laboratory', 'Pharmacy', 'Emergency', 'Procedure', 'Other'] as const;
export type InvoiceSource = (typeof INVOICE_SOURCES)[number];

export const PAYMENT_METHODS = ['Cash', 'Card', 'Online', 'Insurance'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const NOTIFICATION_TYPES = [
  'AppointmentReminder',
  'AppointmentConfirmation',
  'PatientReady',
  'LabResultAvailable',
  'PrescriptionAvailable',
  'PaymentDue',
  'PaymentReceived',
  'LowStock',
  'MedicineExpiry',
  'EmergencyAlert',
  'LeaveApproval',
  'PayrollGenerated',
  'RecruitmentUpdate',
  'MedicationReminder',
  'RefillReminder',
  'MissedDose',
  'FollowUpReminder',
  'General',
] as const;
/** Consent types: clinical/data-use consents and per-channel communication preferences. */
export const CONSENT_TYPES = ['Treatment', 'DataSharing', 'SmsMessages', 'EmailMessages', 'PushNotifications'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];
export const CONSENT_METHODS = ['Written', 'Verbal', 'Portal'] as const;
export const PURCHASE_REQUEST_STATUSES = ['Draft', 'Submitted', 'Approved', 'Rejected', 'Converted', 'Cancelled'] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];
export const MEDICATION_SCHEDULE_STATUSES = ['Active', 'Completed', 'Stopped'] as const;
export const DOSE_STATUSES = ['Pending', 'Taken', 'Skipped', 'Missed', 'Cancelled'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EMPLOYMENT_TYPES = ['FullTime', 'PartTime', 'Contract', 'Intern', 'Visiting'] as const;

// ── Laboratory ───────────────────────────────────────────────────────────────
export const LAB_ORDER_STATUSES = ['Ordered', 'SamplePending', 'SampleCollected', 'InProgress', 'Completed', 'Verified', 'Cancelled'] as const;
export type LabOrderStatus = (typeof LAB_ORDER_STATUSES)[number];
export const LAB_PRIORITIES = ['Routine', 'Urgent', 'STAT'] as const;
export const SAMPLE_TYPES = ['Blood', 'Serum', 'Plasma', 'Urine', 'Stool', 'Swab', 'Sputum', 'CSF', 'Other'] as const;
/** L/H = outside reference range; LL/HH = outside critical limits. */
export const RESULT_FLAGS = ['N', 'L', 'H', 'LL', 'HH', 'A'] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

// ── Inventory & pharmacy ─────────────────────────────────────────────────────
export const ITEM_CATEGORIES = ['Medicine', 'Surgical Supplies', 'Consumables', 'General Medical Supplies'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Infusion', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Sachet', 'Suppository', 'Other'] as const;
export const STOCK_LOCATIONS = ['Main Store', 'Pharmacy'] as const;
export type StockLocation = (typeof STOCK_LOCATIONS)[number];

export const INVENTORY_TX_TYPES = [
  'Purchase',
  'PurchaseReturn',
  'Adjustment',
  'TransferIn',
  'TransferOut',
  'Dispensing',
  'Consumption',
  'Expiry',
  'Damage',
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

// ── Emergency ────────────────────────────────────────────────────────────────
export const TRIAGE_LEVELS = ['Critical', 'Urgent', 'SemiUrgent', 'NonUrgent'] as const;
export type TriageLevel = (typeof TRIAGE_LEVELS)[number];
/** Lower rank = seen first. */
export const TRIAGE_RANK: Record<TriageLevel, number> = { Critical: 1, Urgent: 2, SemiUrgent: 3, NonUrgent: 4 };
/** Target time to doctor, minutes (used to highlight breaches on the ER board). */
export const TRIAGE_TARGET_MIN: Record<TriageLevel, number> = { Critical: 0, Urgent: 15, SemiUrgent: 60, NonUrgent: 120 };
export const ARRIVAL_MODES = ['Walk-in', 'Ambulance', 'Police', 'Referred', 'Other'] as const;
export const ER_STATUSES = ['Registered', 'Triaged', 'InTreatment', 'Admitted', 'Discharged', 'Referred', 'LeftWithoutBeingSeen', 'Deceased'] as const;
export type ErStatus = (typeof ER_STATUSES)[number];
export const ER_DISPOSITIONS = ['Discharged', 'Admitted', 'Referred', 'LeftWithoutBeingSeen', 'Deceased'] as const;
export type ErDisposition = (typeof ER_DISPOSITIONS)[number];

// ── Admissions / IPD ─────────────────────────────────────────────────────────
export const WARD_TYPES = ['General', 'Semi-Private', 'Private', 'ICU', 'CCU', 'NICU', 'Maternity', 'Pediatric', 'Surgical', 'Isolation'] as const;
export const BED_STATUSES = ['Available', 'Reserved', 'Occupied', 'Cleaning', 'Maintenance'] as const;
export type BedStatus = (typeof BED_STATUSES)[number];
export const ADMISSION_SOURCES = ['OPD', 'Emergency', 'Direct', 'Referral'] as const;
export const ADMISSION_STATUSES = ['Admitted', 'Discharged', 'Cancelled'] as const;
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];
export const DISCHARGE_TYPES = ['Routine', 'AgainstMedicalAdvice', 'Referred', 'Deceased'] as const;

// ── Insurance ────────────────────────────────────────────────────────────────
export const CLAIM_STATUSES = ['Draft', 'Submitted', 'UnderReview', 'Approved', 'PartiallyApproved', 'Rejected', 'Paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// ── HR ───────────────────────────────────────────────────────────────────────
export const ATTENDANCE_STATUSES = ['Present', 'Late', 'HalfDay', 'Absent', 'OnLeave', 'WeeklyOff', 'Holiday'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Maternity', 'Unpaid', 'Other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_STATUSES = ['PendingManager', 'PendingHR', 'Approved', 'Rejected', 'Cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const CONTRACT_STATUSES = ['Active', 'Expired', 'Terminated'] as const;
export const REVIEW_STATUSES = ['Draft', 'Submitted', 'Acknowledged'] as const;

// ── Payroll ──────────────────────────────────────────────────────────────────
export const PAYROLL_STATUSES = ['Draft', 'Review', 'Approved', 'Processed', 'Cancelled'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

// ── Recruitment ──────────────────────────────────────────────────────────────
export const JOB_STATUSES = ['Draft', 'Open', 'OnHold', 'Closed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const CANDIDATE_STAGES = ['Applied', 'Shortlisted', 'Interview', 'Selected', 'Offer', 'Hired', 'Rejected'] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];
export const INTERVIEW_MODES = ['In person', 'Phone', 'Video'] as const;
export const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'NoShow'] as const;
export const RECOMMENDATIONS = ['Hire', 'Hold', 'Reject'] as const;
export const OFFER_STATUSES = ['Draft', 'PendingApproval', 'Approved', 'Sent', 'Accepted', 'Declined', 'Withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const CANDIDATE_SOURCES = ['Website', 'Referral', 'Job board', 'Walk-in', 'Agency', 'Other'] as const;

export const PO_STATUSES = ['Draft', 'PendingApproval', 'Approved', 'Ordered', 'PartiallyReceived', 'Received', 'Cancelled'] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];
