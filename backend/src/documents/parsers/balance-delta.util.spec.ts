import { resolveAmountAndType, parseAmount } from './balance-delta.util';

describe('resolveAmountAndType', () => {
  it('resolves a credit when the first number is the amount and the second is the new balance', () => {
    expect(resolveAmountAndType(1000, 500, 1500)).toEqual({
      amount: 500,
      balance: 1500,
      type: 'CREDIT',
    });
  });

  it('resolves a debit when the first number is the amount and the second is the new balance', () => {
    expect(resolveAmountAndType(1000, 500, 500)).toEqual({
      amount: 500,
      balance: 500,
      type: 'DEBIT',
    });
  });

  it('resolves a credit when the order is reversed (balance first, amount second)', () => {
    expect(resolveAmountAndType(1000, 1500, 500)).toEqual({
      amount: 500,
      balance: 1500,
      type: 'CREDIT',
    });
  });

  it('for an ambiguous debit (numA + numB === prevBalance, so either number could be the amount), treats the first number as the amount by convention', () => {
    // Both "amount=800,balance=200" and "amount=200,balance=800" satisfy
    // prevBalance - amount = balance here — genuinely ambiguous from
    // arithmetic alone (see the module docstring).
    expect(resolveAmountAndType(1000, 800, 200)).toEqual({
      amount: 800,
      balance: 200,
      type: 'DEBIT',
    });
  });

  it('returns null when neither number reconciles against the previous balance under any interpretation', () => {
    expect(resolveAmountAndType(1000, 50, 75)).toBeNull();
  });

  it('tolerates sub-cent rounding noise', () => {
    expect(resolveAmountAndType(1000.005, 500, 1500)).toEqual(
      expect.objectContaining({ type: 'CREDIT' }),
    );
  });
});

describe('parseAmount', () => {
  it('strips comma thousands separators', () => {
    expect(parseAmount('1,23,456.78')).toBe(123456.78);
  });

  it('parses a plain decimal with no separators', () => {
    expect(parseAmount('42.50')).toBe(42.5);
  });
});
