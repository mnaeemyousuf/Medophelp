import { vi } from 'vitest';

// The workflows book same-day appointments (check-in is only allowed on the day). Run late in the
// evening there are no slots left "today", so outside 07:00–19:00 the clock is moved to 10:00 the
// same day. Only Date is faked and it keeps ticking, so timeouts and ordering behave normally.
const now = new Date();
if (now.getHours() < 7 || now.getHours() >= 19) {
  const morning = new Date(now);
  morning.setHours(10, 0, 0, 0);
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: morning });
}
