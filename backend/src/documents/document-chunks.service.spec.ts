import { DocumentChunksService } from './document-chunks.service';

describe('DocumentChunksService', () => {
  let service: DocumentChunksService;
  let documentChunksRepository: { manager: { query: jest.Mock } };
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = jest.fn().mockResolvedValue([]);
    documentChunksRepository = { manager: { query: mockQuery } };
    service = new DocumentChunksService(documentChunksRepository as any);
  });

  describe('insertChunks', () => {
    it('does nothing (no query) for an empty chunk list', async () => {
      await service.insertChunks(1, []);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('inserts a single chunk with a vector-cast placeholder', async () => {
      await service.insertChunks(1, [
        { content: 'hello', embedding: [0.1, 0.2] },
      ]);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain(
        'INSERT INTO document_chunks (document_id, content, embedding)',
      );
      expect(sql).toContain('($1, $2, $3::vector)');
      expect(params).toEqual([1, 'hello', '[0.1,0.2]']);
    });

    it('builds one multi-row INSERT for several chunks, in order', async () => {
      await service.insertChunks(7, [
        { content: 'chunk one', embedding: [0.1] },
        { content: 'chunk two', embedding: [0.2] },
      ]);

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('($1, $2, $3::vector), ($4, $5, $6::vector)');
      expect(params).toEqual([
        7,
        'chunk one',
        '[0.1]',
        7,
        'chunk two',
        '[0.2]',
      ]);
    });
  });

  describe('searchSimilar', () => {
    it('scopes the search to the given userId via the documents join, and orders by distance', async () => {
      const rows = [
        {
          id: 1,
          documentId: 10,
          documentTitle: 'March Statement',
          content: 'late fee is 2%',
          distance: 0.12,
        },
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await service.searchSimilar(5, [0.3, 0.4], 3);

      expect(result).toBe(rows);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE d.user_id = $2');
      expect(sql).toContain('ORDER BY dc.embedding <=> $1::vector ASC');
      expect(sql).toContain('LIMIT $3');
      expect(params).toEqual(['[0.3,0.4]', 5, 3]);
    });

    it('defaults the limit to 5 when not provided', async () => {
      await service.searchSimilar(5, [0.1]);
      const [, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['[0.1]', 5, 5]);
    });
  });
});
