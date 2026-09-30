import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class PNBParser implements BankParser {
  getBankName(): string {
    return 'Punjab National Bank (PNB)';
  }

  canParse(text: string): boolean {
    return (
      text.toLowerCase().includes('punjab national bank') ||
      text.toLowerCase().includes('pnb')
    );
  }

  parse(text: string): ExtractedTransaction[] {
    // TODO: Implement exact regex for PNB statements
    return [];
  }
}
