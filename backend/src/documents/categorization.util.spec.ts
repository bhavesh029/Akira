import { categorizeTransaction } from './categorization.util';

describe('categorizeTransaction', () => {
  it('returns "Other" for an undefined or empty description', () => {
    expect(categorizeTransaction(undefined, 'DEBIT')).toBe('Other');
    expect(categorizeTransaction('   ', 'DEBIT')).toBe('Other');
  });

  it('categorizes a UPI street-vendor payment with no recognizable business name as a Transfer', () => {
    expect(
      categorizeTransaction(
        'UPI/RADHAGOVIN/q390546230@ybl/UPI/YES BANK/RADHAGOVINDJUICECORNER',
        'DEBIT',
      ),
    ).toBe('Transfer');
  });

  it('categorizes sending money to a friend (UPI debit, no merchant match) as a Transfer', () => {
    expect(
      categorizeTransaction(
        'UPI/DEEPAK KUM/deepak.chouhan/UPI/Punjab Nat',
        'DEBIT',
      ),
    ).toBe('Transfer');
  });

  it('categorizes borrowing money from a friend (UPI credit, no merchant match) as a Transfer', () => {
    expect(
      categorizeTransaction(
        'UPI/BHAVESH CH/chouhanbhavesh/UPI/UCO BANK',
        'CREDIT',
      ),
    ).toBe('Transfer');
  });

  it('categorizes a petrol pump payment as Fuel', () => {
    expect(categorizeTransaction('INDIAN OIL PETROL PUMP', 'DEBIT')).toBe(
      'Fuel',
    );
  });

  it('categorizes a restaurant payment as Food & Dining', () => {
    expect(categorizeTransaction('SWIGGY ORDER 12345', 'DEBIT')).toBe(
      'Food & Dining',
    );
    expect(categorizeTransaction('TAJ RESTAURANT BIKANER', 'DEBIT')).toBe(
      'Food & Dining',
    );
  });

  it('categorizes an EMI/installment debit as EMI & Loans', () => {
    expect(
      categorizeTransaction('EMI PRINCIPAL - 4/6, REF# 72824699', 'DEBIT'),
    ).toBe('EMI & Loans');
    expect(
      categorizeTransaction('ACH/UCBA.../TP ACH PAYUFINANCEIN', 'DEBIT'),
    ).toBe('EMI & Loans');
  });

  it('distinguishes bank-paid interest (Interest Income) from EMI interest charges (EMI & Loans)', () => {
    expect(
      categorizeTransaction(
        '669801700903:Int.Pd:31-12-2025 to 29-03-2026',
        'CREDIT',
      ),
    ).toBe('Interest Income');
    expect(
      categorizeTransaction('EMI INTEREST - 4/6, REF# 72824699', 'DEBIT'),
    ).toBe('EMI & Loans');
  });

  it('categorizes a salary credit as Salary & Income', () => {
    expect(
      categorizeTransaction(
        'NET BANKING INF/000176804121/Salary-Mar 2026',
        'CREDIT',
      ),
    ).toBe('Salary & Income');
  });

  it('categorizes a credit card bill payment as Credit Card Payment, even via Amazon Pay', () => {
    expect(
      categorizeTransaction('Amazon Pay Credit Card Bill Payments', 'DEBIT'),
    ).toBe('Credit Card Payment');
    expect(
      categorizeTransaction(
        'BIL/INFT/001184930729/CC BillPay-3006/Self',
        'DEBIT',
      ),
    ).toBe('Credit Card Payment');
  });

  it('categorizes plain Amazon shopping (not Amazon Pay) as Shopping', () => {
    expect(categorizeTransaction('AMAZON.IN ORDER 123', 'DEBIT')).toBe(
      'Shopping',
    );
  });

  it('categorizes a mobile recharge / utility payment as Utilities & Recharge', () => {
    expect(categorizeTransaction('RELIANCE JIO INFOCOMM', 'DEBIT')).toBe(
      'Utilities & Recharge',
    );
  });

  it('categorizes a mutual fund / investment platform payment as Investments', () => {
    expect(categorizeTransaction('Paytm Money Limited', 'DEBIT')).toBe(
      'Investments',
    );
  });

  it('categorizes a cash deposit as Cash', () => {
    expect(
      categorizeTransaction('ICICI CRM CAM/68521HHR/CASH DEP-Other', 'CREDIT'),
    ).toBe('Cash');
  });

  it('categorizes a bank fee line as Fees & Charges', () => {
    expect(categorizeTransaction('CashDep Chgs 01-31MAR26+GST', 'DEBIT')).toBe(
      'Fees & Charges',
    );
  });

  it('falls back to "Other" for a non-UPI, non-keyword-matching description', () => {
    expect(categorizeTransaction('MISC JOURNAL ENTRY 48213', 'DEBIT')).toBe(
      'Other',
    );
  });
});
