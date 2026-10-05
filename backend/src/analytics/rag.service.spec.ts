import { RagService } from './rag.service';

describe('RagService', () => {
  let service: RagService;
  let geminiService: {
    embedText: jest.Mock;
    generateText: jest.Mock;
  };
  let documentChunksService: { searchSimilar: jest.Mock };

  const match = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 1,
    documentId: 10,
    documentTitle: 'March Statement',
    content: 'Late payment fee is 2% of the outstanding balance, minimum ₹500.',
    distance: 0.1,
    ...overrides,
  });

  beforeEach(() => {
    geminiService = {
      embedText: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      generateText: jest.fn(),
    };
    documentChunksService = { searchSimilar: jest.fn().mockResolvedValue([]) };
    service = new RagService(
      geminiService as any,
      documentChunksService as any,
    );
  });

  it('embeds the question and searches the user’s own chunks (top 5)', async () => {
    documentChunksService.searchSimilar.mockResolvedValue([match()]);
    geminiService.generateText.mockResolvedValue('The late fee is 2%.');

    await service.answer(42, 'what is the late payment fee?');

    expect(geminiService.embedText).toHaveBeenCalledWith(
      'what is the late payment fee?',
    );
    expect(documentChunksService.searchSimilar).toHaveBeenCalledWith(
      42,
      [0.1, 0.2, 0.3],
      5,
    );
  });

  it('returns a no-match message without calling generateText when nothing is found', async () => {
    documentChunksService.searchSimilar.mockResolvedValue([]);

    const result = await service.answer(42, 'what are the late fees?');

    expect(result.answer).toContain("couldn't find anything");
    expect(result.sources).toBeUndefined();
    expect(geminiService.generateText).not.toHaveBeenCalled();
  });

  it('returns a grounded answer with sources built from the matched chunks', async () => {
    documentChunksService.searchSimilar.mockResolvedValue([match()]);
    geminiService.generateText.mockResolvedValue(
      'The late payment fee is 2% of the outstanding balance [1].',
    );

    const result = await service.answer(42, 'what is the late payment fee?');

    expect(result.answer).toBe(
      'The late payment fee is 2% of the outstanding balance [1].',
    );
    expect(result.sources).toEqual([
      {
        documentId: 10,
        documentTitle: 'March Statement',
        snippet: match().content,
      },
    ]);
  });

  it('truncates a long chunk into a bounded snippet', async () => {
    const longContent = 'x'.repeat(500);
    documentChunksService.searchSimilar.mockResolvedValue([
      match({ content: longContent }),
    ]);
    geminiService.generateText.mockResolvedValue('some answer with no numbers');

    const result = await service.answer(42, 'question');

    expect(result.sources![0].snippet.length).toBeLessThan(longContent.length);
    expect(result.sources![0].snippet.endsWith('…')).toBe(true);
  });

  it('builds the prompt from numbered excerpts and includes the question', async () => {
    documentChunksService.searchSimilar.mockResolvedValue([
      match({ documentTitle: 'Doc A', content: 'fee is 2%' }),
      match({ documentId: 11, documentTitle: 'Doc B', content: 'rate is 3%' }),
    ]);
    geminiService.generateText.mockResolvedValue('answer');

    await service.answer(42, 'what are the fees?');

    const prompt = geminiService.generateText.mock.calls[0][0];
    expect(prompt).toContain('[1] (from "Doc A")\nfee is 2%');
    expect(prompt).toContain('[2] (from "Doc B")\nrate is 3%');
    expect(prompt).toContain('what are the fees?');
  });

  it('returns a generic failure message when question embedding throws', async () => {
    geminiService.embedText.mockRejectedValue(new Error('embedding API down'));

    const result = await service.answer(42, 'question');

    expect(result.answer).toContain('trouble generating an answer');
    expect(documentChunksService.searchSimilar).not.toHaveBeenCalled();
  });

  it('returns a generic failure message when generateText returns an empty string', async () => {
    documentChunksService.searchSimilar.mockResolvedValue([match()]);
    geminiService.generateText.mockResolvedValue('');

    const result = await service.answer(42, 'question');

    expect(result.answer).toContain('trouble generating an answer');
    expect(result.sources).toBeUndefined();
  });

  describe('grounding verification', () => {
    it('leaves an answer unchanged when every number it states appears in the retrieved excerpts', async () => {
      documentChunksService.searchSimilar.mockResolvedValue([
        match({ content: 'Late fee is 2% of ₹500 minimum.' }),
      ]);
      geminiService.generateText.mockResolvedValue(
        'The late fee is 2%, minimum 500.',
      );

      const result = await service.answer(42, 'late fee?');

      expect(result.answer).toBe('The late fee is 2%, minimum 500.');
    });

    it('appends a verification disclaimer when the answer states a number absent from the excerpts', async () => {
      documentChunksService.searchSimilar.mockResolvedValue([
        match({ content: 'Late fee is 2% of the balance.' }),
      ]);
      geminiService.generateText.mockResolvedValue('The late fee is 9999%.');

      const result = await service.answer(42, 'late fee?');

      expect(result.answer).toContain('The late fee is 9999%.');
      expect(result.answer).toContain('could not be verified');
    });

    it('does not flag an answer that contains no numbers at all', async () => {
      documentChunksService.searchSimilar.mockResolvedValue([match()]);
      geminiService.generateText.mockResolvedValue(
        'No fees are mentioned in your statement.',
      );

      const result = await service.answer(42, 'late fee?');

      expect(result.answer).toBe('No fees are mentioned in your statement.');
    });

    it('ignores comma formatting when comparing numbers (10,000 grounds 10000)', async () => {
      documentChunksService.searchSimilar.mockResolvedValue([
        match({ content: 'Annual fee is 10,000 rupees.' }),
      ]);
      geminiService.generateText.mockResolvedValue('The annual fee is 10000.');

      const result = await service.answer(42, 'annual fee?');

      expect(result.answer).toBe('The annual fee is 10000.');
    });
  });
});
