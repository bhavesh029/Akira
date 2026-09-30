import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class ICICIParser implements BankParser {
  getBankName(): string {
    return 'ICICI Bank';
  }

  canParse(text: string): boolean {
    return text.toLowerCase().includes('icici bank');
  }

  parse(text: string): ExtractedTransaction[] {
    // TODO: Implement exact regex for ICICI Bank statements
    return [];
  }
}
