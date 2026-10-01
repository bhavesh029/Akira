import { DecimalTransformer } from './decimal.transformer';

describe('DecimalTransformer', () => {
  const transformer = new DecimalTransformer();

  describe('from (reading from the database)', () => {
    it('converts a decimal string to a real number', () => {
      expect(transformer.from('1500.00')).toBe(1500);
      expect(typeof transformer.from('1500.00')).toBe('number');
    });

    it('preserves cents precision', () => {
      expect(transformer.from('1234.56')).toBe(1234.56);
    });

    it('passes through null and undefined unchanged', () => {
      expect(transformer.from(null)).toBeNull();
      expect(transformer.from(undefined)).toBeUndefined();
    });

    it('handles a zero value', () => {
      expect(transformer.from('0.00')).toBe(0);
    });

    it('handles a negative value', () => {
      expect(transformer.from('-250.50')).toBe(-250.5);
    });
  });

  describe('to (writing to the database)', () => {
    it('passes a number through unchanged (driver handles serialization)', () => {
      expect(transformer.to(1500)).toBe(1500);
    });

    it('passes null/undefined through unchanged', () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.to(undefined)).toBeUndefined();
    });
  });

  it('round-trips a value through to() then from() without precision loss', () => {
    const original = 999.99;
    const written = transformer.to(original);
    // Simulate what Postgres/node-postgres hands back for a decimal(12,2) column.
    const stored = written!.toFixed(2);
    expect(transformer.from(stored)).toBe(original);
  });
});
