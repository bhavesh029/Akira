import { BankParser } from './bank-parser.interface';
import { ExtractedTransaction } from '../gemini.service';

export class HDFCParser implements BankParser {
  getBankName(): string {
    return 'HDFC Bank';
  }

  canParse(text: string): boolean {
    return (
      text.toLowerCase().includes('hdfc bank') ||
      text.toLowerCase().includes('hdfcbank')
    );
  }

  parse(text: string): ExtractedTransaction[] {
    const transactions: ExtractedTransaction[] = [];
    const lines = text.split('\n');

    // TODO: HDFC specific Regex logic to be implemented here once a sample PDF text is provided.
    // Example: matches Date, Description, Ref, Value Date, Withdrawal, Deposit, Balance
    const regex =
      /^(\d{2}\/\d{2}\/\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})$/;

    for (const line of lines) {
      const match = line.trim().match(regex);
      if (match) {
        // Dummy mapping for now
        const dateStr = match[1];
        const desc = match[2];
        const withdrawal = match[3];
        const deposit = match[4];

        // Format Date to YYYY-MM-DD
        const parts = dateStr.split('/');
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        const formattedDate = `${year}-${parts[1]}-${parts[0]}`;

        if (withdrawal) {
          transactions.push({
            transaction_date: formattedDate,
            description: desc.trim(),
            amount: parseFloat(withdrawal.replace(/,/g, '')),
            type: 'DEBIT',
            category: 'Other',
          });
        } else if (deposit) {
          transactions.push({
            transaction_date: formattedDate,
            description: desc.trim(),
            amount: parseFloat(deposit.replace(/,/g, '')),
            type: 'CREDIT',
            category: 'Other',
          });
        }
      }
    }

    return transactions;
  }
}
