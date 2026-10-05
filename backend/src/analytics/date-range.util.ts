import type { FinanceChatRelative } from './finance-chat.types';

/**
 * Timezone-safe date-range math, extracted from `AnalyticsService` so it can
 * be unit-tested directly without spinning up Nest DI or a database. Every
 * function here computes exclusively via UTC getters/setters (never local
 * `Date` getters/setters, and callers must bind results as ISO strings, never
 * raw `Date` objects) — see `docs/phases/phase-0-foundation.md` for why.
 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a UTC calendar date (1-indexed month) as YYYY-MM-DD. `Date.UTC`
 * normalizes overflow/underflow (e.g. month 0 -> prior December, day 0 ->
 * last day of prior month), which callers below rely on for month/day
 * arithmetic.
 */
export function toIsoDate(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Today's date as YYYY-MM-DD, computed in UTC so it's the same regardless of server timezone. */
export function todayIso(): string {
  const now = new Date();
  return toIsoDate(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
  );
}

/** Returns an ISO start date for a dateRange keyword, via UTC calendar arithmetic. */
export function getStartDateForRange(
  dateRange: string,
  todayIsoStr: string = todayIso(),
): string | undefined {
  const [y, m, d] = todayIsoStr.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  switch (dateRange) {
    case '1m':
      return toIsoDate(y, m - 1, d);
    case '3m':
      return toIsoDate(y, m - 3, d);
    case '6m':
      return toIsoDate(y, m - 6, d);
    case '1y':
      return toIsoDate(y - 1, m, d);
    default:
      return undefined;
  }
}

/**
 * The immediately-preceding period of the same length (inclusive day count)
 * as [from, to] — used by `compare_periods` ("how does this month compare to
 * last month"). Deliberately a fixed-length shift rather than a calendar-
 * month-aware one: comparing a partial "this month" (e.g. the 1st-5th)
 * against the equivalent 5 days just before it is a fairer like-for-like
 * comparison than against the full previous calendar month would be.
 */
export function previousPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  const lengthDays = Math.round((toMs - fromMs) / 86_400_000) + 1;

  return {
    from: toIsoDate(fy, fm, fd - lengthDays),
    to: toIsoDate(fy, fm, fd - 1),
  };
}

export function dateRangeFromRelative(
  relative: FinanceChatRelative,
  todayIsoStr: string,
): { from: string; to: string } {
  const [y, m, d] = todayIsoStr.split('-').map(Number) as [
    number,
    number,
    number,
  ];

  switch (relative) {
    case 'this_month':
      return { from: `${y}-${pad2(m)}-01`, to: todayIsoStr };
    case 'last_month':
      return { from: toIsoDate(y, m - 1, 1), to: toIsoDate(y, m, 0) };
    case 'last_7_days':
      return { from: toIsoDate(y, m, d - 6), to: todayIsoStr };
    case 'last_30_days':
      return { from: toIsoDate(y, m, d - 29), to: todayIsoStr };
    case 'this_year':
      return { from: `${y}-01-01`, to: todayIsoStr };
    case 'all':
    default:
      return { from: '1970-01-01', to: todayIsoStr };
  }
}
