import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../documents/gemini.service';
import {
  DocumentChunksService,
  type ChunkSearchResult,
} from '../documents/document-chunks.service';
import type {
  FinanceChatResult,
  FinanceChatSource,
} from './finance-chat.types';

const MAX_MATCHES = 5;
const SNIPPET_LENGTH = 220;

const NO_MATCH_ANSWER =
  "I couldn't find anything in your uploaded statements about that. Try asking about spending totals, categories, or upload more statements and ask again.";

const GENERATION_FAILED_ANSWER =
  'I had trouble generating an answer just now. Please try again in a moment.';

/**
 * Grounded chat / semantic search over raw statement text — deliberately
 * separate in code from AnalyticsService.financeChat's deterministic-SQL
 * path (see docs/phases/phase-3-rag.md), so that path's "the LLM never
 * states a number the user sees as fact" guarantee is never put at risk by
 * this one. Here the LLM necessarily reads and paraphrases free text (there
 * is no SQL equivalent for "what does my statement say about late fees"),
 * so the guarantee is enforced differently: the prompt instructs the model
 * to answer ONLY from the retrieved excerpts, and every numeric figure in
 * the answer is checked against those excerpts afterward (see
 * `verifyGroundedAnswer`) — same pattern as AnalyticsService.verifyAnomalies,
 * applied to unstructured text instead of structured transactions.
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly documentChunksService: DocumentChunksService,
  ) {}

  async answer(userId: number, question: string): Promise<FinanceChatResult> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.geminiService.embedText(question);
    } catch (err) {
      this.logger.warn(`RAG question embedding failed: ${err}`);
      return { answer: GENERATION_FAILED_ANSWER };
    }

    const matches = await this.documentChunksService.searchSimilar(
      userId,
      queryEmbedding,
      MAX_MATCHES,
    );

    if (matches.length === 0) {
      return { answer: NO_MATCH_ANSWER };
    }

    const context = this.buildContext(matches);
    const prompt = this.buildPrompt(context, question);

    const rawAnswer = await this.geminiService.generateText(prompt);
    if (!rawAnswer) {
      return { answer: GENERATION_FAILED_ANSWER };
    }

    const answer = this.verifyGroundedAnswer(rawAnswer, context);
    const sources: FinanceChatSource[] = matches.map((m) => ({
      documentId: m.documentId,
      documentTitle: m.documentTitle,
      snippet:
        m.content.length > SNIPPET_LENGTH
          ? `${m.content.slice(0, SNIPPET_LENGTH)}…`
          : m.content,
    }));

    return { answer, sources };
  }

  private buildContext(matches: ChunkSearchResult[]): string {
    return matches
      .map((m, i) => `[${i + 1}] (from "${m.documentTitle}")\n${m.content}`)
      .join('\n\n');
  }

  private buildPrompt(context: string, question: string): string {
    return `You are answering a question about the user's own bank statements, using ONLY the excerpts below. These excerpts were retrieved by semantic search and may not be exhaustive or fully relevant.

CRITICAL - Financial Accuracy:
- Do not invent, guess, or infer any number, date, fee, percentage, or term that is not explicitly present in the excerpts.
- If the excerpts don't contain the answer, say so plainly instead of guessing.

Excerpts:
${context}

Question: ${question}

Answer concisely (2-4 sentences), citing excerpt numbers like [1] where relevant.`;
  }

  /**
   * Every numeric figure (amount, percentage, etc.) the model's answer
   * states must appear verbatim somewhere in the retrieved excerpts it was
   * given — if one doesn't, the answer is kept (dropping free text risks
   * mangling it, unlike a structured field) but flagged, since an invented
   * figure is exactly the failure mode this check exists to catch.
   */
  private verifyGroundedAnswer(answer: string, context: string): string {
    const numbers = answer.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? [];
    if (numbers.length === 0) return answer;

    const contextNumbers = new Set(
      (context.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((n) =>
        n.replace(/,/g, ''),
      ),
    );
    const ungrounded = numbers.filter(
      (n) => !contextNumbers.has(n.replace(/,/g, '')),
    );

    if (ungrounded.length === 0) return answer;

    this.logger.warn(
      `RAG answer contained figures not present in the retrieved excerpts: ${ungrounded.join(', ')}`,
    );
    return `${answer}\n\n(Note: some figures above could not be verified against your statement text — double-check them against the source document.)`;
  }
}
