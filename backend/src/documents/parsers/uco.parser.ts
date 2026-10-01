import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class UCOParser implements BankParser {
  getBankName(): string {
    return 'UCO Bank';
  }

  canParse(text: string): boolean {
    return text.toLowerCase().includes('uco bank');
  }

  parse(text: string): ExtractedTransaction[] {
    // TODO: Implement exact regex for UCO Bank statements
    return [];
  }
}
