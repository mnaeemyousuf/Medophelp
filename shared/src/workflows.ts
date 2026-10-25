import type {
  AppointmentStatus,
  BedStatus,
  CandidateStage,
  ClaimStatus,
  ErStatus,
  InvoiceStatus,
  LabOrderStatus,
  LeaveStatus,
  OfferStatus,
  PayrollStatus,
  PrescriptionStatus,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from './enums';

export type TransitionTable<S extends string> = Partial<Record<S, readonly S[]>>;

export interface Workflow<S extends string> {
  name: string;
  transitions: TransitionTable<S>;
}

export const appointmentWorkflow: Workflow<AppointmentStatus> = {
  name: 'Appointment',
  transitions: {
    Scheduled: ['Confirmed', 'CheckedIn', 'Cancelled', 'NoShow'],
    Confirmed: ['CheckedIn', 'Cancelled', 'NoShow'],
    CheckedIn: ['NurseAssessment', 'WaitingForDoctor', 'Cancelled'],
    NurseAssessment: ['WaitingForDoctor'],
    WaitingForDoctor: ['InConsultation'],
    InConsultation: ['Completed'],
  },
};

export const prescriptionWorkflow: Workflow<PrescriptionStatus> = {
  name: 'Prescription',
  transitions: {
    Active: ['PartiallyDispensed', 'Dispensed', 'Cancelled'],
    PartiallyDispensed: ['Dispensed'],
  },
};

export const invoiceWorkflow: Workflow<InvoiceStatus> = {
  name: 'Invoice',
  transitions: {
    Draft: ['Issued', 'Cancelled'],
    Issued: ['PartiallyPaid', 'Paid', 'Cancelled'],
    PartiallyPaid: ['Paid', 'Refunded'],
    // a partial refund of a settled invoice re-opens its balance
    Paid: ['PartiallyPaid', 'Refunded'],
  },
};

export const labOrderWorkflow: Workflow<LabOrderStatus> = {
  name: 'Lab order',
  transitions: {
    Ordered: ['SamplePending', 'Cancelled'],
    SamplePending: ['SampleCollected', 'Cancelled'],
    SampleCollected: ['InProgress', 'Cancelled'],
    InProgress: ['Completed'],
    // a rejected verification sends results back for correction
    Completed: ['Verified', 'InProgress'],
  },
};

export const purchaseOrderWorkflow: Workflow<PurchaseOrderStatus> = {
  name: 'Purchase order',
  transitions: {
    Draft: ['PendingApproval', 'Cancelled'],
    PendingApproval: ['Approved', 'Draft', 'Cancelled'],
    Approved: ['Ordered', 'Cancelled'],
    Ordered: ['PartiallyReceived', 'Received', 'Cancelled'],
    PartiallyReceived: ['Received'],
  },
};

export const emergencyWorkflow: Workflow<ErStatus> = {
  name: 'Emergency case',
  transitions: {
    // Critical patients may go straight to treatment; triage is recorded alongside.
    Registered: ['Triaged', 'InTreatment', 'LeftWithoutBeingSeen'],
    Triaged: ['InTreatment', 'LeftWithoutBeingSeen'],
    InTreatment: ['Admitted', 'Discharged', 'Referred', 'Deceased', 'LeftWithoutBeingSeen'],
  },
};

/** Bed housekeeping cycle. Occupancy changes go through admission, transfer and discharge only. */
export const bedWorkflow: Workflow<BedStatus> = {
  name: 'Bed',
  transitions: {
    Available: ['Reserved', 'Occupied', 'Maintenance'],
    Reserved: ['Available', 'Occupied'],
    Occupied: ['Cleaning'],
    Cleaning: ['Available', 'Maintenance'],
    Maintenance: ['Available'],
  },
};

export const claimWorkflow: Workflow<ClaimStatus> = {
  name: 'Insurance claim',
  transitions: {
    Draft: ['Submitted'],
    Submitted: ['UnderReview', 'Approved', 'PartiallyApproved', 'Rejected'],
    UnderReview: ['Approved', 'PartiallyApproved', 'Rejected'],
    Approved: ['Paid'],
    PartiallyApproved: ['Paid'],
    // a rejected claim can be corrected and resubmitted
    Rejected: ['Draft'],
  },
};

/** Employee request → manager approval → HR review → approved / rejected. */
export const leaveWorkflow: Workflow<LeaveStatus> = {
  name: 'Leave request',
  transitions: {
    PendingManager: ['PendingHR', 'Rejected', 'Cancelled'],
    PendingHR: ['Approved', 'Rejected', 'Cancelled'],
    // approved leave can be cancelled before it starts (balance is restored)
    Approved: ['Cancelled'],
  },
};

/** Draft → review → approve → process (payslips). */
export const payrollWorkflow: Workflow<PayrollStatus> = {
  name: 'Payroll run',
  transitions: {
    Draft: ['Review', 'Cancelled'],
    Review: ['Approved', 'Draft', 'Cancelled'],
    Approved: ['Processed', 'Draft'],
  },
};

export const candidateWorkflow: Workflow<CandidateStage> = {
  name: 'Candidate',
  transitions: {
    Applied: ['Shortlisted', 'Rejected'],
    Shortlisted: ['Interview', 'Rejected'],
    Interview: ['Selected', 'Rejected'],
    Selected: ['Offer', 'Rejected'],
    Offer: ['Hired', 'Rejected'],
  },
};

export const offerWorkflow: Workflow<OfferStatus> = {
  name: 'Offer letter',
  transitions: {
    Draft: ['PendingApproval', 'Withdrawn'],
    PendingApproval: ['Approved', 'Draft', 'Withdrawn'],
    Approved: ['Sent', 'Withdrawn'],
    Sent: ['Accepted', 'Declined', 'Withdrawn'],
  },
};

/** Requisition raised by pharmacy/stores → approved by purchasing → converted into a draft PO. */
export const purchaseRequestWorkflow: Workflow<PurchaseRequestStatus> = {
  name: 'Purchase request',
  transitions: {
    Draft: ['Submitted', 'Cancelled'],
    Submitted: ['Approved', 'Rejected', 'Cancelled'],
    Approved: ['Converted', 'Cancelled'],
    Rejected: ['Draft'],
  },
};

export function canTransition<S extends string>(wf: Workflow<S>, from: S, to: S): boolean {
  return wf.transitions[from]?.includes(to) ?? false;
}

export function nextStates<S extends string>(wf: Workflow<S>, from: S): readonly S[] {
  return wf.transitions[from] ?? [];
}
