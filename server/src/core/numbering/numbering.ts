import { Schema, model, Types } from 'mongoose';
import { currentHospitalId } from '../context';

const counterSchema = new Schema(
  {
    hospitalId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    year: { type: Number, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ hospitalId: 1, key: 1, year: 1 }, { unique: true });

const Counter = model('Counter', counterSchema);

export type SequenceKey =
  | 'mrn'
  | 'invoice'
  | 'receipt'
  | 'prescription'
  | 'emergency'
  | 'labOrder'
  | 'visit'
  | 'appointment'
  | 'employee'
  | 'refund'
  | 'purchaseOrder'
  | 'goodsReceipt'
  | 'dispense'
  | 'admission'
  | 'claim'
  | 'contract'
  | 'leave'
  | 'payrollRun'
  | 'payslip'
  | 'job'
  | 'offer'
  | 'purchaseRequest';

/**
 * Formats a business number from a template.
 * Tokens: {code} hospital code, {yyyy} year, {yy} 2-digit year, {n:6} zero-padded sequence.
 */
export function formatNumber(template: string, opts: { code: string; year: number; seq: number }) {
  return template
    .replace('{code}', opts.code)
    .replace('{yyyy}', String(opts.year))
    .replace('{yy}', String(opts.year).slice(-2))
    .replace(/\{n:(\d+)\}/, (_, w) => String(opts.seq).padStart(Number(w), '0'))
    .replace('{n}', String(opts.seq));
}

const counterYear = (template: string, year: number) => (template.includes('{yy') ? year : 0);

/** Moves a counter forward to at least `seq` (used after bulk imports/seeding that assign numbers directly). */
export async function ensureCounterAtLeast(key: SequenceKey, template: string, hospitalId: Types.ObjectId, seq: number) {
  await Counter.updateOne({ hospitalId, key, year: counterYear(template, new Date().getFullYear()) }, { $max: { seq } }, { upsert: true });
}

/**
 * Atomically reserves the next number for (hospital, key, year). The $inc on a uniquely indexed
 * document is atomic, so two concurrent registrations can never get the same MRN.
 */
export async function nextNumber(key: SequenceKey, template: string, hospitalCode: string, hospitalId?: Types.ObjectId) {
  const year = new Date().getFullYear();
  const hid = hospitalId ?? currentHospitalId();
  // Sequences without a year in the number (e.g. EMP-00042) never reset, so they share one counter (year 0).
  const counter = await Counter.findOneAndUpdate(
    { hospitalId: hid, key, year: counterYear(template, year) },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return formatNumber(template, { code: hospitalCode, year, seq: counter!.seq });
}
