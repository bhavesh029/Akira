import { ExtractedTransaction } from '../gemini.service';

export interface BankParser {
  /** Returns the name of the bank this parser handles */
  getBankName(): string;

  /** Checks if the document text matches this bank's statement format */
  canParse(text: string): boolean;

  /** Parses the text and returns structured transactions */
  parse(text: string): ExtractedTransaction[];
}
