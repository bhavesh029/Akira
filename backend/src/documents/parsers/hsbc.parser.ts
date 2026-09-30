import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class HSBCParser implements BankParser {
  getBankName(): string {
    return 'HSBC Bank';
  }

  canParse(text: string): boolean {
    return (
      text.toLowerCase().includes('hsbc bank') ||
      text.toLowerCase().includes('hsbc')
    );
  }

  parse(text: string): ExtractedTransaction[] {
    // TODO: Implement exact regex for HSBC Bank statements
    return [];
  }
}
