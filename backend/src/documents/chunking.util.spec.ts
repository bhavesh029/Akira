import { chunkText } from './chunking.util';

describe('chunkText', () => {
  it('returns [] for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('returns [] for whitespace-only text', () => {
    expect(chunkText('   \n\n  \t  ')).toEqual([]);
  });

  it('returns a single chunk when text is shorter than chunkSize', () => {
    const result = chunkText('short statement text', 800, 150);
    expect(result).toEqual([{ content: 'short statement text', index: 0 }]);
  });

  it('trims leading/trailing whitespace from the input', () => {
    const result = chunkText('   hello world   ', 800, 150);
    expect(result).toEqual([{ content: 'hello world', index: 0 }]);
  });

  it('hard-splits text with no newlines into overlapping windows', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars, no newlines
    const result = chunkText(text, 10, 3);
    expect(result.map((c) => c.content)).toEqual([
      'abcdefghij',
      'hijklmnopq',
      'opqrstuvwx',
      'vwxyz',
    ]);
  });

  it('assigns sequential zero-based indices', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = chunkText(text, 10, 3);
    expect(result.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('never produces a chunk longer than chunkSize', () => {
    const text = 'x'.repeat(5000);
    const result = chunkText(text, 800, 150);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.content.length).toBeLessThanOrEqual(800);
    }
  });

  it('consecutive chunks overlap (the tail of one reappears at the head of the next)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = chunkText(text, 10, 3);
    // chunk0 = "abcdefghij", chunk1 = "hijklmnopq" — shares "hij"
    expect(result[0].content.slice(-3)).toBe(result[1].content.slice(0, 3));
  });

  it('snaps to the last newline within the window when one leaves a reasonably-sized chunk', () => {
    const line1 = 'A'.repeat(20);
    const line2 = 'B'.repeat(20);
    const text = `${line1}\n${line2}`;
    const result = chunkText(text, 20, 5);
    // First chunk should stop exactly at the line boundary, not mid-line.
    expect(result[0].content).toBe(line1);
  });

  it('does not degenerate into near-empty chunks on sparse newlines (falls back to a hard split instead)', () => {
    const line1 = 'A'.repeat(20);
    const line2 = 'B'.repeat(20);
    const text = `${line1}\n${line2}`;
    const result = chunkText(text, 20, 5);
    // Every chunk after the first carries real content, not a 1-2 char sliver.
    for (const chunk of result.slice(1)) {
      expect(chunk.content.length).toBeGreaterThan(5);
    }
  });

  it('terminates (no infinite loop) even when overlap >= chunkSize', () => {
    const text = 'x'.repeat(100);
    const result = chunkText(text, 10, 10);
    expect(result.length).toBeGreaterThan(0);
    expect(result[result.length - 1].content.length).toBeGreaterThan(0);
  });

  it('reconstructs the full text when overlaps are accounted for (no content silently dropped)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const result = chunkText(text, 10, 3);
    // Concatenate, dropping each chunk's leading overlap with the previous one.
    let rebuilt = result[0].content;
    for (let i = 1; i < result.length; i++) {
      rebuilt += result[i].content.slice(3);
    }
    expect(rebuilt).toBe(text);
  });
});
