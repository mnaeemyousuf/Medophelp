import { DEFAULT_CATALOG, type Catalog } from '@hms/shared';
import { requireCtx } from '../../core/context';
import { BusinessRuleError } from '../../core/errors';
import { Hospital } from './organization.models';

/** The hospital's configurable lists, with defaults for anything not configured yet. */
export async function getCatalog(): Promise<Catalog> {
  const h = await Hospital.findById(requireCtx().hospitalId).select('catalog').lean();
  const c = h?.catalog;
  return {
    appointmentTypes: c?.appointmentTypes?.length ? (c.appointmentTypes as Catalog['appointmentTypes']) : DEFAULT_CATALOG.appointmentTypes,
    paymentMethods: c?.paymentMethods?.length ? (c.paymentMethods as Catalog['paymentMethods']) : DEFAULT_CATALOG.paymentMethods,
    medicineCategories: c?.medicineCategories?.length ? c.medicineCategories : DEFAULT_CATALOG.medicineCategories,
    designations: c?.designations ?? [],
    medicationScheduleFrom: (c?.medicationScheduleFrom as Catalog['medicationScheduleFrom']) ?? DEFAULT_CATALOG.medicationScheduleFrom,
  };
}

/** Returns the active appointment type for a code, or refuses the request. */
export async function requireAppointmentType(code: string) {
  const t = (await getCatalog()).appointmentTypes.find((x) => x.code === code);
  if (!t) throw new BusinessRuleError(`Unknown appointment type "${code}"`);
  if (!t.isActive) throw new BusinessRuleError(`Appointment type "${t.label}" is no longer offered`);
  return t;
}

/** Fee basis for an appointment's type; unknown legacy codes fall back to the consultation fee. */
export async function feeBasisOf(code: string) {
  return (await getCatalog()).appointmentTypes.find((x) => x.code === code)?.feeBasis ?? (code === 'FollowUp' ? 'FollowUp' : 'Consultation');
}

export async function requirePaymentMethod(method: string) {
  if (method === 'Insurance') return; // insurer settlements are posted by the claims module
  if (!(await getCatalog()).paymentMethods.includes(method as never)) throw new BusinessRuleError(`${method} payments are not accepted at this hospital`, 'payment_method_disabled');
}

export async function requireMedicineCategory(category?: string) {
  if (!category) return;
  if (!(await getCatalog()).medicineCategories.includes(category)) throw new BusinessRuleError(`Unknown medicine category "${category}"`);
}

/** When the hospital maintains a designation list, only listed titles are accepted. */
export async function requireDesignation(designation: string) {
  const list = (await getCatalog()).designations;
  if (list.length && !list.some((d) => d.toLowerCase() === designation.trim().toLowerCase())) {
    throw new BusinessRuleError(`"${designation}" is not a configured designation — add it in Hospital settings first`, 'unknown_designation');
  }
}