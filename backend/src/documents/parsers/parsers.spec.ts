import { HDFCParser } from './hdfc.parser';
import { ICICIParser } from './icici.parser';
import { HSBCParser } from './hsbc.parser';
import { UCOParser } from './uco.parser';
import { PNBParser } from './pnb.parser';
import { AxisParser } from './axis.parser';
import { BankParser } from './bank-parser.interface';

/**
 * ICICI/HSBC/UCO/PNB/Axis are stub parsers today (see docs/BUGS.md #1 and
 * docs/phases/phase-2-bank-parsers.md) — `parse()` always returns `[]`
 * regardless of input. These tests document and pin that current behavior
 * (so a future accidental change is caught), not "correct" parsing.
 */
describe.each([
  {
    Parser: ICICIParser,
    name: 'ICICI Bank',
    matches: ['icici bank statement'],
    nonMatches: ['hdfc bank'],
  },
  {
    Parser: HSBCParser,
    name: 'HSBC Bank',
    matches: ['hsbc bank statement', 'plain hsbc mention'],
    nonMatches: ['icici bank'],
  },
  {
    Parser: UCOParser,
    name: 'UCO Bank',
    matches: ['uco bank statement'],
    nonMatches: ['icici bank'],
  },
  {
    Parser: PNBParser,
    name: 'Punjab National Bank (PNB)',
    matches: ['punjab national bank statement', 'pnb account summary'],
    nonMatches: ['icici bank'],
  },
  {
    Parser: AxisParser,
    name: 'Axis Bank',
    matches: ['axis bank statement'],
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
