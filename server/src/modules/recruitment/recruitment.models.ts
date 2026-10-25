import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { CANDIDATE_SOURCES, CANDIDATE_STAGES, EMPLOYMENT_TYPES, GENDERS, INTERVIEW_MODES, INTERVIEW_STATUSES, JOB_STATUSES, OFFER_STATUSES, RECOMMENDATIONS } from '@hms/shared';
import { actorFields, basePlugin } from '../../core/plugins/base.plugin';

const jobSchema = new Schema({
  jobNo: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FullTime' },
  openings: { type: Number, default: 1, min: 1 },
  filled: { type: Number, default: 0, min: 0 },
  description: { type: String, required: true },
  requirements: String,
  salaryMin: Number,
  salaryMax: Number,
  closingDate: Date,
  status: { type: String, enum: JOB_STATUSES, default: 'Draft', index: true },
  postedAt: Date,
});
jobSchema.plugin(basePlugin);
jobSchema.index({ hospitalId: 1, jobNo: 1 }, { unique: true });
export const JobPosting = model('JobPosting', jobSchema);

const stageEventSchema = new Schema({ stage: { type: String, enum: CANDIDATE_STAGES }, at: { type: Date, default: () => new Date() }, byName: String, note: String }, { _id: false });

const candidateSchema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true, index: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  gender: { type: String, enum: GENDERS, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: { type: String, required: true },
  cnic: String,
  source: { type: String, enum: CANDIDATE_SOURCES, default: 'Website' },
  currentEmployer: String,
  experienceYears: Number,
  expectedSalary: Number,
  stage: { type: String, enum: CANDIDATE_STAGES, default: 'Applied', index: true },
  rejectedFromStage: String,
  notes: String,
  resume: { fileName: String, contentType: String, sizeBytes: Number, storageKey: String },
  history: [stageEventSchema],
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
});
candidateSchema.plugin(basePlugin);
candidateSchema.index({ hospitalId: 1, jobId: 1, email: 1 }, { unique: true });
export const Candidate = model('Candidate', candidateSchema);
export type CandidateDoc = HydratedDocument<InferSchemaType<typeof candidateSchema>>;

/** Interview with its evaluation (Interviews + InterviewEvaluations). */
const interviewSchema = new Schema({
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  scheduledAt: { type: Date, required: true },
  durationMinutes: { type: Number, default: 45 },
  mode: { type: String, enum: INTERVIEW_MODES, default: 'In person' },
  location: String,
  panel: [String],
  status: { type: String, enum: INTERVIEW_STATUSES, default: 'Scheduled' },
  evaluation: {
    technical: Number,
    communication: Number,
    experience: Number,
    attitude: Number,
    overall: Number,
    recommendation: { type: String, enum: RECOMMENDATIONS },
    comments: String,
    byName: String,
    at: Date,
  },
});
interviewSchema.plugin(basePlugin);
interviewSchema.index({ hospitalId: 1, scheduledAt: 1 });
export const Interview = model('Interview', interviewSchema);

const offerSchema = new Schema({
  ...actorFields,
  offerNo: { type: String, required: true },
  candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
  jobId: { type: Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  candidateName: String,
  designation: { type: String, required: true },
  departmentId: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'FullTime' },
  basicSalary: { type: Number, required: true, min: 0 },
  allowances: [{ _id: false, name: String, amount: Number }],
  joiningDate: { type: Date, required: true },
  expiresOn: { type: Date, required: true },
  terms: String,
  status: { type: String, enum: OFFER_STATUSES, default: 'Draft', index: true },
  approvedByName: String,
  approvedAt: Date,
  sentAt: Date,
  respondedAt: Date,
  history: [{ _id: false, status: String, at: { type: Date, default: () => new Date() }, byName: String, note: String }],
});
offerSchema.plugin(basePlugin);
offerSchema.index({ hospitalId: 1, offerNo: 1 }, { unique: true });
export const OfferLetter = model('OfferLetter', offerSchema);
export type OfferDoc = HydratedDocument<InferSchemaType<typeof offerSchema>>;
