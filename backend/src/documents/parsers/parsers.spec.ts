import { HDFCParser } from './hdfc.parser';
import { ICICIParser } from './icici.parser';
import { HSBCParser } from './hsbc.parser';
import { UCOParser } from './uco.parser';
import { PNBParser } from './pnb.parser';
import { AxisParser } from './axis.parser';
import { BankParser } from './bank-parser.interface';

/**
 * PNB is still a stub parser (see docs/BUGS.md #1 and
 * docs/phases/phase-2-bank-parsers.md) — `parse()` always returns `[]`
 * regardless of input, pending a real sample statement. ICICI, HSBC, UCO and
 * Axis were hardened against real sample statements — see their dedicated
 * describe blocks below.
 */
describe.each([
  {
    Parser: PNBParser,
    name: 'Punjab National Bank (PNB)',
    matches: ['punjab national bank statement', 'pnb account summary'],
    nonMatches: ['icici bank'],
  },
])('$Parser.name (stub parser)', ({ Parser, name, matches, nonMatches }) => {
  const parser: BankParser = new Parser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe(name);
  });

  it.each(matches)('canParse matches %p (case-insensitively)', (text) => {
    expect(parser.canParse(text)).toBe(true);
    expect(parser.canParse(text.toUpperCase())).toBe(true);
  });

  it.each(nonMatches)('canParse rejects %p', (text) => {
    expect(parser.canParse(text)).toBe(false);
  });

  it('parse() always returns an empty array (stub — not yet implemented)', () => {
    expect(parser.parse('any statement text at all, even a real one')).toEqual(
      [],
    );
    expect(parser.parse('')).toEqual([]);
  });
});

describe('HDFCParser', () => {
  const parser = new HDFCParser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe('HDFC Bank');
  });

  it('canParse matches "hdfc bank" or "hdfcbank" case-insensitively', () => {
    expect(parser.canParse('HDFC Bank Statement')).toBe(true);
    expect(parser.canParse('welcome to hdfcbank net banking')).toBe(true);
  });

  it('canParse rejects unrelated text', () => {
    expect(parser.canParse('ICICI Bank Statement')).toBe(false);
  });

  it('extracts a DEBIT transaction from a matching line (withdrawal column present)', () => {
    const result = parser.parse(
      '01/03/26 Amazon Purchase 1,500.00 0.00 25,000.00',
    );
    expect(result).toEqual([
      {
        transaction_date: '2026-03-01',
        description: 'Amazon Purchase',
        amount: 1500,
        type: 'DEBIT',
        category: 'Other',
      },
    ]);
  });

  it('extracts a CREDIT transaction when the withdrawal column is absent (double space before the amount)', () => {
    const result = parser.parse('02/03/26 Salary Credit  50,000.00 75,000.00');
    expect(result).toEqual([
      {
        transaction_date: '2026-03-02',
        description: 'Salary Credit',
        amount: 50000,
        type: 'CREDIT',
        category: 'Other',
      },
    ]);
  });

  it('formats a 4-digit year without prefixing "20"', () => {
    const result = parser.parse(
      '03/03/2026 ATM Withdrawal 500.00 0.00 9,500.00',
    );
    expect(result[0].transaction_date).toBe('2026-03-03');
  });

  it('strips comma thousands-separators from amounts', () => {
    const result = parser.parse(
      '01/03/26 Big Purchase 12,345.67 0.00 1,00,000.00',
    );
    expect(result[0].amount).toBe(12345.67);
  });

  it('ignores lines that do not match the expected column layout', () => {
    const result = parser.parse(
      'This is a header line\nAccount Number: 1234\nStatement Period: March 2026',
    );
    expect(result).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parser.parse('')).toEqual([]);
  });

  it('processes multiple lines, extracting only the ones that match', () => {
    const text = [
      'HDFC BANK STATEMENT',
      'Date       Narration        Withdrawal   Deposit   Balance',
      '01/03/26 Amazon Purchase 1,500.00 0.00 25,000.00',
      'not a transaction line',
      '02/03/26 Salary Credit  50,000.00 75,000.00',
    ].join('\n');

    const result = parser.parse(text);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('DEBIT');
    expect(result[1].type).toBe('CREDIT');
  });
});

/**
 * ICICI's savings-account layout wraps narration across multiple lines and
 * only the final line carries two bare decimal numbers (amount + running
 * balance, no column label survives text extraction) — see
 * balance-delta.util.ts. Shapes below mirror a real statement's structure
 * (verified against an actual sample — see docs/BUGS.md #1).
 */
describe('ICICIParser', () => {
  const parser = new ICICIParser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe('ICICI Bank');
  });

  it('canParse matches "icici bank" case-insensitively', () => {
    expect(parser.canParse('ICICI Bank Statement')).toBe(true);
    expect(parser.canParse('hdfc bank')).toBe(false);
  });

  const statementText = [
    'MHW1/181D/1-1/WBF-M/03-12',
    '669801700903??TEST1234 000001',
    'MR.TEST USER',
    'TEST ADDRESS LINE',
    'Savings A/c 123456789012 10,000.00 0.00 10,000.00 Registered',
    'TOTAL 10,000.00 0.00 10,000.00',
    'Statement of Transactions in Savings Account Number: 123456789012',
    'DATE MODE** PARTICULARS DEPOSITS WITHDRAWALS BALANCE',
    '01-01-2026 B/F 5,000.00',
    '02-01-2026',
    'UPI/MERCHANT A/merchanta@bank/payment/AXIS',
    'BANK/123456789/some reference',
    '1,000.00 4,000.00',
    '03-01-2026 SALARY CREDIT FROM EMPLOYER  10,000.00 14,000.00',
    'Page 1 of2',
    '-- 1 of 2 --',
    'MR.TEST USER',
    'DATE MODE** PARTICULARS DEPOSITS WITHDRAWALS BALANCE',
    '04-01-2026 UNRECONCILABLE NOISE LINE 999.00 999.00',
    '05-01-2026 ATM WITHDRAWAL  2,000.00 12,000.00',
  ].join('\n');

  it('ignores every line before B/F (header/account-summary boilerplate)', () => {
    const result = parser.parse(statementText);
    expect(result[0].description).not.toContain('MHW1');
    expect(result[0].description).not.toContain('TEST ADDRESS');
  });

  it('joins a multi-line wrapped narration into one description', () => {
    const result = parser.parse(statementText);
    expect(result[0]).toEqual({
      transaction_date: '2026-01-02',
      description:
        'UPI/MERCHANT A/merchanta@bank/payment/AXIS BANK/123456789/some reference',
      amount: 1000,
      type: 'DEBIT',
      category: 'Other',
    });
  });

  it('parses a single-line transaction (date, narration and amounts all on one line)', () => {
    const result = parser.parse(statementText);
    expect(result[1]).toEqual({
      transaction_date: '2026-01-03',
      description: 'SALARY CREDIT FROM EMPLOYER',
      amount: 10000,
      type: 'CREDIT',
      category: 'Other',
    });
  });

  it('skips a line whose two trailing numbers do not reconcile against the running balance, without corrupting later lines', () => {
    const result = parser.parse(statementText);
    expect(result).toHaveLength(3);
    expect(result.some((t) => t.description?.includes('UNRECONCILABLE'))).toBe(
      false,
    );
    // The next valid line must still resolve correctly against the last
    // known-good balance (14,000), proving the skip didn't desync tracking.
    expect(result[2]).toEqual({
      transaction_date: '2026-01-05',
      description: 'ATM WITHDRAWAL',
      amount: 2000,
      type: 'DEBIT',
      category: 'Other',
    });
  });

  it('returns an empty array when there is no B/F opening-balance line to anchor against', () => {
    expect(
      parser.parse('some unrelated icici bank text with no B/F line'),
    ).toEqual([]);
  });

  it('skips a transaction-shaped line encountered before any B/F opening-balance line has been seen', () => {
    const result = parser.parse(
      '02-01-2026 SOME DESC BEFORE OPENING BALANCE 100.00 200.00\n01-01-2026 B/F 5,000.00',
    );
    expect(result).toEqual([]);
  });
});

/**
 * UCO's savings-account layout has the same lost-column problem as ICICI's,
 * but each transaction is a single line and the opening balance is recovered
 * from the (jumbled) "Transaction Summary" footer instead of a "B/F" line —
 * see balance-delta.util.ts and docs/BUGS.md #1.
 */
describe('UCOParser', () => {
  const parser = new UCOParser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe('UCO Bank');
  });

  it('canParse matches "uco bank" case-insensitively', () => {
    expect(parser.canParse('UCO Bank Statement')).toBe(true);
    expect(parser.canParse('icici bank')).toBe(false);
  });

  it('canParse also matches via the UCBA IFSC prefix, when the literal bank name is absent (found via a real user report, docs/BUGS.md)', () => {
    // A real statement's letterhead (where "UCO Bank" is printed) is often a
    // logo image that doesn't survive PDF text extraction — the IFSC code
    // inside the account details table is plain text and does survive, and
    // "UCBA" is RBI-allocated to UCO Bank specifically.
    expect(
      parser.canParse('Account No. 05730110085585 IFSC Code UCBA0000573'),
    ).toBe(true);
    expect(parser.canParse('ifsc code ucba0001234 branch: test')).toBe(true);
  });

  it('canParse does not match an unrelated IFSC prefix', () => {
    expect(parser.canParse('IFSC Code HDFC0001234')).toBe(false);
  });

  it('resolves amount/type against the running balance and reconciles exactly to the closing balance', () => {
    const statementText = [
      'Transaction Summary',
      '500.00',
      'Closing Balance 1,300.00',
      'Opening Balance',
      '17-01-2026 MPAY/UPI/TRTR/111111111111/TESTUSER/ICIC/XXX 100.00 400.00',
      '18-01-2026 Int.Pd:01-01-2026 to 17-01-2026 50.00 450.00',
      '19-01-2026 MPAY/TRTR/222222222222/transfer in/MBS 1,000.00 1,450.00',
      '20-01-2026 MPAY/UPI/TRTR/333333333333/transfer out/ICIC/XXX 150.00 1,300.00',
    ].join('\n');

    const result = parser.parse(statementText);

    expect(result).toEqual([
      expect.objectContaining({
        transaction_date: '2026-01-17',
        amount: 100,
        type: 'DEBIT',
      }),
      expect.objectContaining({
        transaction_date: '2026-01-18',
        amount: 50,
        type: 'CREDIT',
      }),
      expect.objectContaining({
        transaction_date: '2026-01-19',
        amount: 1000,
        type: 'CREDIT',
      }),
      expect.objectContaining({
        transaction_date: '2026-01-20',
        amount: 150,
        type: 'DEBIT',
      }),
    ]);

    const finalBalance =
      500 +
      result.reduce(
        (bal, t) => (t.type === 'CREDIT' ? bal + t.amount : bal - t.amount),
        0,
      );
    expect(finalBalance).toBeCloseTo(1300, 2);
  });

  it('returns an empty array when the opening balance cannot be found', () => {
    expect(
      parser.parse('uco bank statement with no transaction summary footer'),
    ).toEqual([]);
  });

  it('skips blank lines and a line whose two numbers do not reconcile, without corrupting the running balance', () => {
    const statementText = [
      'Transaction Summary',
      '500.00',
      '',
      '17-01-2026 MPAY/UPI/TRTR/111111111111/TESTUSER/ICIC/XXX 100.00 400.00',
      '18-01-2026 UNRECONCILABLE LINE 999.00 1.00',
      '19-01-2026 MPAY/TRTR/222222222222/transfer in/MBS 1,000.00 1,400.00',
    ].join('\n');

    const result = parser.parse(statementText);

    expect(result).toEqual([
      expect.objectContaining({ transaction_date: '2026-01-17', amount: 100 }),
      expect.objectContaining({ transaction_date: '2026-01-19', amount: 1000 }),
    ]);
  });

  it('end-to-end: matches and parses a realistic letterhead-less statement (IFSC-only bank identification, no literal "UCO Bank" text) and reconciles exactly to the statement\'s own printed totals', () => {
    // Mirrors the structure of a real UCO statement sample (redacted/
    // reconstructed, not committed verbatim — see docs/BUGS.md): the bank
    // name never appears as text (letterhead logo), the account details
    // table is the only source of the IFSC code, and the footer repeats the
    // deposit/withdrawal/closing-balance totals in a jumbled label/value
    // order next to the opening balance.
    const statementText = [
      'Name',
      'Address',
      'Customer ID',
      'Branch Name',
      'IFSC Code',
      '05730110085585	Account No.',
      'UCBA0000573',
      'Date Particulars Withdrawals Deposits Balance	Chq. No.',
      '17-12-2025 MPAY/UPI/TRTR/111111111111/TESTUSER/ICIC/XXX 220.00 2.82',
      '21-12-2025 05730110085585:Int.Pd:24-09-2025 to 20-12-2025 12.82	10.00',
      '25-12-2025 MPAY/TRTR/222222222222/25-12-2025 19:54:13/MBS 11,012.82	11,000.00',
      'Transaction Summary',
      '222.82',
      'Closing Balance 11,012.82',
      'Opening Balance',
      'Add : Deposits',
      'Less : Withdrawals',
      '11,010.00	2',
      '220.00	1',
      'No. of Transaction Value of Transactions',
    ].join('\n');

    expect(parser.canParse(statementText)).toBe(true);

    const result = parser.parse(statementText);
    expect(result).toEqual([
      expect.objectContaining({
        transaction_date: '2025-12-17',
        amount: 220,
        type: 'DEBIT',
      }),
      expect.objectContaining({
        transaction_date: '2025-12-21',
        amount: 10,
        type: 'CREDIT',
      }),
      expect.objectContaining({
        transaction_date: '2025-12-25',
        amount: 11000,
        type: 'CREDIT',
      }),
    ]);

    const credits = result
      .filter((t) => t.type === 'CREDIT')
      .reduce((s, t) => s + t.amount, 0);
    const debits = result
      .filter((t) => t.type === 'DEBIT')
      .reduce((s, t) => s + t.amount, 0);
    expect(222.82 + credits - debits).toBeCloseTo(11012.82, 2);
  });
});

/**
 * HSBC's credit-card layout is tab-separated with a trailing "CR" marker for
 * credits/refunds (absent = a purchase/debit) and no year on each line's
 * date — the year is recovered from the statement period printed elsewhere
 * in the document. Verified against a real sample — see docs/BUGS.md #1.
 */
describe('HSBCParser', () => {
  const parser = new HSBCParser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe('HSBC Bank');
  });

  it('canParse matches "hsbc" case-insensitively', () => {
    expect(parser.canParse('HSBC Bank Statement')).toBe(true);
    expect(parser.canParse('plain hsbc mention')).toBe(true);
    expect(parser.canParse('icici bank')).toBe(false);
  });

  it('parses a debit (no CR marker) and a credit (CR marker), recovering the year from the statement period across a year boundary', () => {
    const statementText = [
      '20 DEC 2025 To 19 JAN 2026',
      '25DEC\tTEST MERCHANT ONE\tCITY\tIN\t500.00',
      '02JAN\tPAYMENT RECEIVED REF123\t1,200.00\tCR',
    ].join('\n');

    const result = parser.parse(statementText);

    expect(result).toEqual([
      {
        transaction_date: '2025-12-25',
        description: 'TEST MERCHANT ONE CITY IN',
        amount: 500,
        type: 'DEBIT',
        category: 'Other',
      },
      {
        transaction_date: '2026-01-02',
        description: 'PAYMENT RECEIVED REF123',
        amount: 1200,
        type: 'CREDIT',
        category: 'Other',
      },
    ]);
  });

  it('returns an empty array when no statement-period line is present to recover the year from', () => {
    expect(parser.parse('05SEP\tSOME MERCHANT\t100.00\nhsbc bank')).toEqual([]);
  });

  it('ignores blank lines, lines with no date field, lines with an invalid month, and lines with a malformed amount', () => {
    const statementText = [
      '20 DEC 2025 To 19 JAN 2026',
      '',
      'TOTAL\tSOME SUMMARY ROW\t1,000.00',
      '05XXX\tINVALID MONTH ROW\t100.00',
      '25DEC\tBAD AMOUNT ROW\tnot-a-number',
      '26DEC\tGOOD ROW\t250.00',
    ].join('\n');

    const result = parser.parse(statementText);

    expect(result).toEqual([
      {
        transaction_date: '2025-12-26',
        description: 'GOOD ROW',
        amount: 250,
        type: 'DEBIT',
        category: 'Other',
      },
    ]);
  });

  it('reports an undefined description for a credit row with no narration text between the date and the amount', () => {
    const statementText = [
      '20 DEC 2025 To 19 JAN 2026',
      '25DEC\t1,200.00\tCR',
    ].join('\n');

    const result = parser.parse(statementText);
    expect(result[0].description).toBeUndefined();
  });
});

/**
 * Axis's credit-card layout is single-line-per-transaction with a trailing
 * "Dr"/"Cr" marker, anchored to start only after the real "Account Summary"
 * table header — the payment-summary block above it contains a date-range
 * row that would otherwise false-positive-match. Verified against a real
 * sample — see docs/BUGS.md #1.
 */
describe('AxisParser', () => {
  const parser = new AxisParser();

  it('returns its bank name', () => {
    expect(parser.getBankName()).toBe('Axis Bank');
  });

  it('canParse matches "axis bank" case-insensitively', () => {
    expect(parser.canParse('Axis Bank Statement')).toBe(true);
    expect(parser.canParse('icici bank')).toBe(false);
  });

  it('ignores the payment-summary date-range row above Account Summary, and parses real transaction rows', () => {
    const statementText = [
      'PAYMENT SUMMARY',
      'Total Payment Due Minimum Payment Due Statement Period Payment Due Date Statement Generation Date',
      '01/01/2026 - 31/01/2026\t15/02/2026\t31/01/2026\t5,000.00 Dr\t1,000.00 Dr',
      'Account Summary',
      'DATE TRANSACTION DETAILS MERCHANT CATEGORY AMOUNT (Rs.)',
      '05/01/2026 TEST MERCHANT ONE CITY 1,500.00 Dr',
      '10/01/2026 PAYMENT RECEIVED REF123 3,500.00 Cr',
    ].join('\n');

    const result = parser.parse(statementText);

    expect(result).toEqual([
      {
        transaction_date: '2026-01-05',
        description: 'TEST MERCHANT ONE CITY',
        amount: 1500,
        type: 'DEBIT',
        category: 'Other',
      },
      {
        transaction_date: '2026-01-10',
        description: 'PAYMENT RECEIVED REF123',
        amount: 3500,
        type: 'CREDIT',
        category: 'Other',
      },
    ]);
  });

  it('returns an empty array for text with no matching transaction lines', () => {
    expect(parser.parse('axis bank statement\nno transactions here')).toEqual(
      [],
    );
  });
});
