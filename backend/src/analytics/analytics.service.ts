import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { GeminiService } from '../documents/gemini.service';
import { AiInsightsCacheService } from './ai-insights-cache.service';

/** Returns start date for date range without mutating the original date. */
function getStartDateForRange(dateRange: string): Date | undefined {
  const now = new Date();
  const startDate = new Date(now);
  switch (dateRange) {
    case '1m':
      startDate.setMonth(startDate.getMonth() - 1);
      return startDate;
    case '3m':
      startDate.setMonth(startDate.getMonth() - 3);
      return startDate;
    case '6m':
      startDate.setMonth(startDate.getMonth() - 6);
      return startDate;
    case '1y':
      startDate.setFullYear(startDate.getFullYear() - 1);
      return startDate;
    default:
      return undefined;
  }
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly geminiService: GeminiService,
    private readonly aiInsightsCache: AiInsightsCacheService,
  ) {}

  async getSummary(userId: number, accountId?: number, dateRange?: string) {
    const query = this.transactionsRepository.createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId });
      
    if (accountId) {
      query.andWhere('tx.accountId = :accountId', { accountId });
    }

    if (dateRange && dateRange !== 'all') {
      const startDate = getStartDateForRange(dateRange);
      if (startDate) {
        query.andWhere('tx.transaction_date >= :startDate', { startDate });
      }
    }

    // 1. Get totals
    const totals = await query.clone()
      .select('tx.type', 'type')
      .addSelect('SUM(tx.amount)', 'total')
      .groupBy('tx.type')
      .getRawMany();

    let totalInflow = 0;
    let totalOutflow = 0;
    
    totals.forEach(t => {
      if (t.type === 'CREDIT') totalInflow = Number(t.total);
      if (t.type === 'DEBIT') totalOutflow = Number(t.total);
    });

    // 2. Count transactions
    const transactionCount = await query.clone().getCount();

    // 3. Get top categories (DEBIT only)
    const topCategories = await query.clone()
      .andWhere('tx.type = :type', { type: 'DEBIT' })
      .select('tx.category', 'name')
      .addSelect('SUM(tx.amount)', 'value')
      .groupBy('tx.category')
      .orderBy('value', 'DESC')
      .limit(5)
      .getRawMany();

    // Convert value to number
    const formattedCategories = topCategories.map(c => ({
      name: c.name || 'Other',
      value: Number(c.value)
    }));

    // 4. Cashflow over the last 6 months (group by YYYY-MM)
    const cashflowQuery = this.transactionsRepository.createQueryBuilder('tx')
      .select(`TO_CHAR(tx.transaction_date, 'YYYY-MM')`, 'month')
      .addSelect(`SUM(CASE WHEN tx.type = 'CREDIT' THEN tx.amount ELSE 0 END)`, 'income')
      .addSelect(`SUM(CASE WHEN tx.type = 'DEBIT' THEN tx.amount ELSE 0 END)`, 'expenses')
      .where('tx.userId = :userId', { userId })
      .groupBy(`TO_CHAR(tx.transaction_date, 'YYYY-MM')`)
      .orderBy('month', 'DESC')
      .limit(12);

    if (accountId) {
      cashflowQuery.andWhere('tx.accountId = :accountId', { accountId });
    }

    // Always constrain cashflow trend back to our selected date constraints if they exist
    if (dateRange && dateRange !== 'all') {
      const startDate = getStartDateForRange(dateRange);
      if (startDate) {
        cashflowQuery.andWhere('tx.transaction_date >= :startDate', { startDate });
      }
    }

    const cashflow = await cashflowQuery.getRawMany();

    // Reverse cashflow so it goes chronological
    const formattedCashflow = cashflow.map(c => ({
      month: c.month,
      income: Number(c.income),
      expenses: Number(c.expenses)
    })).reverse();

    // 5. Recent Anomalies (large transactions > generic threshold, let's say top 5 largest debits)
    const anomalies = await query.clone()
      .andWhere('tx.type = :type', { type: 'DEBIT' })
      .orderBy('tx.amount', 'DESC')
      .limit(5)
      .getMany();

    return {
      metrics: {
        totalInflow,
        totalOutflow,
        netBalance: totalInflow - totalOutflow,
        transactionCount
      },
      cashflow: formattedCashflow,
      topCategories: formattedCategories,
      anomalies
    };
  }

  async getAiInsights(userId: number, accountId?: number, dateRange?: string) {
    const cacheKey = this.aiInsightsCache.makeKey(userId, accountId, dateRange);
    const cached = this.aiInsightsCache.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      return cached;
    }

    const query = this.transactionsRepository.createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .orderBy('tx.transaction_date', 'DESC')
      .limit(100); // Send up to 100 recent transactions to AI

    if (accountId) {
      query.andWhere('tx.accountId = :accountId', { accountId });
    }

    if (dateRange && dateRange !== 'all') {
      const startDate = getStartDateForRange(dateRange);
      if (startDate) {
        query.andWhere('tx.transaction_date >= :startDate', { startDate });
      }
    }

    const recentTx = await query.getMany();

    if (recentTx.length === 0) {
      const empty = {
        summary: "Not enough transactions to generate insights yet.",
        subscriptions: [],
        anomalies: []
      };
      this.aiInsightsCache.set(cacheKey, empty);
      return empty;
    }

    const txString = JSON.stringify(recentTx.map(t => ({
      date: t.transaction_date,
      amount: t.amount,
      type: t.type,
      category: t.category,
      desc: t.description
    })));

    const prompt = `You are an expert financial advisor AI. Analyze the following Recent Transactions to provide insights.

Return ONLY a valid JSON object with the following structure:
{
  "summary": "A 2-3 sentence personalized, conversational summary of their recent financial behavior. Do not use generic greetings, just get straight to the insights.",
  "subscriptions": [
    { "name": "Netflix", "amount": 199, "frequency": "Monthly" }
  ],
  "anomalies": [
    "Detected a large unusual payment of ₹50,000 for Apple Store."
  ]
}

If no clear subscriptions or anomalies are identified, return empty arrays for them.

Transactions:
${txString}`;

    const insights = await this.geminiService.generateInsights(prompt);
    this.aiInsightsCache.set(cacheKey, insights);
    return insights;
  }
}
