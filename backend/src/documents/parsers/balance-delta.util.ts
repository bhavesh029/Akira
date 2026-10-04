/**
 * Several bank statement layouts (ICICI, UCO savings accounts) lose their
 * column labels once run through text extraction: a transaction line ends
 * with two bare decimal numbers — one is the transaction amount, the other
 * is the running balance — with no reliable indication of which is which,
 * and (empirically, across a real UCO statement) not even a consistent
 * left-to-right order.
 *
 * The only reliable signal is arithmetic: whichever number is the balance
 * must equal the previous running balance plus or minus the other number.
 * For a CREDIT, swapping which number is the balance gives two genuinely
 * different equations (`prevBalance + numA = numB` vs. `prevBalance + numB =
 * numA`), so at most one can hold and the correct assignment is unambiguous.
 *
 * For a DEBIT, by contrast, `prevBalance - numA = numB` and `prevBalance -
 * numB = numA` are algebraically the same statement (`prevBalance = numA +
 * numB`), so arithmetic alone cannot tell which of the two numbers is really
 * the amount — both labelings are equally consistent. We resolve this by
 * convention: numA (the first number as it appeared in the source line) is
 * treated as the amount, matching the column order confirmed against every
 * real sample statement seen so far (amount printed before the running
 * balance). A line that matches none of these interpretations is skipped
 * entirely rather than reported with a potentially wrong amount or type.
 */

export interface ResolvedAmount {
  amount: number;
  balance: number;
  type: 'CREDIT' | 'DEBIT';
}

const TOLERANCE = 0.01;

export function resolveAmountAndType(
  prevBalance: number,
  numA: number,
  numB: number,
): ResolvedAmount | null {
  if (Math.abs(prevBalance + numA - numB) < TOLERANCE) {
    return { amount: numA, balance: numB, type: 'CREDIT' };
  }
  if (Math.abs(prevBalance - numA - numB) < TOLERANCE) {
    return { amount: numA, balance: numB, type: 'DEBIT' };
  }
  if (Math.abs(prevBalance + numB - numA) < TOLERANCE) {
    return { amount: numB, balance: numA, type: 'CREDIT' };
  }
  return null;
}

export function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/,/g, ''));
}
