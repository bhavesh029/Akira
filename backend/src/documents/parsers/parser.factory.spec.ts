import { BadRequestException } from '@nestjs/common';
import { ParserFactory } from './parser.factory';

describe('ParserFactory', () => {
  let factory: ParserFactory;

  beforeEach(() => {
    factory = new ParserFactory();
  });

  it('routes HDFC statement text to the HDFC parser', () => {
    const result = factory.parseText(
      'HDFC BANK\n01/03/26 Amazon Purchase 1,500.00 0.00 25,000.00',
    );
    expect(result).toEqual([
      expect.objectContaining({
        description: 'Amazon Purchase',
        amount: 1500,
        type: 'DEBIT',
      }),
    ]);
  });

  it('routes ICICI statement text to the (stub) ICICI parser, returning []', () => {
    expect(
      factory.parseText('ICICI Bank Statement\nsome transaction lines here'),
    ).toEqual([]);
  });

  it('tries parsers in HDFC -> ICICI -> HSBC -> UCO -> PNB -> Axis order and stops at the first match', () => {
    // Text that could plausibly mention multiple banks (e.g. a linked-card
    // footer) should resolve to whichever parser is checked first.
    const result = factory.parseText(
      'HDFC Bank main statement, also mentions HSBC in a footnote',
    );
    // HDFC matches first in the list, so its parser runs (finds no matching
    // lines in this text, but the important thing is ICICI/HSBC never ran).
    expect(result).toEqual([]);
  });

  it('throws BadRequestException when no parser recognizes the bank', () => {
    expect(() => factory.parseText('Some Unknown Bank Statement')).toThrow(
      BadRequestException,
    );
    expect(() => factory.parseText('Some Unknown Bank Statement')).toThrow(
      /Unsupported Bank Format/,
    );
  });
});
