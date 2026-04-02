import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Transaction, TransactionType } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { GeminiService } from '../documents/gemini.service';
import { AiInsightsCacheService } from './ai-insights-cache.service';
import { AccountsService } from '../accounts/accounts.service';
import type {
  FinanceChatFilters,
  FinanceChatIntent,
  FinanceChatRelative,
} from './finance-chat.types';

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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function dateRangeFromRelative(
  relative: FinanceChatRelative,
  today: Date,
): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const toStr = formatDateIso(today);

  switch (relative) {
    case 'this_month':
      return { from: `${y}-${pad2(m + 1)}-01`, to: toStr };
    case 'last_month': {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0);
      return { from: formatDateIso(first), to: formatDateIso(last) };
    }
    case 'last_7_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: formatDateIso(start), to: toStr };
    }
    case 'last_30_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { from: formatDateIso(start), to: toStr };
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: toStr };
    case 'all':
    default:
      return { from: '1970-01-01', to: toStr };
  }
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

const INVESTMENT_LIKE = [
  '%invest%',
  '%mutual%',
  '%sip%',
  '%stock%',
  '%equity%',
  '%demat%',
  '%fd%',
  '%ppf%',
];

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
    private readonly accountsService: AccountsService,
  ) {}

  async getSummary(userId: number, accountId?: number, dateRange?: string) {
    const query = this.transactionsRepository
      .createQueryBuilder('tx')
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
    const totals = await query
      .clone()
      .select('tx.type', 'type')
      .addSelect('SUM(tx.amount)', 'total')
      .groupBy('tx.type')
      .getRawMany<{ type: string; total: string }>();

    let totalInflow = 0;
    let totalOutflow = 0;

    totals.forEach((t) => {
      if (t.type === 'CREDIT') totalInflow = Number(t.total);
      if (t.type === 'DEBIT') totalOutflow = Number(t.total);
    });

    // 2. Count transactions
    const transactionCount = await query.clone().getCount();

    // 3. Get top categories (DEBIT only)
    const topCategories = await query
      .clone()
      .andWhere('tx.type = :type', { type: 'DEBIT' })
      .select('tx.category', 'name')
      .addSelect('SUM(tx.amount)', 'value')
      .groupBy('tx.category')
      .orderBy('value', 'DESC')
      .limit(5)
      .getRawMany<{ name: string | null; value: string }>();

    // Convert value to number
    const formattedCategories = topCategories.map((c) => ({
      name: c.name || 'Other',
      value: Number(c.value),
    }));

    // 4. Cashflow over the last 6 months (group by YYYY-MM)
    const cashflowQuery = this.transactionsRepository
      .createQueryBuilder('tx')
      .select(`TO_CHAR(tx.transaction_date, 'YYYY-MM')`, 'month')
      .addSelect(
        `SUM(CASE WHEN tx.type = 'CREDIT' THEN tx.amount ELSE 0 END)`,
        'income',
      )
      .addSelect(
        `SUM(CASE WHEN tx.type = 'DEBIT' THEN tx.amount ELSE 0 END)`,
        'expenses',
      )
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
        cashflowQuery.andWhere('tx.transaction_date >= :startDate', {
          startDate,
        });
      }
    }

    const cashflow = await cashflowQuery.getRawMany<{
      month: string;
      income: string;
      expenses: string;
    }>();

    // Reverse cashflow so it goes chronological
    const formattedCashflow = cashflow
      .map((c) => ({
        month: c.month,
        income: Number(c.income),
        expenses: Number(c.expenses),
      }))
      .reverse();

    // 5. Recent Anomalies (large transactions > generic threshold, let's say top 5 largest debits)
    const anomalies = await query
      .clone()
      .andWhere('tx.type = :type', { type: 'DEBIT' })
      .orderBy('tx.amount', 'DESC')
      .limit(5)
      .getMany();

    return {
      metrics: {
        totalInflow,
        totalOutflow,
        netBalance: totalInflow - totalOutflow,
        transactionCount,
      },
      cashflow: formattedCashflow,
      topCategories: formattedCategories,
      anomalies,
    };
  }

  async getAiInsights(userId: number, accountId?: number, dateRange?: string) {
    const cacheKey = this.aiInsightsCache.makeKey(userId, accountId, dateRange);
    const cached = this.aiInsightsCache.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      return cached;
    }

    const query = this.transactionsRepository
      .createQueryBuilder('tx')
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
        summary: 'Not enough transactions to generate insights yet.',
        subscriptions: [],
        anomalies: [],
      };
      this.aiInsightsCache.set(cacheKey, empty);
      return empty;
    }

    const txString = JSON.stringify(
      recentTx.map((t) => ({
        date: t.transaction_date,
        amount: t.amount,
        type: t.type,
        category: t.category,
        desc: t.description,
      })),
    );

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

    const insights = (await this.geminiService.generateInsights(
      prompt,
    )) as Record<string, unknown>;
    this.aiInsightsCache.set(cacheKey, insights);
    return insights;
  }

  async financeChat(
    userId: number,
    message: string,
  ): Promise<{ answer: string }> {
    const accounts = await this.accountsService.findAllByUser(userId);
    const today = new Date();
    const todayIso = formatDateIso(today);
    const accCtx = accounts.map((a) => ({ id: a.id, bank_name: a.bank_name }));

    const parsed = await this.geminiService.parseFinanceChatIntent(
      message,
      accCtx,
      todayIso,
    );

    if (parsed.intent === 'clarify') {
      const msg =
        parsed.clarifyMessage?.trim() ||
        'Could you specify the date range, bank name, or which account you mean?';
      return { answer: msg };
    }

    if (parsed.intent === 'unknown') {
      return {
        answer:
          'I can answer questions about your recorded transactions: total spending or income, net cashflow, top spending category, whether debits crossed an amount in a period, or debit flows that look investment-related. Try something like “How much did I spend this month?” or “Top category last month.”',
      };
    }

    const { from, to } = this.resolveChatDateRange(parsed.filters, today);
    const accountIds = this.resolveAccountIds(accounts, parsed.filters);

    if (accountIds !== undefined && accountIds.length === 0) {
      return {
        answer:
          'No account matched that bank or account. Check the spelling or pick an account from your Accounts page.',
      };
    }

    const scopeLabel = this.describeAccountScope(
      accounts,
      accountIds,
      parsed.filters.bankName,
    );

    const answer = await this.executeFinanceIntent(
      userId,
      parsed.intent,
      parsed.filters,
      from,
      to,
      accountIds,
      scopeLabel,
    );
    return { answer };
  }

  private resolveChatDateRange(
    filters: FinanceChatFilters,
    today: Date,
  ): { from: string; to: string } {
    if (filters.from && filters.to) {
      return { from: filters.from, to: filters.to };
    }
    if (filters.from && !filters.to) {
      return { from: filters.from, to: formatDateIso(today) };
    }
    if (!filters.from && filters.to) {
      return { from: '1970-01-01', to: filters.to };
    }
    const rel = filters.relative ?? 'last_30_days';
    return dateRangeFromRelative(rel, today);
  }

  private resolveAccountIds(
    accounts: Account[],
    filters: FinanceChatFilters,
  ): number[] | undefined {
    if (filters.accountId != null) {
      const ok = accounts.some((a) => a.id === filters.accountId);
      return ok ? [filters.accountId] : [];
    }
    const bank = filters.bankName?.trim();
    if (bank) {
      const q = bank.toLowerCase();
      return accounts
        .filter((a) => a.bank_name.toLowerCase().includes(q))
        .map((a) => a.id);
    }
    return undefined;
  }

  private describeAccountScope(
    accounts: Account[],
    accountIds: number[] | undefined,
    bankName: string | null,
  ): string {
    if (accountIds === undefined) {
      return 'all your accounts';
    }
    if (accountIds.length === 1) {
      const a = accounts.find((x) => x.id === accountIds[0]);
      return a ? `${a.bank_name} (account #${a.id})` : 'the selected account';
    }
    if (bankName?.trim()) {
      return `accounts matching “${bankName.trim()}”`;
    }
    return 'the selected accounts';
  }

  private async executeFinanceIntent(
    userId: number,
    intent: FinanceChatIntent,
    filters: FinanceChatFilters,
    from: string,
    to: string,
    accountIds: number[] | undefined,
    scopeLabel: string,
  ): Promise<string> {
    const period = `${from} to ${to}`;

    const count = await this.countTransactions(userId, accountIds, from, to);
    if (count === 0) {
      return `No transactions found between ${period} for ${scopeLabel}. Add or import transactions to see answers here.`;
    }

    switch (intent) {
      case 'sum_debits': {
        const sum = await this.sumByType(
          userId,
          accountIds,
          from,
          to,
          TransactionType.DEBIT,
          filters.category,
        );
        const cat = filters.category?.trim();
        return cat
          ? `Between ${period}, total debit spending in categories matching “${cat}” on ${scopeLabel} was ${formatInr(sum)}.`
          : `Between ${period}, total debit spending on ${scopeLabel} was ${formatInr(sum)}.`;
      }
      case 'sum_credits': {
        const sum = await this.sumByType(
          userId,
          accountIds,
          from,
          to,
          TransactionType.CREDIT,
          filters.category,
        );
        const cat = filters.category?.trim();
        return cat
          ? `Between ${period}, total credits in categories matching “${cat}” on ${scopeLabel} were ${formatInr(sum)}.`
          : `Between ${period}, total credits on ${scopeLabel} were ${formatInr(sum)}.`;
      }
      case 'net_flow': {
        const credits = await this.sumByType(
          userId,
          accountIds,
          from,
          to,
          TransactionType.CREDIT,
          null,
        );
        const debits = await this.sumByType(
          userId,
          accountIds,
          from,
          to,
          TransactionType.DEBIT,
          null,
        );
        const net = credits - debits;
        return `Between ${period} on ${scopeLabel}: credits ${formatInr(credits)}, debits ${formatInr(
          debits,
        )}, net cashflow ${formatInr(net)}.`;
      }
      case 'top_category': {
        const row = await this.topDebitCategory(
          userId,
          accountIds,
          from,
          to,
          filters.category,
        );
        if (!row || row.total <= 0) {
          return `No debit categories with spend between ${period} for ${scopeLabel}.`;
        }
        return `Between ${period}, your highest debit spending category on ${scopeLabel} was “${row.name}” at ${formatInr(
          row.total,
        )}.`;
      }
      case 'compare_amount': {
        if (filters.amount == null || filters.amount <= 0) {
          return 'I could not tell which amount to compare. Try again with a number, for example “Did I spend at least ₹10,000 this month?”';
        }
        const sum = await this.sumByType(
          userId,
          accountIds,
          from,
          to,
          TransactionType.DEBIT,
          filters.category,
        );
        const op = filters.compareOp ?? 'gte';
        const thr = filters.amount;
        let passes = false;
        if (op === 'gte') passes = sum >= thr;
        else if (op === 'lte') passes = sum <= thr;
        else passes = Math.abs(sum - thr) < 0.01;
        const opPhrase =
          op === 'gte' ? 'at least' : op === 'lte' ? 'at most' : 'exactly';
        return `Between ${period}, total debit spending on ${scopeLabel} was ${formatInr(sum)}. That is ${
          passes ? '' : 'not '
        }${opPhrase} ${formatInr(thr)}.`;
      }
      case 'investment_estimate': {
        const sum = await this.sumInvestmentLikeDebits(
          userId,
          accountIds,
          from,
          to,
        );
        return `Between ${period}, debits on ${scopeLabel} that match investment-style keywords (e.g. invest, mutual, SIP) total about ${formatInr(
          sum,
        )}. Tag transactions consistently for more precise tracking.`;
      }
      default:
        return 'I could not run that query. Try rephrasing or narrowing the date range.';
    }
  }

  private async countTransactions(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
  ): Promise<number> {
    const qb = this.baseTxQuery(userId, accountIds, from, to);
    return qb.getCount();
  }

  private baseTxQuery(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
  ) {
    const qb = this.transactionsRepository
      .createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.transaction_date BETWEEN :from AND :to', { from, to });
    if (accountIds?.length) {
      qb.andWhere('tx.accountId IN (:...ids)', { ids: accountIds });
    }
    return qb;
  }

  private async sumByType(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
    type: TransactionType,
    category: string | null,
  ): Promise<number> {
    const qb = this.baseTxQuery(userId, accountIds, from, to).andWhere(
      'tx.type = :type',
      { type },
    );
    const cat = category?.trim();
    if (cat) {
      qb.andWhere('tx.category ILIKE :cat', { cat: `%${cat}%` });
    }
    const raw = await qb
      .select('SUM(tx.amount)', 'sum')
      .getRawOne<{ sum: string | null }>();
    return Number(raw?.sum ?? 0);
  }

  private async topDebitCategory(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
    categoryHint: string | null,
  ): Promise<{ name: string; total: number } | null> {
    const qb = this.baseTxQuery(userId, accountIds, from, to)
      .andWhere('tx.type = :type', { type: TransactionType.DEBIT })
      .select('tx.category', 'name')
      .addSelect('SUM(tx.amount)', 'total')
      .groupBy('tx.category')
      .orderBy('total', 'DESC');

    const hint = categoryHint?.trim();
    if (hint) {
      qb.andWhere('tx.category ILIKE :hint', { hint: `%${hint}%` });
    }

    const raw = await qb.getRawOne<{
      name: string | null;
      total: string | null;
    }>();
    if (!raw) return null;
    return { name: raw.name || 'Other', total: Number(raw.total ?? 0) };
  }

  private async sumInvestmentLikeDebits(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
  ): Promise<number> {
    const qb = this.baseTxQuery(userId, accountIds, from, to).andWhere(
      'tx.type = :type',
      {
        type: TransactionType.DEBIT,
      },
    );

    qb.andWhere(
      new Brackets((b) => {
        INVESTMENT_LIKE.forEach((p, idx) => {
          b.orWhere(
            new Brackets((inner) => {
              inner
                .where(`tx.category ILIKE :inv${idx}`, { [`inv${idx}`]: p })
                .orWhere(`tx.description ILIKE :invd${idx}`, {
                  [`invd${idx}`]: p,
                });
            }),
          );
        });
      }),
    );

    const raw = await qb
      .select('SUM(tx.amount)', 'sum')
      .getRawOne<{ sum: string | null }>();
    return Number(raw?.sum ?? 0);
  }
}
