import type { ChapterInfo, DocumentPage, NormalizedDocument } from "./types";

export type TokenAwareChunk = {
  id: string;
  index: number;
  totalChunks?: number;
  text: string;
  estimatedTokens: number;
  wordCount: number;
  pageStart: number;
  pageEnd: number;
  chapterId?: string;
  chapterTitle?: string;
  documentName?: string;
  section?: string;
};

/**
 * Conservative token estimator.
 * Never assumes a fixed character-to-token ratio.
 * Combines subword/pattern matching, whitespace analysis, punctuation density,
 * and conservative character ratios to ensure token counts are never underestimated.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // 1. Subword & pattern-based token estimation
  // Matches words, numbers, punctuation symbols, whitespace sequences
  const matches = text.match(/\w+|[^\w\s]|\s+/g);
  let patternTokens = 0;
  if (matches) {
    for (const match of matches) {
      if (/^\s+$/.test(match)) {
        // Whitespace runs: every 4 chars is at least 1 token
        patternTokens += Math.ceil(match.length / 4);
      } else if (/^[^\w\s]$/.test(match)) {
        // Punctuation is 1 token each
        patternTokens += 1;
      } else if (/^\d+$/.test(match)) {
        // Digits: ~2.5 digits per token
        patternTokens += Math.max(1, Math.ceil(match.length / 2.5));
      } else {
        // Words: short words (<=4 chars) are 1 token; longer words split into subwords
        patternTokens += match.length <= 4 ? 1 : Math.ceil(match.length / 3.5);
      }
    }
  }

  // 2. Conservative character ratio: 1 token per 3.2 characters
  const charTokens = Math.ceil(text.length / 3.2);

  // 3. Conservative word-based ratio: ~1.35 tokens per word + punctuation overhead
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wordTokens = Math.ceil(words * 1.35);

  // Take the maximum of all methods to guarantee conservative estimation
  return Math.max(patternTokens, charTokens, wordTokens);
}

export type ChunkingOptions = {
  /** Maximum estimated tokens of document text per chunk (default: 2,200) */
  maxChunkTokens?: number;
  /** Estimated tokens of overlap context to carry between chunks (default: 150) */
  overlapTokens?: number;
};

export const DEFAULT_MAX_CHUNK_TOKENS = 2200;
export const DEFAULT_OVERLAP_TOKENS = 150;
export const SAFE_REQUEST_TOKEN_BUDGET = 3800;

type SemanticUnit = {
  text: string;
  tokens: number;
  words: number;
  page: number;
  chapterId?: string;
  chapterTitle?: string;
  documentName?: string;
};

/**
 * Splits document text into manageable, token-aware chunks targeting ~2,000–2,500 tokens of text
 * so the total AI request (including system prompt and instructions) remains ~3,000–4,000 tokens.
 *
 * Preserves:
 * - Page numbers (pageStart, pageEnd)
 * - Chapter boundaries and headings
 * - Paragraph and sentence structures (never splits words or sentences unnecessarily)
 * - Contextual overlap across chunk boundaries
 */
export function createTokenAwareChunks(
  doc:
    | NormalizedDocument
    | {
        text: string;
        pages?: DocumentPage[];
        chapters?: ChapterInfo[];
        filename?: string;
      },
  options?: ChunkingOptions
): TokenAwareChunk[] {
  const maxTokens = options?.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const documentName = doc.filename || "Document";
  const chapters = doc.chapters ?? [];
  const pages = doc.pages ?? [];

  // Break text into semantic units (paragraphs or sentences) with page & chapter metadata
  const units: SemanticUnit[] = [];

  if (pages.length > 0) {
    for (const pageObj of pages) {
      if (!pageObj.text || !pageObj.text.trim()) continue;
      const pageNum = pageObj.page;
      const matchedChapter = chapters.find(
        (ch) => pageNum >= ch.pageStart && pageNum <= ch.pageEnd
      );

      // Split page into paragraphs
      const paragraphs = pageObj.text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para);
        if (paraTokens <= maxTokens) {
          units.push({
            text: para,
            tokens: paraTokens,
            words: para.split(/\s+/).filter(Boolean).length,
            page: pageNum,
            chapterId: matchedChapter?.id,
            chapterTitle: matchedChapter?.title,
            documentName,
          });
        } else {
          // Paragraph exceeds chunk budget: split cleanly on sentence boundaries
          const sentences = para
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);

          let sentenceBuffer = "";
          let bufferTokens = 0;

          for (const sentence of sentences) {
            const sTokens = estimateTokens(sentence);
            if (bufferTokens + sTokens > maxTokens && sentenceBuffer) {
              units.push({
                text: sentenceBuffer,
                tokens: bufferTokens,
                words: sentenceBuffer.split(/\s+/).filter(Boolean).length,
                page: pageNum,
                chapterId: matchedChapter?.id,
                chapterTitle: matchedChapter?.title,
                documentName,
              });
              sentenceBuffer = sentence;
              bufferTokens = sTokens;
            } else {
              sentenceBuffer = sentenceBuffer ? `${sentenceBuffer} ${sentence}` : sentence;
              bufferTokens += sTokens;
            }
          }

          if (sentenceBuffer) {
            units.push({
              text: sentenceBuffer,
              tokens: bufferTokens,
              words: sentenceBuffer.split(/\s+/).filter(Boolean).length,
              page: pageNum,
              chapterId: matchedChapter?.id,
              chapterTitle: matchedChapter?.title,
              documentName,
            });
          }
        }
      }
    }
  } else {
    // No pages provided: split doc.text by paragraphs
    const paragraphs = (doc.text || "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    let syntheticPage = 1;
    for (const para of paragraphs) {
      // Check for chapter markers in paragraph
      const chapterMatch = para.match(/^(?:Chapter\s+(\d+|[IVXLCDM]+)[:\s-]*([^\n]*))/i);
      const chapterTitle = chapterMatch
        ? `Chapter ${chapterMatch[1]}${chapterMatch[2] ? `: ${chapterMatch[2].trim()}` : ""}`
        : undefined;

      const paraTokens = estimateTokens(para);
      if (paraTokens <= maxTokens) {
        units.push({
          text: para,
          tokens: paraTokens,
          words: para.split(/\s+/).filter(Boolean).length,
          page: syntheticPage,
          chapterTitle,
          documentName,
        });
      } else {
        const sentences = para
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        let sBuffer = "";
        let bTokens = 0;
        for (const s of sentences) {
          const sTokens = estimateTokens(s);
          if (bTokens + sTokens > maxTokens && sBuffer) {
            units.push({
              text: sBuffer,
              tokens: bTokens,
              words: sBuffer.split(/\s+/).filter(Boolean).length,
              page: syntheticPage,
              chapterTitle,
              documentName,
            });
            sBuffer = s;
            bTokens = sTokens;
          } else {
            sBuffer = sBuffer ? `${sBuffer} ${s}` : s;
            bTokens += sTokens;
          }
        }
        if (sBuffer) {
          units.push({
            text: sBuffer,
            tokens: bTokens,
            words: sBuffer.split(/\s+/).filter(Boolean).length,
            page: syntheticPage,
            chapterTitle,
            documentName,
          });
        }
      }

      // Advance synthetic page every ~500 words if no real pages
      if (units.length % 3 === 0) syntheticPage++;
    }
  }

  if (units.length === 0) {
    return [];
  }

  // Group units into chunks respecting maxTokens and chapter transitions
  const chunks: TokenAwareChunk[] = [];
  let currentUnits: SemanticUnit[] = [];
  let currentTokens = 0;
  let chunkIndex = 1;
  let overlapContext = "";

  const finalizeChunk = () => {
    if (currentUnits.length === 0) return;

    const pageStart = Math.min(...currentUnits.map((u) => u.page));
    const pageEnd = Math.max(...currentUnits.map((u) => u.page));
    const firstChapter = currentUnits.find((u) => u.chapterTitle);
    const chapterId = firstChapter?.chapterId;
    const chapterTitle = firstChapter?.chapterTitle;

    const rawChunkText = currentUnits.map((u) => u.text).join("\n\n");
    const fullText = overlapContext
      ? `[Context from previous section]:\n${overlapContext}\n\n${rawChunkText}`
      : rawChunkText;

    const chunkTokens = estimateTokens(fullText);
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    chunks.push({
      id: `chunk-${chunkIndex++}`,
      index: chunks.length,
      text: fullText,
      estimatedTokens: chunkTokens,
      wordCount,
      pageStart,
      pageEnd,
      chapterId,
      chapterTitle,
      documentName,
    });

    // Prepare overlap context for next chunk: take last sentences or paragraph up to overlapTokens
    const lastUnit = currentUnits[currentUnits.length - 1];
    if (lastUnit && overlapTokens > 0) {
      if (lastUnit.tokens <= overlapTokens) {
        overlapContext = lastUnit.text;
      } else {
        const sentences = lastUnit.text.split(/(?<=[.!?])\s+/);
        let tail = "";
        for (let i = sentences.length - 1; i >= 0; i--) {
          const cand = tail ? `${sentences[i]} ${tail}` : sentences[i];
          if (estimateTokens(cand) > overlapTokens && tail) break;
          tail = cand;
        }
        overlapContext = tail || lastUnit.text.slice(-300);
      }
    } else {
      overlapContext = "";
    }

    currentUnits = [];
    currentTokens = 0;
  };

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];

    // Preserve chapter boundaries: start a new chunk when chapter changes
    const prevUnit = units[i - 1];
    const isNewChapter =
      (Boolean(unit.chapterTitle) &&
        Boolean(prevUnit?.chapterTitle) &&
        unit.chapterTitle !== prevUnit?.chapterTitle) ||
      (Boolean(unit.chapterId) &&
        Boolean(prevUnit?.chapterId) &&
        unit.chapterId !== prevUnit?.chapterId);

    if (
      currentTokens + unit.tokens > maxTokens ||
      (isNewChapter && currentUnits.length > 0)
    ) {
      finalizeChunk();
    }

    currentUnits.push(unit);
    currentTokens += unit.tokens;
  }

  finalizeChunk();

  // Populate totalChunks on each chunk
  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length;
  }

  return chunks;
}
