const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest
      .fn()
      .mockReturnValue({ generateContent: mockGenerateContent }),
  })),
}));

import { GeminiService } from './gemini.service';

function geminiResponse(text: string) {
  return { response: { text: () => text } };
}

describe('GeminiService', () => {
  let service: GeminiService;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    configService = { get: jest.fn().mockReturnValue('fake-api-key') };
    service = new GeminiService(configService as any);
  });

  const validTx = {
    transaction_date: '2026-03-01',
    amount: 1500.5,
    type: 'DEBIT',
    description: 'Amazon Purchase',
    category: 'Shopping',
  };

  describe('extractTransactionsFromText', () => {
    it('sends the extraction prompt + text and returns parsed transactions', async () => {
      mockGenerateContent.mockResolvedValue(
        geminiResponse(JSON.stringify([validTx])),
      );

      const result =
        await service.extractTransactionsFromText('raw statement text');

      const promptArg = mockGenerateContent.mock.calls[0][0];
      expect(promptArg).toContain('financial document parser');
      expect(promptArg).toContain('raw statement text');
      expect(result).toEqual([validTx]);
    });
  });

  describe('extractTransactionsFromFile', () => {
    it('sends the file as base64 inlineData with the given mimeType', async () => {
      mockGenerateContent.mockResolvedValue(
        geminiResponse(JSON.stringify([validTx])),
      );
      const buffer = Buffer.from('fake-image-bytes');

      const result = await service.extractTransactionsFromFile(
        buffer,
        'image/png',
      );

      const callArg = mockGenerateContent.mock.calls[0][0];
      expect(Array.isArray(callArg)).toBe(true);
      expect(callArg[0]).toContain('financial document parser');
      expect(callArg[1]).toEqual({
        inlineData: { data: buffer.toString('base64'), mimeType: 'image/png' },
      });
      expect(result).toEqual([validTx]);
    });
  });

  describe('retry behavior (withRetry, exercised via extractTransactionsFromText)', () => {
    let setTimeoutSpy: jest.SpyInstance;

    beforeEach(() => {
      // Skip the real backoff delay — invoke the scheduled callback immediately.
      setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
        fn: () => void,
      ) => {
        fn();
        return 0 as any;
      }) as any);
    });

    afterEach(() => {
      setTimeoutSpy.mockRestore();
    });

    it('retries on a 429 status error and succeeds on the next attempt', async () => {
      mockGenerateContent
        .mockRejectedValueOnce({ status: 429, message: 'Too Many Requests' })
        .mockResolvedValueOnce(geminiResponse(JSON.stringify([validTx])));

      const result = await service.extractTransactionsFromText('text');

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result).toEqual([validTx]);
    });

    it('retries when the error message (not status) mentions 429', async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error('rate limited: 429'))
        .mockResolvedValueOnce(geminiResponse(JSON.stringify([validTx])));

      const result = await service.extractTransactionsFromText('text');

      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(result).toEqual([validTx]);
    });

    it('throws immediately without retrying when the free-tier limit is zero', async () => {
      mockGenerateContent.mockRejectedValue(
        new Error('quota limit: 0 for this project'),
      );

      await expect(service.extractTransactionsFromText('text')).rejects.toThrow(
        'limit: 0',
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('throws immediately without retrying on a non-429, non-zero-limit error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      await expect(service.extractTransactionsFromText('text')).rejects.toThrow(
        'Network error',
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('exhausts all retries and throws the last error if every attempt fails', async () => {
      mockGenerateContent.mockRejectedValue({
        status: 429,
        message: 'Too Many Requests',
      });

      await expect(service.extractTransactionsFromText('text')).rejects.toEqual(
        expect.objectContaining({ status: 429 }),
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });
  });

  describe('parseResponse (via extractTransactionsFromText)', () => {
    const extract = (raw: string) => {
      mockGenerateContent.mockResolvedValue(geminiResponse(raw));
      return service.extractTransactionsFromText('text');
    };

    it('parses a plain JSON array', async () => {
      await expect(extract(JSON.stringify([validTx]))).resolves.toEqual([
        validTx,
      ]);
    });

    it('strips ```json ... ``` markdown fences', async () => {
      await expect(
        extract('```json\n' + JSON.stringify([validTx]) + '\n```'),
      ).resolves.toEqual([validTx]);
    });

    it('strips bare ``` ... ``` fences (no language tag)', async () => {
      await expect(
        extract('```\n' + JSON.stringify([validTx]) + '\n```'),
      ).resolves.toEqual([validTx]);
    });

    it('returns [] and logs a warning when the response is valid JSON but not an array', async () => {
      await expect(
        extract(JSON.stringify({ not: 'an array' })),
      ).resolves.toEqual([]);
    });

    it('returns [] when the response is not valid JSON at all', async () => {
      await expect(extract('this is not json{{{')).resolves.toEqual([]);
    });

    it('rejects an entry missing transaction_date, amount, or type', async () => {
      const raw = JSON.stringify([
        { amount: 100, type: 'DEBIT' }, // no date
        { transaction_date: '2026-03-01', type: 'DEBIT' }, // no amount
        { transaction_date: '2026-03-01', amount: 100 }, // no type
      ]);
      await expect(extract(raw)).resolves.toEqual([]);
    });

    it('rejects an entry with an invalid date format', async () => {
      const raw = JSON.stringify([
        { ...validTx, transaction_date: '01-03-2026' },
      ]);
      await expect(extract(raw)).resolves.toEqual([]);
    });

    it('rejects an entry with a calendar-invalid date (e.g. Feb 30)', async () => {
      const raw = JSON.stringify([
        { ...validTx, transaction_date: '2026-02-30' },
      ]);
      await expect(extract(raw)).resolves.toEqual([]);
    });

    it.each([0, -50, NaN, 'not-a-number', 1_000_000_000])(
      'rejects an entry with an invalid amount (%p)',
      async (amount) => {
        const raw = JSON.stringify([{ ...validTx, amount }]);
        await expect(extract(raw)).resolves.toEqual([]);
      },
    );

    it('rounds a valid amount to 2 decimal places', async () => {
      const raw = JSON.stringify([{ ...validTx, amount: 1500.5049 }]);
      const result = await extract(raw);
      expect(result[0].amount).toBe(1500.5);
    });

    it('defaults type to DEBIT when it is not exactly "CREDIT"', async () => {
      const raw = JSON.stringify([
        { ...validTx, type: 'credit' },
        { ...validTx, type: 'garbage' },
      ]);
      const result = await extract(raw);
      expect(result.every((t) => t.type === 'DEBIT')).toBe(true);
    });

    it('preserves type CREDIT exactly', async () => {
      const raw = JSON.stringify([{ ...validTx, type: 'CREDIT' }]);
      const result = await extract(raw);
      expect(result[0].type).toBe('CREDIT');
    });

    it('truncates an overly long description to 255 characters', async () => {
      const raw = JSON.stringify([
        { ...validTx, description: 'x'.repeat(300) },
      ]);
      const result = await extract(raw);
      expect(result[0].description).toHaveLength(255);
    });

    it('leaves description undefined when absent', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { description, ...noDesc } = validTx;
      const raw = JSON.stringify([noDesc]);
      const result = await extract(raw);
      expect(result[0].description).toBeUndefined();
    });

    it('defaults category to "Other" when absent, and truncates when too long', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { category, ...noCategory } = validTx;
      const raw = JSON.stringify([
        noCategory,
        { ...validTx, category: 'y'.repeat(150) },
      ]);
      const result = await extract(raw);
      expect(result[0].category).toBe('Other');
      expect(result[1].category).toHaveLength(100);
    });

    it('keeps valid entries and silently drops invalid ones from a mixed array', async () => {
      const raw = JSON.stringify([
        validTx,
        { transaction_date: 'bad-date', amount: 100, type: 'DEBIT' },
      ]);
      const result = await extract(raw);
      expect(result).toEqual([validTx]);
    });

    it('rejects a non-object array element instead of throwing', async () => {
      const raw = JSON.stringify(['just a string', validTx]);
      const result = await extract(raw);
      expect(result).toEqual([validTx]);
    });
  });

  describe('generateInsights', () => {
    it('parses a valid JSON object response', async () => {
      const payload = {
        summary: 'You spent a lot',
        subscriptions: [],
        anomalies: [],
      };
      mockGenerateContent.mockResolvedValue(
        geminiResponse(JSON.stringify(payload)),
      );

      await expect(service.generateInsights('prompt')).resolves.toEqual(
        payload,
      );
    });

    it('strips markdown fences before parsing', async () => {
      const payload = { summary: 'ok', subscriptions: [], anomalies: [] };
      mockGenerateContent.mockResolvedValue(
        geminiResponse('```json\n' + JSON.stringify(payload) + '\n```'),
      );

      await expect(service.generateInsights('prompt')).resolves.toEqual(
        payload,
      );
    });

    it('returns a fallback object when the response is not valid JSON', async () => {
      mockGenerateContent.mockResolvedValue(geminiResponse('not json at all'));

      await expect(service.generateInsights('prompt')).resolves.toEqual({
        summary: 'Failed to generate structured insights. Please try again.',
        subscriptions: [],
        anomalies: [],
      });
    });

    it('returns a billing-specific fallback (never an unhandled rejection) when the API call fails with a 402 billing error', async () => {
      mockGenerateContent.mockRejectedValue(
        Object.assign(new Error('Your prepayment credits are depleted.'), {
          status: 402,
        }),
      );

      const result = await service.generateInsights('prompt');

      expect(result.subscriptions).toEqual([]);
      expect(result.anomalies).toEqual([]);
      expect(result.summary).toMatch(/billing credits/i);
    });

    it('returns a generic fallback (never an unhandled rejection) when the API call fails for any other reason', async () => {
      mockGenerateContent.mockRejectedValue(new Error('network error'));

      const result = await service.generateInsights('prompt');

      expect(result.subscriptions).toEqual([]);
      expect(result.anomalies).toEqual([]);
      expect(result.summary).toMatch(/temporarily unavailable/i);
    });

    it('handles a thrown object with no usable message property', async () => {
      mockGenerateContent.mockRejectedValue({ code: 'ECONNRESET' });

      const result = await service.generateInsights('prompt');

      expect(result.subscriptions).toEqual([]);
      expect(result.summary).toMatch(/temporarily unavailable/i);
    });

    it('handles a thrown non-object value (e.g. a plain string)', async () => {
      mockGenerateContent.mockRejectedValue('a plain string rejection');

      const result = await service.generateInsights('prompt');

      expect(result.subscriptions).toEqual([]);
      expect(result.summary).toMatch(/temporarily unavailable/i);
    });
  });

  describe('parseFinanceChatIntent / normalizeFinanceChatParse', () => {
    const accounts = [{ id: 1, bank_name: 'HDFC' }];

    const parse = (raw: string) => {
      mockGenerateContent.mockResolvedValue(geminiResponse(raw));
      return service.parseFinanceChatIntent(
        'how much did I spend?',
        accounts,
        '2026-03-15',
      );
    };

    it("includes today's date and the account list in the prompt", async () => {
      mockGenerateContent.mockResolvedValue(
        geminiResponse(
          JSON.stringify({
            intent: 'sum_debits',
            filters: {},
            clarifyMessage: null,
          }),
        ),
      );
      await service.parseFinanceChatIntent(
        'how much did I spend?',
        accounts,
        '2026-03-15',
      );

      const promptArg = mockGenerateContent.mock.calls[0][0];
      expect(promptArg).toContain('2026-03-15');
      expect(promptArg).toContain('HDFC');
      expect(promptArg).toContain('how much did I spend?');
    });

    it('parses a fully-populated valid response', async () => {
      const raw = {
        intent: 'compare_amount',
        filters: {
          from: '2026-01-01',
          to: '2026-01-31',
          relative: 'this_month',
          accountId: 1,
          bankName: 'HDFC',
          category: 'Food',
          amount: 10000,
          compareOp: 'gte',
        },
        clarifyMessage: null,
      };
      const result = await parse(JSON.stringify(raw));
      expect(result).toEqual({
        intent: 'compare_amount',
        filters: {
          from: '2026-01-01',
          to: '2026-01-31',
          relative: 'this_month',
          accountId: 1,
          bankName: 'HDFC',
          category: 'Food',
          amount: 10000,
          compareOp: 'gte',
        },
        clarifyMessage: null,
      });
    });

    it('defaults an unrecognized intent to "unknown"', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'delete_everything',
          filters: {},
          clarifyMessage: null,
        }),
      );
      expect(result.intent).toBe('unknown');
    });

    it('defaults all filters when the filters object is missing entirely', async () => {
      const result = await parse(JSON.stringify({ intent: 'sum_debits' }));
      expect(result.filters).toEqual({
        from: null,
        to: null,
        relative: null,
        accountId: null,
        bankName: null,
        category: null,
        amount: null,
        compareOp: null,
      });
    });

    it('treats a filters value that is an array as if it were missing', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'sum_debits', filters: [1, 2, 3] }),
      );
      expect(result.filters.relative).toBeNull();
      expect(result.filters.amount).toBeNull();
    });

    it('rejects an invalid "relative" value', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'sum_debits',
          filters: { relative: 'next_century' },
        }),
      );
      expect(result.filters.relative).toBeNull();
    });

    it('rejects an invalid "compareOp" value', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'compare_amount',
          filters: { compareOp: 'roughly' },
        }),
      );
      expect(result.filters.compareOp).toBeNull();
    });

    it('floors a numeric accountId', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'sum_debits', filters: { accountId: 5.9 } }),
      );
      expect(result.filters.accountId).toBe(5);
    });

    it('parses a numeric-string accountId', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'sum_debits', filters: { accountId: '7' } }),
      );
      expect(result.filters.accountId).toBe(7);
    });

    it('rejects a non-numeric-string accountId', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'sum_debits', filters: { accountId: 'abc' } }),
      );
      expect(result.filters.accountId).toBeNull();
    });

    it('keeps a valid numeric amount', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'compare_amount', filters: { amount: 5000 } }),
      );
      expect(result.filters.amount).toBe(5000);
    });

    it('parses a comma-formatted amount string', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'compare_amount',
          filters: { amount: '10,000' },
        }),
      );
      expect(result.filters.amount).toBe(10000);
    });

    it('rejects a non-numeric amount string', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'compare_amount',
          filters: { amount: 'lots' },
        }),
      );
      expect(result.filters.amount).toBeNull();
    });

    it('rejects an empty-string amount', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'compare_amount',
          filters: { amount: '   ' },
        }),
      );
      expect(result.filters.amount).toBeNull();
    });

    it('trims a non-empty clarifyMessage', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'clarify',
          filters: {},
          clarifyMessage: '  which account?  ',
        }),
      );
      expect(result.clarifyMessage).toBe('which account?');
    });

    it('treats a whitespace-only clarifyMessage as null', async () => {
      const result = await parse(
        JSON.stringify({
          intent: 'clarify',
          filters: {},
          clarifyMessage: '   ',
        }),
      );
      expect(result.clarifyMessage).toBeNull();
    });

    it('treats a missing/non-string clarifyMessage as null', async () => {
      const result = await parse(
        JSON.stringify({ intent: 'sum_debits', filters: {} }),
      );
      expect(result.clarifyMessage).toBeNull();
    });

    it('strips markdown fences before parsing', async () => {
      const raw =
        '```json\n' +
        JSON.stringify({
          intent: 'sum_debits',
          filters: {},
          clarifyMessage: null,
        }) +
        '\n```';
      const result = await parse(raw);
      expect(result.intent).toBe('sum_debits');
    });

    it('falls back to intent "unknown" with empty filters when the response is not valid JSON', async () => {
      const result = await parse('not json');
      expect(result).toEqual({
        intent: 'unknown',
        filters: {
          from: null,
          to: null,
          relative: null,
          accountId: null,
          bankName: null,
          category: null,
          amount: null,
          compareOp: null,
        },
        clarifyMessage: null,
      });
    });
  });
});
