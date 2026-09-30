import { ValueTransformer } from 'typeorm';

/**
 * node-postgres returns `decimal`/`numeric` columns as strings (to avoid
 * silent precision loss), so without this, an entity field typed `number`
 * is actually a string at runtime. This transformer makes the DB round-trip
 * match the TS type.
 */
export class DecimalTransformer implements ValueTransformer {
  to(value?: number | null): number | null | undefined {
    return value;
  }

  from(value?: string | null): number | null | undefined {
    if (value === null || value === undefined) return value;
    return parseFloat(value);
  }
}
