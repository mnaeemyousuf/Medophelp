import type { AppointmentStatus, InvoiceStatus } from '@hms/shared';

export interface Allergy {
  _id: string;
  allergen: string;
  reaction?: string;
  severity: string;
}
export interface HistoryEntry {
  _id: string;
  condition: string;
  diagnosedOn?: string;
  isChronic: boolean;
  notes?: string;
}
export interface Insurance {
  _id: string;
  provider: string;
  policyNumber: string;
  coveragePercent: number;
  coverageLimit?: number;
  expiresOn?: string;
}

export interface Patient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  fullName: string;
  guardianName?: string;
  cnic?: string;
  dateOfBirth: string;
  age?: number;
  gender: string;
  bloodGroup: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  isProvisional?: boolean;
  allergies: Allergy[];
  medicalHistory: HistoryEntry[];
  insurances: Insurance[];
  createdAt: string;
}

export interface Appointment {
  id: string;
  appointmentNo: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Appointment type code from the hospital catalog. */
  type: string;
  status: AppointmentStatus;
  reason?: string;
  cancellationReason?: string;
  tokenNumber?: number;
  checkedInAt?: string;
  visitId?: string;
  patient: { id: string; mrn?: string; name?: string; gender?: string; dateOfBirth?: string; phone?: string };
  doctor: { id: string; name?: string; specialization?: string };
  department: { id: string; name?: string };
}

export interface Vitals {
  _id: string;
  systolicBp: number;
  diastolicBp: number;
  heartRate: number;
  temperatureC: number;
  spo2: number;
  respiratoryRate?: number;
  weightKg: number;
  heightCm: number;
  bmi?: number;
  painScale?: number;
  flags: string[];
  recordedAt: string;
  recordedByName?: string;
}

export interface PrescriptionItem {
  _id?: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  timesPerDay: number;
  route: string;
  durationDays: number;
  quantity: number;
  instructions?: string;
  dispensedQuantity?: number;
}
export interface Prescription {
  _id: string;
  prescriptionNo: string;
  patientId: string;
  visitId: string;
  doctorName?: string;
  prescribedAt: string;
  status: string;
  notes?: string;
  items: PrescriptionItem[];
}

export interface Diagnosis {
  _id: string;
  icdCode?: string;
  description: string;
  type: string;
  doctorName?: string;
  createdAt: string;
}

export interface ClinicalNote {
  _id: string;
  type: string;
  amendedAt?: string;
  amendmentReason?: string;
  versions?: Array<{ chiefComplaint?: string; content: string; savedAt: string; byName?: string; reason?: string }>;
  chiefComplaint?: string;
  content: string;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLine {
  _id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
}
export interface Payment {
  _id: string;
  receiptNo: string;
  amount: number;
  method: string;
  reference?: string;
  receivedAt: string;
  receivedByName?: string;
  refunded: number;
}
export interface Invoice {
  _id: string;
  invoiceNo: string;
  patientId: string;
  mrn: string;
  patientName: string;
  source: string;
  status: InvoiceStatus;
  items?: InvoiceLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paid: number;
  refunded: number;
  balance: number;
  issuedAt?: string;
  createdAt: string;
  notes?: string;
  payments?: Payment[];
  refunds?: Array<{ _id: string; refundNo: string; amount: number; reason: string; processedAt: string }>;
}

export interface Doctor {
  _id: string;
  name: string;
  specialization: string;
  departmentId: { _id: string; name: string; code: string } | string;
  consultationFee: number;
  followUpFee: number;
  slotMinutes: number;
  dutyStart: string;
  dutyEnd: string;
  workingDays: number[];
  isAvailable: boolean;
  licenseNumber: string;
  qualification?: string;
  userId?: string;
}

// ── Laboratory ──────────────────────────────────────────────────────────────
export interface LabParameter {
  name: string;
  unit?: string;
  type: 'numeric' | 'text';
  refLow?: number;
  refHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  refText?: string;
}
export interface LabTest {
  _id: string;
  code: string;
  name: string;
  category: string;
  sampleType: string;
  price: number;
  turnaroundHours: number;
  parameters: LabParameter[];
  isActive: boolean;
}
export interface LabResult {
  parameter: string;
  value: string;
  unit?: string;
  refRange?: string;
  flag: 'N' | 'L' | 'H' | 'LL' | 'HH' | 'A';
}
export interface LabOrder {
  _id: string;
  orderNo: string;
  attachments?: Array<{ _id: string; fileName: string; contentType?: string; description?: string; uploadedByName?: string; at: string }>;
  assignedByName?: string;
  assignedAt?: string;
  patientId: string;
  patient?: { id: string; mrn: string; name: string; gender?: string; dateOfBirth?: string; phone?: string };
  visitId?: string;
  doctorName?: string;
  priority: 'Routine' | 'Urgent' | 'STAT';
  status: string;
  clinicalNotes?: string;
  items: Array<{ _id: string; testId: string; testCode?: string; testName: string; sampleType?: string; price: number; results: LabResult[] }>;
  sample?: { type?: string; barcode?: string; collectedAt?: string; collectedByName?: string };
  technicianName?: string;
  resultsEnteredAt?: string;
  comments?: string;
  verifiedAt?: string;
  verifiedByName?: string;
  reviewedAt?: string;
  reviewedByName?: string;
  hasAbnormal: boolean;
  hasCritical: boolean;
  cancelReason?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
}

// ── Inventory, pharmacy, purchasing ─────────────────────────────────────────
export interface StockItem {
  therapeuticClass?: string;
  _id: string;
  sku: string;
  name: string;
  category: string;
  genericName?: string;
  form?: string;
  strength?: string;
  unit: string;
  defaultSupplierId?: string | { _id: string; name: string; code: string };
  purchasePrice: number;
  sellingPrice: number;
  reorderLevel: number;
  isControlled: boolean;
  isActive: boolean;
  currentStock: number;
  stockByLocation?: { 'Main Store': number; Pharmacy: number };
  nextExpiry?: string | null;
  expiredQty?: number;
  isLow?: boolean;
}
export interface StockBatch {
  _id: string;
  itemId: string | { _id: string; name: string; sku: string; unit: string };
  batchNo: string;
  location: 'Main Store' | 'Pharmacy';
  expiryDate: string;
  quantity: number;
  unitCost: number;
  isExpired?: boolean;
  daysLeft?: number;
}
export interface StockTx {
  _id: string;
  itemId: string | { _id: string; name: string; sku: string; unit: string };
  batchNo?: string;
  location?: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  refType?: string;
  refNo?: string;
  reason?: string;
  byName?: string;
  at: string;
}
export interface Supplier {
  _id: string;
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  paymentTermsDays: number;
  isActive: boolean;
}
export interface PurchaseOrder {
  _id: string;
  poNo: string;
  supplierId: string;
  supplierName: string;
  status: string;
  items: Array<{ _id: string; itemId: string; sku?: string; itemName: string; unit?: string; quantity: number; receivedQuantity: number; unitPrice: number; discount: number; taxRate: number; tax: number; total: number }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  expectedDelivery?: string;
  notes?: string;
  requestedByName?: string;
  approvedByName?: string;
  approvedAt?: string;
  orderedAt?: string;
  cancelReason?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
  receipts?: Array<{ _id: string; grnNo: string; location: string; receivedAt: string; receivedByName?: string; invoiceRef?: string; lines: Array<{ itemName: string; batchNo: string; expiryDate: string; quantity: number }> }>;
}
export interface FormularyItem {
  _id: string;
  name: string;
  genericName?: string;
  strength?: string;
  form?: string;
  unit: string;
  sellingPrice: number;
  isControlled: boolean;
  available: number;
}

// ── Emergency, IPD, insurance ───────────────────────────────────────────────
export type TriageLevel = 'Critical' | 'Urgent' | 'SemiUrgent' | 'NonUrgent';
export interface ErBoardCase {
  _id: string;
  caseNo: string;
  status: string;
  triageLevel?: TriageLevel;
  arrivalAt: string;
  arrivalMode: string;
  presentingComplaint: string;
  assignedDoctorName?: string;
  waitingMinutes: number;
  breach: boolean;
  patient: { id: string; mrn: string; name: string; gender: string; dateOfBirth: string; isProvisional: boolean; allergies: string[] };
}
export interface ErCase {
  _id: string;
  caseNo: string;
  status: string;
  triageLevel?: TriageLevel;
  triage: Array<{ level: TriageLevel; notes?: string; at: string; byName?: string; vitalSignId?: string }>;
  arrivalAt: string;
  arrivalMode: string;
  presentingComplaint: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  treatmentStartedAt?: string;
  waitingMinutes: number;
  visitId: string;
  invoiceId?: string;
  disposition?: { type: string; at: string; notes: string; referredTo?: string; admissionId?: string; byName?: string };
  events: Array<{ at: string; kind: string; text: string; byName?: string }>;
  patient: { id: string; mrn: string; name: string; gender: string; dateOfBirth: string; bloodGroup: string; phone?: string; cnic?: string; isProvisional: boolean; emergencyContactName?: string; emergencyContactPhone?: string; allergies: Allergy[]; medicalHistory: HistoryEntry[] };
  vitals: Vitals[];
  notes: ClinicalNote[];
  prescriptions: Prescription[];
  labOrders: LabOrder[];
}

export interface BoardBed {
  _id: string;
  bedNo: string;
  status: 'Available' | 'Reserved' | 'Occupied' | 'Cleaning' | 'Maintenance';
  statusNote?: string;
  ratePerDay: number;
  occupant?: { admissionId: string; admissionNo: string; patientId: string; name: string; mrn: string; gender: string; doctor?: string; admittedAt: string; expectedDischargeAt?: string };
}
export interface BedBoard {
  totals: { beds: number; available: number; occupied: number; reserved: number; cleaning: number; maintenance: number };
  wards: Array<{ _id: string; code: string; name: string; type: string; floor?: string; chargePerDay: number; rooms: Array<{ _id: string; roomNo: string; beds: BoardBed[] }> }>;
}
export interface AdmissionRow {
  _id: string;
  admissionNo: string;
  status: string;
  source: string;
  patient?: { id: string; mrn: string; name: string; gender: string };
  attendingDoctorName?: string;
  wardName?: string;
  bedLabel: string;
  reason: string;
  admittedAt: string;
  expectedDischargeAt?: string;
  discharge?: { at: string; type: string };
}
export interface AdmissionDetail {
  _id: string;
  admissionNo: string;
  status: string;
  source: string;
  emergencyCaseId?: string;
  visitId: string;
  attendingDoctorId: string;
  attendingDoctorName?: string;
  assignedNurseName?: string;
  reason: string;
  provisionalDiagnosis?: string;
  admittedAt: string;
  expectedDischargeAt?: string;
  stays: Array<{ bedId: string; wardName: string; roomNo?: string; bedNo: string; ratePerDay: number; from: string; to?: string; reason?: string }>;
  notes: Array<{ _id: string; at: string; kind: 'Progress' | 'Nursing' | 'Event'; text: string; authorName?: string }>;
  discharge?: { at: string; type: string; finalDiagnosis: string; treatmentGiven: string; conditionAtDischarge: string; medications?: string; instructions?: string; followUpDate?: string; byName?: string };
  invoiceId?: string;
  patient: { id: string; mrn: string; name: string; gender: string; dateOfBirth: string; bloodGroup: string; phone?: string; allergies: Allergy[] };
  vitals: Vitals[];
  prescriptions: Prescription[];
  labOrders: LabOrder[];
  lengthOfStayDays: number;
  estimatedCharges?: number;
}
export interface Claim {
  _id: string;
  claimNo: string;
  patientId: string;
  patientName: string;
  mrn: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceTotal: number;
  provider: string;
  policyNumber: string;
  coveragePercent?: number;
  coverageLimit?: number;
  policyExpiresOn?: string;
  claimAmount: number;
  approvedAmount: number;
  rejectedAmount: number;
  paidAmount: number;
  status: string;
  submittedAt?: string;
  decidedAt?: string;
  paidAt?: string;
  payerReference?: string;
  notes?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
  invoice?: Invoice;
  remainingLimit?: number | null;
}

export interface Department {
  _id: string;
  code: string;
  name: string;
  description?: string;
  isClinical: boolean;
  isActive: boolean;
}

// ── Phase 4: HR, payroll, recruitment ───────────────────────────────────────
export interface AttendanceRecord {
  _id: string;
  employeeId: string;
  date: string;
  status: string;
  clockIn?: string;
  clockOut?: string;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  workedMinutes?: number;
  overtimeMinutes?: number;
  source?: string;
  note?: string;
}
export interface Employee {
  _id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string;
  cnic?: string;
  dateOfBirth?: string;
  departmentId: string | { _id: string; name: string };
  departmentName?: string;
  designation: string;
  joiningDate: string;
  exitDate?: string;
  employmentType: string;
  phone?: string;
  email?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  reportingManagerId?: string | { _id: string; firstName: string; lastName: string; designation?: string };
  managerName?: string;
  shiftStart?: string;
  shiftEnd?: string;
  userId?: string;
  isActive: boolean;
  today?: AttendanceRecord | null;
}
export interface LineItem {
  name: string;
  amount: number;
}
export interface Contract {
  _id: string;
  contractNo: string;
  type: string;
  startDate: string;
  endDate?: string;
  basicSalary: number;
  noticePeriodDays?: number;
  probationMonths?: number;
  terms?: string;
  status: string;
  terminationReason?: string;
}
export interface SalaryStructure {
  _id: string;
  effectiveFrom: string;
  basic: number;
  allowances: LineItem[];
  deductions: LineItem[];
  taxPercent: number;
  overtimeRatePerHour?: number;
  bankName?: string;
  bankAccount?: string;
  createdAt: string;
}
export interface PerformanceReview {
  _id: string;
  period: string;
  rating: number;
  goals?: string;
  strengths?: string;
  improvements?: string;
  status: string;
  reviewerName?: string;
  submittedAt?: string;
  acknowledgedAt?: string;
  employeeComment?: string;
}
export interface LeaveBalance {
  type: string;
  entitled: number;
  used: number;
  pending: number;
  available: number | null;
}
export interface AttendanceSummaryRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  department?: string;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number;
}
export interface EmployeeProfile extends Employee {
  contracts: Contract[];
  reviews: PerformanceReview[];
  directReports: Array<{ _id: string; firstName: string; lastName: string; designation: string }>;
  salaryHistory: SalaryStructure[];
  leaveBalances: LeaveBalance[];
  attendanceThisMonth: AttendanceSummaryRow | null;
}
export interface LeaveRequest {
  _id: string;
  requestNo: string;
  employeeId: string;
  employeeName: string;
  departmentName?: string;
  type: string;
  from: string;
  to: string;
  days: number;
  halfDay?: boolean;
  reason: string;
  status: string;
  managerDecision?: { byName: string; at: string; approve: boolean; note?: string };
  hrDecision?: { byName: string; at: string; approve: boolean; note?: string };
  createdAt: string;
}
export interface PayrollRun {
  _id: string;
  runNo: string;
  period: string;
  status: string;
  workingDays: number;
  employees: number;
  totals: { gross: number; deductions: number; tax: number; net: number };
  preparedByName?: string;
  approvedByName?: string;
  approvedAt?: string;
  processedAt?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
}
export interface PayrollItem {
  _id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  designation?: string;
  departmentName?: string;
  basic: number;
  allowances: LineItem[];
  deductions: LineItem[];
  allowanceTotal: number;
  taxPercent: number;
  overtimeHours: number;
  overtimeRatePerHour: number;
  overtimePay: number;
  bonus: number;
  otherDeduction: number;
  adjustmentNote?: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  unpaidLeaveDeduction: number;
  absenceDeduction: number;
  gross: number;
  tax: number;
  totalDeductions: number;
  net: number;
  bankName?: string;
  bankAccount?: string;
}
export interface Payslip {
  _id: string;
  payslipNo: string;
  period: string;
  gross: number;
  totalDeductions: number;
  net: number;
  employeeId: string;
  createdAt: string;
}
export interface JobPosting {
  _id: string;
  jobNo: string;
  title: string;
  departmentId: string | { _id: string; name: string };
  departmentName?: string;
  employmentType: string;
  openings: number;
  filled?: number;
  description: string;
  requirements?: string;
  salaryMin?: number;
  salaryMax?: number;
  closingDate?: string;
  status: string;
  pipeline?: Record<string, number>;
  candidates?: number;
  createdAt: string;
}
export interface Interview {
  _id: string;
  candidateId: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: string;
  location?: string;
  panel: string[];
  status: string;
  candidateName?: string;
  jobTitle?: string;
  evaluation?: { technical: number; communication: number; experience: number; attitude: number; overall: number; recommendation: string; comments: string; byName: string; at: string };
}
export interface OfferLetter {
  _id: string;
  offerNo: string;
  candidateId: string;
  candidateName: string;
  designation: string;
  departmentId: string;
  employmentType: string;
  basicSalary: number;
  allowances: LineItem[];
  joiningDate: string;
  expiresOn: string;
  terms?: string;
  status: string;
  approvedByName?: string;
  createdAt: string;
  history?: Array<{ status: string; at: string; byName?: string; note?: string }>;
}
export interface Candidate {
  _id: string;
  jobId: string | { _id: string; title: string; jobNo: string; departmentId?: string; employmentType?: string };
  jobTitle?: string;
  firstName: string;
  lastName: string;
  fullName: string;
  gender: string;
  email: string;
  phone: string;
  cnic?: string;
  source: string;
  currentEmployer?: string;
  experienceYears?: number;
  expectedSalary?: number;
  notes?: string;
  stage: string;
  rejectedFromStage?: string;
  employeeId?: string;
  resume?: { fileName: string; sizeBytes: number };
  history?: Array<{ stage: string; at: string; byName?: string; note?: string }>;
  interviews?: Interview[];
  offers?: OfferLetter[];
  updatedAt: string;
}
