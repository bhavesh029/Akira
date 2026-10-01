import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class AxisParser implements BankParser {
  getBankName(): string {
    return 'Axis Bank';
  }

  canParse(text: string): boolean {
    return text.toLowerCase().includes('axis bank');
  }

  parse(text: string): ExtractedTransaction[] {
    // TODO: Implement exact regex for Axis Bank statements
    return [];
  }
}
