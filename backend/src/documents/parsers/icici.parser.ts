import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';
import { resolveAmountAndType, parseAmount } from './balance-delta.util';

// Structural noise that repeats on every page of an ICICI statement export
// and carries no transaction data — skipped so it never pollutes an
// accumulated multi-line description.
const SKIP_LINE_PATTERNS = [
  /^Page \d+ of\s*\d+$/i,
  /^--\s*\d+\s*of\s*\d+\s*--$/,
  /^DATE\s+MODE\*\*\s+PARTICULARS/i,
  /^ACCOUNT (DETAILS|TYPE)/i,
  /^TOTAL\b/i,
  /^Summary of Accounts/i,
  /^Statement of Transactions/i,
  /^Your Base Branch/i,
  /^Visit www\./i,
  /^Dial your Bank/i,
  /^(MR|MRS|MS|M\/S)\.?\s*[A-Z][A-Z ]*$/,
  /^(Savings|Current)\s+A\/c\b/i,
];

const OPENING_BALANCE_RE = /^(\d{2}-\d{2}-\d{4})\s+B\/F\s+([\d,]+\.\d{2})\s*$/i;
const DATE_PREFIX_RE = /^(\d{2}-\d{2}-\d{4})\s*(.*)$/;
const TRAILING_AMOUNTS_RE = /(.*?)([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/;

export class ICICIParser implements BankParser {
  getBankName(): string {
    return 'ICICI Bank';
  }

  canParse(text: string): boolean {
    return text.toLowerCase().includes('icici bank');
  }

  /**
   * ICICI's savings-account layout wraps a transaction's narration across
   * several lines; only the final line carries the amount + running balance
   * (no separate debit/credit column survives text extraction), so the two
   * trailing numbers must be resolved against the running balance — see
   * balance-delta.util.ts.
   */
  parse(text: string): ExtractedTransaction[] {
    const transactions: ExtractedTransaction[] = [];
    const lines = text.split('\n');

    let prevBalance: number | null = null;
    let currentDate: string | null = null;
    let pendingDescription: string[] = [];

    const flushSkipped = () => {
      pendingDescription = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (SKIP_LINE_PATTERNS.some((re) => re.test(line))) continue;

      const openingMatch = line.match(OPENING_BALANCE_RE);
      if (openingMatch) {
        prevBalance = parseAmount(openingMatch[2]);
        flushSkipped(); // discard any header/boilerplate accumulated before B/F
        continue;
      }

      let working = line;
      const dateMatch = working.match(DATE_PREFIX_RE);
      if (dateMatch) {
        const [dd, mm, yyyy] = dateMatch[1].split('-');
        currentDate = `${yyyy}-${mm}-${dd}`;
        working = dateMatch[2];
      }

      const trailingMatch = working.match(TRAILING_AMOUNTS_RE);
      if (!trailingMatch) {
        if (working) pendingDescription.push(working);
        continue;
      }

      const [, descFragment, numAStr, numBStr] = trailingMatch;
      if (descFragment.trim()) pendingDescription.push(descFragment.trim());

      if (prevBalance === null || currentDate === null) {
        // No opening balance / date context yet — can't resolve this line
        // safely, so don't report a possibly-wrong transaction.
        flushSkipped();
        continue;
      }

      const resolved = resolveAmountAndType(
        prevBalance,
        parseAmount(numAStr),
        parseAmount(numBStr),
      );

      if (!resolved) {
        // Doesn't reconcile against the running balance under any
        // interpretation — skip rather than guess (see balance-delta.util.ts).
        flushSkipped();
        continue;
      }

      transactions.push({
        transaction_date: currentDate,
        description: pendingDescription.join(' ').trim() || undefined,
        amount: resolved.amount,
        type: resolved.type,
        category: 'Other',
      });

      prevBalance = resolved.balance;
      pendingDescription = [];
    }

    return transactions;
  }
}
