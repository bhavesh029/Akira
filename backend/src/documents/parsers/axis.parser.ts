import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';
import { parseAmount } from './balance-delta.util';

// "10/08/2026 BLINKIT,GURGAON DEPT STORES 1,669.50 Dr" — one line per
// transaction, a trailing "Dr"/"Cr" marker instead of a separate column.
const TRANSACTION_RE =
  /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+(Dr|Cr)$/i;

// The payment-summary block above the real transaction table also contains a
// "date range ... amount Dr ... amount Dr" row that coincidentally matches
// TRANSACTION_RE — anchoring on this header (present on every statement)
// skips that block entirely instead of trying to pattern-exclude it.
const ACCOUNT_SUMMARY_HEADER = /Account Summary/i;

export class AxisParser implements BankParser {
  getBankName(): string {
    return 'Axis Bank';
  }

  canParse(text: string): boolean {
    return text.toLowerCase().includes('axis bank');
  }

  /**
   * Handles Axis's credit-card statement layout (confirmed against a real
   * sample). An Axis savings/current-account statement would have a
   * different layout — if one is ever uploaded, this parser is expected to
   * match zero lines and return [], which triggers the existing Gemini
   * fallback in extraction.service.ts rather than silently misparsing.
   */
  parse(text: string): ExtractedTransaction[] {
    const transactions: ExtractedTransaction[] = [];
    const headerMatch = text.match(ACCOUNT_SUMMARY_HEADER);
    const body = headerMatch
      ? text.slice(headerMatch.index! + headerMatch[0].length)
      : text;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(TRANSACTION_RE);
      if (!match) continue;

      const [, dd, mm, yyyy, description, amountStr, marker] = match;

      transactions.push({
        transaction_date: `${yyyy}-${mm}-${dd}`,
        description: description.trim(),
        amount: parseAmount(amountStr),
        type: marker.toUpperCase() === 'CR' ? 'CREDIT' : 'DEBIT',
        category: 'Other',
      });
    }

    return transactions;
  }
}
