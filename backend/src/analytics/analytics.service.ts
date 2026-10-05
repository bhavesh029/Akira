import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Transaction, TransactionType } from '../entities/transaction.entity';
import { Account } from '../entities/account.entity';
import { GeminiService } from '../documents/gemini.service';
import { AiInsightsCacheService } from './ai-insights-cache.service';
import { AccountsService } from '../accounts/accounts.service';
import { RagService } from './rag.service';
import type {
  FinanceChatFilters,
  FinanceChatIntent,
  FinanceChatResult,
} from './finance-chat.types';
import {
  todayIso,
  getStartDateForRange,
  dateRangeFromRelative,
  previousPeriod,
} from './date-range.util';

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

/** Cap on how many individual rows `list_transactions` includes in one chat answer. */
const LIST_TRANSACTIONS_LIMIT = 20;

/** Cap on how many categories `category_breakdown` includes in one chat answer. */
const CATEGORY_BREAKDOWN_LIMIT = 15;

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
    private readonly ragService: RagService,
  ) {}

  /**
   * Base query every analytics aggregation starts from: scopes to the user,
   * optionally an account, optionally a dateRange keyword, and always to
   * reviewed = true (Phase 1 — unreviewed/unconfirmed extracted transactions
   * never count toward analytics). financeChat's baseTxQuery below applies
   * the same reviewed gate independently, since it has its own from/to +
   * accountIds filter shape rather than this one's dateRange keyword.
   */
  private baseFilteredQuery(
    userId: number,
    accountId?: number,
    dateRange?: string,
  ) {
    const query = this.transactionsRepository
      .createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.reviewed = true');

    if (accountId) {
      query.andWhere('tx.accountId = :accountId', { accountId });
    }

    if (dateRange && dateRange !== 'all') {
      const startDate = getStartDateForRange(dateRange);
      if (startDate) {
        query.andWhere('tx.transaction_date >= :startDate', { startDate });
      }
    }

    return query;
  }

  async getSummary(userId: number, accountId?: number, dateRange?: string) {
    const query = this.baseFilteredQuery(userId, accountId, dateRange);

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

    // 4. Cashflow over the last 12 months (group by YYYY-MM), built on the same base filters
    const cashflowQuery = this.baseFilteredQuery(userId, accountId, dateRange)
      .select(`TO_CHAR(tx.transaction_date, 'YYYY-MM')`, 'month')
      .addSelect(
        `SUM(CASE WHEN tx.type = 'CREDIT' THEN tx.amount ELSE 0 END)`,
        'income',
      )
      .addSelect(
        `SUM(CASE WHEN tx.type = 'DEBIT' THEN tx.amount ELSE 0 END)`,
        'expenses',
      )
      .groupBy(`TO_CHAR(tx.transaction_date, 'YYYY-MM')`)
      .orderBy('month', 'DESC')
      .limit(12);

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

    const query = this.baseFilteredQuery(userId, accountId, dateRange)
      .orderBy('tx.transaction_date', 'DESC')
      .limit(100); // Send up to 100 recent transactions to AI

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

    // Bug #5: never let Gemini's own stated figures reach the user
    // unverified — cross-check every number against the real transactions
    // that were actually sent to it, correcting or dropping anything that
    // doesn't match.
    const verifiedInsights = {
      summary: typeof insights.summary === 'string' ? insights.summary : '',
      subscriptions: this.verifySubscriptions(insights.subscriptions, recentTx),
      anomalies: this.verifyAnomalies(insights.anomalies, recentTx),
    };

    this.aiInsightsCache.set(cacheKey, verifiedInsights);
    return verifiedInsights;
  }

  /**
   * Bug #5 fix: Gemini may state a subscription's amount incorrectly, or
   * hallucinate a vendor that isn't actually in the user's transactions. For
   * each candidate, replace the LLM-stated amount with the real amount from
   * the most recent matching transaction (matched by description, since
   * Gemini and the raw statement description rarely spell a vendor name
   * identically), or drop the candidate entirely if nothing matches.
   */
  private verifySubscriptions(
    subscriptions: unknown,
    transactions: Transaction[],
  ): Array<{ name: string; amount: number; frequency: string }> {
    if (!Array.isArray(subscriptions)) return [];

    const debits = transactions.filter((t) => t.type === TransactionType.DEBIT);
    const verified: Array<{ name: string; amount: number; frequency: string }> =
      [];

    for (const sub of subscriptions) {
      if (!sub || typeof sub !== 'object') continue;
      const raw = sub as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const frequency =
        typeof raw.frequency === 'string' ? raw.frequency : 'Unknown';
      if (!name) continue;

      const nameLower = name.toLowerCase();
      const matches = debits.filter((t) => {
        const desc = (t.description ?? '').trim().toLowerCase();
        return (
          desc.length > 0 &&
          (desc.includes(nameLower) || nameLower.includes(desc))
        );
      });

      if (matches.length === 0) {
        this.logger.warn(
          `Dropping AI-detected subscription "${name}" — no matching transaction found`,
        );
        continue;
      }

      const mostRecent = matches.reduce((a, b) =>
        a.transaction_date > b.transaction_date ? a : b,
      );
      verified.push({ name, amount: mostRecent.amount, frequency });
    }

    return verified;
  }

  /**
   * Bug #5 fix: an anomaly sentence is free text with a rupee figure baked
   * in by the LLM. Keep it only if at least one number mentioned in the
   * sentence matches a real transaction amount; otherwise the figure (and
   * therefore the whole claim) can't be trusted, so drop it.
   */
  private verifyAnomalies(
    anomalies: unknown,
    transactions: Transaction[],
  ): string[] {
    if (!Array.isArray(anomalies)) return [];

    const realAmounts = new Set(transactions.map((t) => Math.round(t.amount)));
    const verified: string[] = [];

    for (const item of anomalies) {
      if (typeof item !== 'string') continue;
      const numbers = item.match(/[\d,]+(?:\.\d+)?/g) ?? [];
      const hasRealAmount = numbers.some((n) =>
        realAmounts.has(Math.round(parseFloat(n.replace(/,/g, '')))),
      );

      if (hasRealAmount) {
        verified.push(item);
      } else {
        this.logger.warn(
          `Dropping AI-detected anomaly with no matching transaction amount: "${item}"`,
        );
      }
    }

    return verified;
  }

  async financeChat(
    userId: number,
    message: string,
  ): Promise<FinanceChatResult> {
    const accounts = await this.accountsService.findAllByUser(userId);
    const todayIsoStr = todayIso();
    const accCtx = accounts.map((a) => ({ id: a.id, bank_name: a.bank_name }));

    const parsed = await this.geminiService.parseFinanceChatIntent(
      message,
      accCtx,
      todayIsoStr,
    );

    if (parsed.intent === 'clarify') {
      const msg =
        parsed.clarifyMessage?.trim() ||
        'Could you specify the date range, bank name, or which account you mean?';
      return { answer: msg };
    }

    if (parsed.intent === 'unknown') {
      // Phase 3: route to grounded RAG over the user's raw statement text —
      // deliberately a separate code path from the deterministic-SQL intents
      // below (see rag.service.ts's class doc for why).
      return this.ragService.answer(userId, message);
    }

    const { from, to } = this.resolveChatDateRange(parsed.filters, todayIsoStr);
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
    todayIsoStr: string,
  ): { from: string; to: string } {
    if (filters.from && filters.to) {
      return { from: filters.from, to: filters.to };
    }
    if (filters.from && !filters.to) {
      return { from: filters.from, to: todayIsoStr };
    }
    if (!filters.from && filters.to) {
      return { from: '1970-01-01', to: filters.to };
    }
    const rel = filters.relative ?? 'last_30_days';
    return dateRangeFromRelative(rel, todayIsoStr);
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
      return this.describeEmptyPeriod(
        userId,
        accountIds,
        from,
        to,
        period,
        scopeLabel,
      );
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
      case 'category_breakdown': {
        const rows = await this.categoryBreakdown(userId, accountIds, from, to);
        if (rows.length === 0) {
          return `No debit categories with spend between ${period} for ${scopeLabel}.`;
        }
        const lines = rows.map((r) => `• ${r.name} — ${formatInr(r.total)}`);
        return `Between ${period}, debit spending by category on ${scopeLabel}:\n${lines.join('\n')}`;
      }
      case 'compare_amount': {
        const { amountMin, amountMax } = filters;
        if (amountMin == null && amountMax == null) {
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
        const passes = AnalyticsService.amountInRange(
          sum,
          amountMin,
          amountMax,
        );
        const rangePhrase = AnalyticsService.describeAmountRange(
          amountMin,
          amountMax,
        );
        return `Between ${period}, total debit spending on ${scopeLabel} was ${formatInr(sum)}. That is ${
          passes ? '' : 'not '
        }${rangePhrase}.`;
      }
      case 'compare_periods': {
        const prev = previousPeriod(from, to);
        const [currentCredits, currentDebits, prevCredits, prevDebits] =
          await Promise.all([
            this.sumByType(
              userId,
              accountIds,
              from,
              to,
              TransactionType.CREDIT,
              null,
            ),
            this.sumByType(
              userId,
              accountIds,
              from,
              to,
              TransactionType.DEBIT,
              null,
            ),
            this.sumByType(
              userId,
              accountIds,
              prev.from,
              prev.to,
              TransactionType.CREDIT,
              null,
            ),
            this.sumByType(
              userId,
              accountIds,
              prev.from,
              prev.to,
              TransactionType.DEBIT,
              null,
            ),
          ]);
        const currentNet = currentCredits - currentDebits;
        const prevNet = prevCredits - prevDebits;
        const debitDelta = currentDebits - prevDebits;
        const direction =
          debitDelta > 0 ? 'up' : debitDelta < 0 ? 'down' : 'unchanged';
        const deltaPhrase =
          Math.abs(debitDelta) < 0.01
            ? ''
            : ` (${direction} by ${formatInr(Math.abs(debitDelta))})`;
        return `Between ${period} on ${scopeLabel}: spending was ${formatInr(currentDebits)}${deltaPhrase} compared to ${formatInr(prevDebits)} in the previous period (${prev.from} to ${prev.to}). Net cashflow was ${formatInr(currentNet)} vs ${formatInr(prevNet)}.`;
      }
      case 'list_transactions': {
        const type: TransactionType =
          (filters.type as TransactionType | null) ?? TransactionType.DEBIT;
        const sortBy = filters.sortBy ?? 'amount';
        const sortDir = filters.sortDir ?? 'desc';
        const { rows, total } = await this.listMatchingTransactions(
          userId,
          accountIds,
          from,
          to,
          type,
          filters.category,
          filters.description,
          filters.amountMin,
          filters.amountMax,
          sortBy,
          sortDir,
        );

        const rangePhrase = AnalyticsService.describeAmountRange(
          filters.amountMin,
          filters.amountMax,
        );
        const thresholdPhrase = rangePhrase ? ` of ${rangePhrase}` : '';
        const vendor = filters.description?.trim();
        const vendorPhrase = vendor ? ` matching “${vendor}”` : '';
        const typeLabel = type === TransactionType.CREDIT ? 'credit' : 'debit';

        if (rows.length === 0) {
          return `No ${typeLabel} transactions${thresholdPhrase}${vendorPhrase} found between ${period} for ${scopeLabel}.`;
        }

        const lines = rows.map(
          (tx) =>
            `• ${tx.transaction_date} — ${tx.description?.trim() || tx.category || 'Transaction'} — ${formatInr(tx.amount)}`,
        );
        const truncatedNote =
          total > rows.length ? ` (showing ${rows.length} of ${total})` : '';
        const header = `Between ${period}, ${scopeLabel} had ${total} ${typeLabel} transaction${total === 1 ? '' : 's'}${thresholdPhrase}${vendorPhrase}${truncatedNote}:`;
        return `${header}\n${lines.join('\n')}`;
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

  /**
   * The flat "No transactions found" message reads as "you have no data at
   * all," which is actively misleading for a user who has plenty of reviewed
   * transactions just not in this particular (often auto-picked, e.g.
   * "this_month") window. Distinguishes three real situations instead:
   * unreviewed transactions sitting in this exact period (point at the
   * Review workflow — the actionable fix), reviewed data that just lives
   * outside this period (suggest trying a different one), or genuinely no
   * data at all (the original message).
   */
  private async describeEmptyPeriod(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
    period: string,
    scopeLabel: string,
  ): Promise<string> {
    const unreviewed = await this.countUnreviewedInPeriod(
      userId,
      accountIds,
      from,
      to,
    );
    if (unreviewed > 0) {
      const plural = unreviewed === 1 ? '' : 's';
      const pronoun = unreviewed === 1 ? 'it' : 'them';
      return `No reviewed transactions found between ${period} for ${scopeLabel}, but ${unreviewed} transaction${plural} in that period ${unreviewed === 1 ? 'is' : 'are'} still waiting for review — confirm ${pronoun} on the Review page (Documents → Review) to include ${pronoun} here.`;
    }

    const hasAny = await this.hasAnyReviewedTransactions(userId, accountIds);
    if (hasAny) {
      return `No transactions found between ${period} for ${scopeLabel}, though you do have transaction history outside this range — try a different period, like "last month", "this year", or a specific date range.`;
    }

    return `No transactions found between ${period} for ${scopeLabel}. Add or import transactions to see answers here.`;
  }

  private async countUnreviewedInPeriod(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
  ): Promise<number> {
    const qb = this.transactionsRepository
      .createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.reviewed = false')
      .andWhere('tx.transaction_date BETWEEN :from AND :to', { from, to });
    if (accountIds?.length) {
      qb.andWhere('tx.accountId IN (:...ids)', { ids: accountIds });
    }
    return qb.getCount();
  }

  private async hasAnyReviewedTransactions(
    userId: number,
    accountIds: number[] | undefined,
  ): Promise<boolean> {
    const qb = this.transactionsRepository
      .createQueryBuilder('tx')
      .where('tx.userId = :userId', { userId })
      .andWhere('tx.reviewed = true');
    if (accountIds?.length) {
      qb.andWhere('tx.accountId IN (:...ids)', { ids: accountIds });
    }
    return (await qb.getCount()) > 0;
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
      .andWhere('tx.reviewed = true')
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

  /**
   * True when `value` satisfies the amountMin/amountMax bounds: min-only is
   * "at least", max-only is "at most", equal min/max is "exactly", and a
   * distinct min+max is a "between" range.
   */
  private static amountInRange(
    value: number,
    min: number | null,
    max: number | null,
  ): boolean {
    if (min != null && max != null) {
      if (Math.abs(min - max) < 0.01) return Math.abs(value - min) < 0.01;
      return value >= min && value <= max;
    }
    if (min != null) return value >= min;
    if (max != null) return value <= max;
    return true;
  }

  /** Human-readable phrase for the same amountMin/amountMax bounds `amountInRange` checks. */
  private static describeAmountRange(
    min: number | null,
    max: number | null,
  ): string {
    if (min != null && max != null) {
      if (Math.abs(min - max) < 0.01) return `exactly ${formatInr(min)}`;
      return `between ${formatInr(min)} and ${formatInr(max)}`;
    }
    if (min != null) return `at least ${formatInr(min)}`;
    if (max != null) return `at most ${formatInr(max)}`;
    return '';
  }

  /**
   * Individual matching transactions for the `list_transactions` intent —
   * unlike `sumByType`/`compare_amount`, the user wants to see the rows
   * themselves, not just an aggregate. Capped at `LIST_TRANSACTIONS_LIMIT`,
   * with the true total count returned separately so the chat answer can say
   * "showing N of M".
   */
  private async listMatchingTransactions(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
    type: TransactionType,
    category: string | null,
    description: string | null,
    amountMin: number | null,
    amountMax: number | null,
    sortBy: 'amount' | 'date',
    sortDir: 'asc' | 'desc',
  ): Promise<{ rows: Transaction[]; total: number }> {
    const qb = this.baseTxQuery(userId, accountIds, from, to).andWhere(
      'tx.type = :type',
      { type },
    );
    const cat = category?.trim();
    if (cat) {
      qb.andWhere('tx.category ILIKE :cat', { cat: `%${cat}%` });
    }
    const desc = description?.trim();
    if (desc) {
      qb.andWhere('tx.description ILIKE :desc', { desc: `%${desc}%` });
    }
    if (amountMin != null && amountMax != null) {
      if (Math.abs(amountMin - amountMax) < 0.01) {
        qb.andWhere('tx.amount = :amountEq', { amountEq: amountMin });
      } else {
        qb.andWhere('tx.amount BETWEEN :amountMin AND :amountMax', {
          amountMin,
          amountMax,
        });
      }
    } else if (amountMin != null) {
      qb.andWhere('tx.amount >= :amountMin', { amountMin });
    } else if (amountMax != null) {
      qb.andWhere('tx.amount <= :amountMax', { amountMax });
    }

    const total = await qb.clone().getCount();
    const orderColumn = sortBy === 'date' ? 'tx.transaction_date' : 'tx.amount';
    const rows = await qb
      .clone()
      .orderBy(orderColumn, sortDir === 'asc' ? 'ASC' : 'DESC')
      .limit(LIST_TRANSACTIONS_LIMIT)
      .getMany();

    return { rows, total };
  }

  /** Spending split across every category, for `category_breakdown` — unlike `topDebitCategory`, returns every row, not just the highest. */
  private async categoryBreakdown(
    userId: number,
    accountIds: number[] | undefined,
    from: string,
    to: string,
  ): Promise<{ name: string; total: number }[]> {
    const qb = this.baseTxQuery(userId, accountIds, from, to)
      .andWhere('tx.type = :type', { type: TransactionType.DEBIT })
      .select('tx.category', 'name')
      .addSelect('SUM(tx.amount)', 'total')
      .groupBy('tx.category')
      .orderBy('total', 'DESC')
      .limit(CATEGORY_BREAKDOWN_LIMIT);

    const raw = await qb.getRawMany<{ name: string | null; total: string }>();
    return raw.map((r) => ({
      name: r.name || 'Other',
      total: Number(r.total),
    }));
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
