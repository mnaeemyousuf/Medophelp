/**
 * Medophelp product identity — the single source for the product name, brand line and colours.
 * The web theme mirrors these values as CSS tokens in client/src/index.css; server PDFs, report
 * exports and the user-manual builder read them from here. The hospital's own name (tenant data)
 * stays on documents it issues; Medophelp appears as the product ("Powered by Medophelp").
 */
export const BRAND = {
  name: 'Medophelp',
  tagline: 'Smarter Healthcare. Seamless Operations.',
  colors: {
    /** Primary — buttons, links, active states. 6.2:1 on white (white text on it: 6.2:1). */
    blue: '#1A56DB',
    /** Primary pressed / hover. */
    blueDark: '#1442A8',
    /** Ink — headings, sidebar, wordmark. 16:1 on white. */
    navy: '#0B1F44',
    /** Accent — logo gradient, highlights, charts (3.0:1 — graphics and large text only, never body text). */
    teal: '#0EA5A4',
    /** Tint backgrounds for selected rows / soft badges. */
    soft: '#E0EAFF',
    /** Secondary text. 7.6:1 on white. */
    slate: '#475569',
    /** Lines and table rules. */
    line: '#E2E8F0',
    /** Table header fill. */
    tint: '#F1F5F9',
  },
  /** Categorical chart order: brand first, then distinct hues. */
  chartSeries: ['#1A56DB', '#0EA5A4', '#D97706', '#7C3AED', '#DB2777', '#0284C7', '#65A30D'],
  fonts: { display: 'Plus Jakarta Sans', body: 'Inter' },
} as const;

export const POWERED_BY = `Powered by ${BRAND.name} — ${BRAND.tagline}`;
