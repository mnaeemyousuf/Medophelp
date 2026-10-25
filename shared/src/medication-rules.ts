/** Default reminder times for a dosing frequency (24-hour HH:MM, local time). */
export function defaultDoseTimes(timesPerDay: number): string[] {
  const presets: Record<number, string[]> = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['06:00', '12:00', '18:00', '22:00'],
  };
  if (presets[timesPerDay]) return presets[timesPerDay];
  if (timesPerDay <= 0) return [];
  // Evenly spaced across a 16-hour waking day starting 06:00.
  const step = Math.floor((16 * 60) / Math.max(1, timesPerDay - 1));
  return Array.from({ length: timesPerDay }, (_, i) => {
    const m = Math.min(22 * 60, 6 * 60 + i * step);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
}

/**
 * Plans `count` dose times starting from the first slot at or after `from`, using the daily
 * `times`. Returns local Date objects in chronological order.
 */
export function planDoses(from: Date, times: string[], count: number): Date[] {
  const sorted = [...times].sort();
  if (!sorted.length || count <= 0) return [];
  const out: Date[] = [];
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < count) {
    for (const t of sorted) {
      const [h, m] = t.split(':').map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (at.getTime() >= from.getTime() && out.length < count) out.push(at);
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}

/** Courses of four weeks or longer are treated as chronic (refill + follow-up reminders). */
export const isChronicCourse = (durationDays: number) => durationDays >= 28;

/** Adherence % from dose outcomes that are due (taken vs taken + missed + skipped). */
export function adherencePercent(c: { taken: number; missed: number; skipped: number }) {
  const due = c.taken + c.missed + c.skipped;
  return due ? Math.round((c.taken / due) * 100) : null;
}
