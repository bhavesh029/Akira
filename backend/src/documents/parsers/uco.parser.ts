import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';
import { resolveAmountAndType, parseAmount } from './balance-delta.util';

const TRANSACTION_RE =
  /^(\d{2}-\d{2}-\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/;

// The opening balance only survives text extraction inside the jumbled
// "Transaction Summary" footer, where column labels and values end up on
// separate lines but in the same order — the first value listed is always
// the opening balance.
const OPENING_BALANCE_RE = /Transaction Summary\s*\n\s*([\d,]+\.\d{2})/i;

export class UCOParser implements BankParser {
  getBankName(): string {
    return 'UCO Bank';
  }

  canParse(text: string): boolean {
    // "UCO Bank" as printed text is often part of a letterhead/logo image
    // that doesn't survive PDF text extraction — a real statement's
    // extracted text can be entirely missing the literal bank name (see
    // docs/BUGS.md). UCO's IFSC prefix "UCBA" is unique to UCO Bank (RBI
    // bank-code allocation) and always survives extraction as plain text
    // inside the account's IFSC code (e.g. "UCBA0000573"), so it's checked
    // as a second, independent signal.
    const lower = text.toLowerCase();
    return lower.includes('uco bank') || /\bucba0\d{6}\b/.test(lower);
  }

  /**
   * UCO's savings-account layout, like ICICI's, loses its debit/credit
   * column labels in text extraction — each line ends with two bare decimal
   * numbers (amount, running balance) whose left-to-right order isn't even
   * consistent line-to-line in practice, so both are resolved against the
   * running balance rather than assumed — see balance-delta.util.ts.
   */
  parse(text: string): ExtractedTransaction[] {
    const openingMatch = text.match(OPENING_BALANCE_RE);
    if (!openingMatch) {
      // Without a known starting balance there's no way to resolve which of
      // a line's two bare numbers is the amount vs. the running balance, or
      // what type a transaction is — report nothing rather than guess, and
      // let the caller fall back to Gemini (extraction.service.ts already
      // does this for any parser that returns zero transactions).
      return [];
    }

    const transactions: ExtractedTransaction[] = [];
    let prevBalance = parseAmount(openingMatch[1]);

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(TRANSACTION_RE);
      if (!match) continue;

      const [, dateStr, description, numAStr, numBStr] = match;
      const [dd, mm, yyyy] = dateStr.split('-');
      const numA = parseAmount(numAStr);
      const numB = parseAmount(numBStr);

      const resolved = resolveAmountAndType(prevBalance, numA, numB);
      if (!resolved) continue; // doesn't reconcile under any interpretation — skip

      transactions.push({
        transaction_date: `${yyyy}-${mm}-${dd}`,
        description: description.trim(),
        amount: resolved.amount,
        type: resolved.type,
        category: 'Other',
      });
      prevBalance = resolved.balance;
    }

    return transactions;
  }
}
