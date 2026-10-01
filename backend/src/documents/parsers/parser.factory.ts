import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { BankParser } from './bank-parser.interface';
import { HDFCParser } from './hdfc.parser';
import { ICICIParser } from './icici.parser';
import { HSBCParser } from './hsbc.parser';
import { UCOParser } from './uco.parser';
import { PNBParser } from './pnb.parser';
import { AxisParser } from './axis.parser';
import { ExtractedTransaction } from '../gemini.service';

@Injectable()
export class ParserFactory {
  private readonly logger = new Logger(ParserFactory.name);
  private parsers: BankParser[];

  constructor() {
    this.parsers = [
      new HDFCParser(),
      new ICICIParser(),
      new HSBCParser(),
      new UCOParser(),
      new PNBParser(),
      new AxisParser(),
    ];
  }

  parseText(text: string): ExtractedTransaction[] {
    for (const parser of this.parsers) {
      if (parser.canParse(text)) {
        this.logger.log(`Matched bank statement to: ${parser.getBankName()}`);
        return parser.parse(text);
      }
    }

    this.logger.warn('No parser matched the given bank statement text.');
    throw new BadRequestException(
      'Unsupported Bank Format. Please upload a supported bank statement (ICICI, HDFC, HSBC, UCO, PNB, AXIS).',
    );
  }
}
