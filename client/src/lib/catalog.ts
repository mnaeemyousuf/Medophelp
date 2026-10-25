import { useQuery } from '@tanstack/react-query';
import { DEFAULT_CATALOG, type Catalog } from '@hms/shared';
import { api } from './api';

/** The hospital's configurable lists (appointment types, payment methods, medicine categories). */
export function useCatalog() {
  const { data } = useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/admin/catalog'), staleTime: 300_000 });
  return data ?? DEFAULT_CATALOG;
}

/** Display label for an appointment type code (falls back to the code for retired types). */
export function appointmentTypeLabel(code: string, catalog: Catalog) {
  return catalog.appointmentTypes.find((t) => t.code === code)?.label ?? (code === 'FollowUp' ? 'Follow-up' : code);
}
