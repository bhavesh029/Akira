export interface TextChunk {
  content: string;
  index: number;
}

const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 150;

/**
 * Hand-rolled splitter (no chunking library installed, and the plan deliberately
 * avoids adding one) for Phase 3's raw statement text indexing. Splits on the
 * last line boundary within each ~chunkSize window when one exists, so lines
 * aren't cut mid-word; falls back to a hard character cut otherwise. Each
 * chunk after the first repeats ~overlap trailing characters of the previous
 * one, so a sentence split right at a boundary is still findable from either
 * chunk's embedding.
 */
export function chunkText(
  text: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_CHUNK_OVERLAP,
): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const rawChunks: string[] = [];
  let start = 0;
  // A newline boundary only gets used if it leaves at least half a chunk's
  // worth of content — otherwise, on text with few/sparse newlines, the
  // overlap step can keep re-snapping to the same nearby newline and emit a
  // run of near-empty chunks instead of properly-sized ones.
  const minBoundaryOffset = Math.floor(chunkSize / 2);

  while (start < trimmed.length) {
    let end = Math.min(start + chunkSize, trimmed.length);

    if (end < trimmed.length) {
      const lastNewline = trimmed.lastIndexOf('\n', end);
      if (lastNewline > start + minBoundaryOffset) {
        end = lastNewline;
      }
    }

    const chunk = trimmed.slice(start, end).trim();
    if (chunk) rawChunks.push(chunk);

    if (end >= trimmed.length) break;
    // Guarantees forward progress even when overlap >= (end - start), which
    // would otherwise loop forever on a very short line-bounded window.
    start = Math.max(end - overlap, start + 1);
  }

  return rawChunks.map((content, index) => ({ content, index }));
}
