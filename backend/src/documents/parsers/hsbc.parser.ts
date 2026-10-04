import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';
import { parseAmount } from './balance-delta.util';

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

// e.g. "20 AUG 2026 To 19 SEP 2026" — the billing cycle, used to recover the
// year for each transaction's "DDMMM" date (no year survives per-line).
const STATEMENT_PERIOD_RE =
  /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+To\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/i;

// "05SEP\t<description...>\t<amount>[\tCR]" — a trailing "CR" marks a
// credit/refund; its absence means a purchase (debit). Fields are
// tab-separated in the extracted text.
const DATE_FIELD_RE = /^(\d{2})([A-Za-z]{3})$/;

export class HSBCParser implements BankParser {
  getBankName(): string {
    return 'HSBC Bank';
  }

  canParse(text: string): boolean {
    return (
      text.toLowerCase().includes('hsbc bank') ||
      text.toLowerCase().includes('hsbc')
    );
  }

  /**
   * Handles HSBC's credit-card statement layout (confirmed against a real
   * sample). A savings/current-account HSBC statement would have a
   * completely different layout — if one is ever uploaded, this parser is
   * expected to match zero lines and return [], which triggers the existing
   * Gemini fallback in extraction.service.ts rather than silently misparsing.
   */
  parse(text: string): ExtractedTransaction[] {
    const yearByMonth = this.resolveYearByMonth(text);
    const transactions: ExtractedTransaction[] = [];

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const fields = line
        .split('\t')
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
      if (fields.length < 2) continue;

      const dateMatch = fields[0].match(DATE_FIELD_RE);
      if (!dateMatch) continue;

      const [, dayStr, monthStr] = dateMatch;
      const month = monthStr.toUpperCase();
      if (!MONTHS.includes(month)) continue;

      // fields[0] is the "DDMMM" date token; drop it, keep the rest (always
      // non-empty here — the fields.length < 2 check above guarantees it).
      const rest = fields.slice(1);

      const isCredit = rest[rest.length - 1].toUpperCase() === 'CR';
      const amountField = isCredit
        ? rest[rest.length - 2]
        : rest[rest.length - 1];
      if (!amountField || !/^[\d,]+\.\d{2}$/.test(amountField)) continue;

      const descriptionFields = isCredit
        ? rest.slice(0, rest.length - 2)
        : rest.slice(0, rest.length - 1);

      const year = yearByMonth.get(month);
      if (!year) continue; // date falls outside the known statement period

      const monthNum = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
      const day = dayStr.padStart(2, '0');

      transactions.push({
        transaction_date: `${year}-${monthNum}-${day}`,
        description: descriptionFields.join(' ').trim() || undefined,
        amount: parseAmount(amountField),
        type: isCredit ? 'CREDIT' : 'DEBIT',
        category: 'Other',
      });
    }

    return transactions;
  }

  private resolveYearByMonth(text: string): Map<string, number> {
    const map = new Map<string, number>();
    const match = text.match(STATEMENT_PERIOD_RE);
    if (!match) return map;

    const [, , startMonth, startYear, , endMonth, endYear] = match;
    map.set(startMonth.toUpperCase(), parseInt(startYear, 10));
    map.set(endMonth.toUpperCase(), parseInt(endYear, 10));
    return map;
  }
}
