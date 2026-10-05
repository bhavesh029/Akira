/**
 * Deterministic, keyword-based transaction categorization.
 *
 * This runs the same way regardless of which bank parser (or Gemini) did the
 * extraction — one consistent category scheme across every bank, and it
 * works even when the Gemini API is unavailable (unlike LLM-guessed
 * categories, which depend on a live, billed API call).
 *
 * It is NOT 100% accurate — no amount of keyword matching on free-text bank
 * narrations can be, since an unknown UPI handle or a generic vendor name
 * carries no reliable signal. What it does guarantee: every rule below is
 * grounded in patterns actually observed in real statement samples (see
 * docs/BUGS.md #1), and anything that looks like a person-to-person UPI
 * payment (sending/receiving money with a friend, a street vendor with no
 * recognizable business name, etc.) falls into "Transfer" rather than the
 * meaningless "Other" bucket. Any transaction can still be corrected by hand
 * via PATCH /transactions/:id — that's the actual path to 100% for the
 * unavoidable edge cases.
 */

export type CategorizationType = 'CREDIT' | 'DEBIT';

interface CategoryRule {
  category: string;
  test: (description: string, type: CategorizationType) => boolean;
}

const RULES: CategoryRule[] = [
  {
    category: 'Interest Income',
    test: (d, t) =>
      t === 'CREDIT' && /int\.?\s*pd\b|interest\s*(paid|credit)/i.test(d),
  },
  {
    category: 'Salary & Income',
    test: (d, t) => t === 'CREDIT' && /\bsalary\b/i.test(d),
  },
  {
    category: 'EMI & Loans',
    test: (d) =>
      /\bemi\b|installment|instalment|\bloan\b|payufinance|incred\s*financial/i.test(
        d,
      ),
  },
  {
    category: 'Credit Card Payment',
    test: (d) =>
      /\bcc\s*billpay\b|\bcred\s*club\b|\bcred\s*store\b|\bonecard\b|amazon\s*pay.*(credit\s*card|bill)|credit\s*card.*bill/i.test(
        d,
      ),
  },
  {
    category: 'Investments',
    test: (d) =>
      /mutual\s*fund|paytm\s*money|zerodha|groww|\bsip\b|upstox|kuvera/i.test(
        d,
      ),
  },
  {
    category: 'Insurance',
    test: (d) => /\blic\b|insurance|premium/i.test(d),
  },
  {
    category: 'Entertainment & Subscriptions',
    test: (d) =>
      /netflix|prime\s*video|spotify|hotstar|apple\s*media|google\s*ind.*digital|bookmyshow/i.test(
        d,
      ),
  },
  {
    category: 'Utilities & Recharge',
    test: (d) =>
      /airtel|\bjio\b|vodafone|\bvi\b|bbps|recharge|broadband|air\s*fiber|electricity|water\s*bill|gas\s*bill|\bdth\b/i.test(
        d,
      ),
  },
  {
    category: 'Shopping',
    test: (d) => /amazon(?!\s*pay)|flipkart|myntra|\bajio\b|nykaa/i.test(d),
  },
  {
    category: 'Groceries',
    test: (d) => /blinkit|zepto|bigbasket|instamart|\bgrocery\b/i.test(d),
  },
  {
    category: 'Food & Dining',
    test: (d) =>
      /swiggy|zomato|restaurant|\bcafe\b|\bhotel\b|ice\s*cream|food\s*products|\bfoods\b|dhaba|bakery/i.test(
        d,
      ),
  },
  {
    category: 'Fuel',
    test: (d) =>
      /\bpetrol\b|\bfuel\b|indian\s*oil|bharat\s*petroleum|\bhp\s*petrol|\bshell\b|\biocl\b/i.test(
        d,
      ),
  },
  {
    category: 'Transport',
    test: (d) =>
      /\buber\b|\bola\b|rapido|irctc|\bmetro\b|airlines|indigo|spicejet|redbus/i.test(
        d,
      ),
  },
  {
    category: 'Rent & Housing',
    test: (d) =>
      /\brent\b|rentomojo|landlord|housing\s*society|maintenance\s*charge/i.test(
        d,
      ),
  },
  {
    category: 'Healthcare',
    test: (d) =>
      /pharmacy|hospital|clinic|apollo|practo|medicos|medical/i.test(d),
  },
  {
    category: 'Education',
    test: (d) => /\bschool\b|tuition|coaching|\bcollege\b|university/i.test(d),
  },
  {
    // Checked before "Cash" below — a fee line like "CashDep Chgs" contains
    // "cash dep" but is a service charge, not an actual cash deposit.
    category: 'Fees & Charges',
    test: (d) =>
      /\bchgs\b|\bcharges\b|\bpenalty\b|late\s*fee|^gst$|\bgst\b.*assessment/i.test(
        d,
      ),
  },
  {
    category: 'Cash',
    test: (d) => /cash\s*dep|\batm\b|crm\s*cam|cash\s*withdrawal/i.test(d),
  },
  {
    category: 'Transfer',
    test: (d) => /^upi\/|^mpay\/upi|^mpay\/trtr/i.test(d.trim()),
  },
];

export function categorizeTransaction(
  description: string | undefined,
  type: CategorizationType,
): string {
  const d = (description ?? '').trim();
  if (!d) return 'Other';

  for (const rule of RULES) {
    if (rule.test(d, type)) return rule.category;
  }
  return 'Other';
}
