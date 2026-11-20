import type { ChapterInfo, DocumentChunk, DocumentPage, DocumentType } from "./types";
import { meaningfulWords } from "./validation";

export function createDocumentChunks(params: {
  documentId: string;
  documentName: string;
  documentType: DocumentType;
  pages: DocumentPage[];
  chapters: ChapterInfo[];
}): DocumentChunk[] {
  const { documentId, documentName, documentType, pages, chapters } = params;
  const chunks: DocumentChunk[] = [];
  let chunkCounter = 1;

  for (const page of pages) {
    if (!page.text || page.text.trim().length === 0) continue;

    // Determine which chapter this page belongs to
    const chapter = chapters.find((ch) => page.page >= ch.pageStart && page.page <= ch.pageEnd);

    // Split page text into paragraphs or sub-blocks if large
    const paragraphs = page.text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    let currentText = "";
    let currentWords = 0;

    for (const para of paragraphs) {
      const words = meaningfulWords(para);
      if (currentWords + words > 600 && currentText) {
        chunks.push({
          id: `${documentId}-chunk-${chunkCounter++}`,
          documentId,
          documentName,
          documentType,
          pageStart: page.page,
          pageEnd: page.page,
          chapterId: chapter?.id,
          chapterTitle: chapter?.title,
          text: currentText.trim(),
          wordCount: currentWords,
        });
        currentText = para;
        currentWords = words;
      } else {
        currentText += (currentText ? "\n\n" : "") + para;
        currentWords += words;
      }
    }

    if (currentText.trim().length > 0) {
      chunks.push({
        id: `${documentId}-chunk-${chunkCounter++}`,
        documentId,
        documentName,
        documentType,
        pageStart: page.page,
        pageEnd: page.page,
        chapterId: chapter?.id,
        chapterTitle: chapter?.title,
        text: currentText.trim(),
        wordCount: currentWords,
      });
    }
  }

  // Update chunk count in chapters
  for (const chapter of chapters) {
    chapter.chunkCount = chunks.filter((c) => c.chapterId === chapter.id).length;
  }

  return chunks;
}

export type SearchResult = {
  chunk: DocumentChunk;
  score: number;
};

// In-memory BM25-style Search Index
export class SearchIndex {
  private chunks: DocumentChunk[] = [];
  private invertedIndex: Map<string, Array<{ chunkIndex: number; tf: number }>> = new Map();
  private docLengths: number[] = [];
  private avgDocLength = 0;

  constructor(chunks: DocumentChunk[] = []) {
    if (chunks.length > 0) {
      this.build(chunks);
    }
  }

  public build(chunks: DocumentChunk[]) {
    this.chunks = chunks;
    this.invertedIndex.clear();
    this.docLengths = [];
    let totalLength = 0;

    for (let i = 0; i < chunks.length; i++) {
      const tokens = this.tokenize(chunks[i].text + " " + (chunks[i].chapterTitle ?? ""));
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
      }

      for (const [term, count] of termCounts.entries()) {
        const postings = this.invertedIndex.get(term) ?? [];
        postings.push({ chunkIndex: i, tf: count / tokens.length });
        this.invertedIndex.set(term, postings);
      }
    }

    this.avgDocLength = chunks.length ? totalLength / chunks.length : 1;
  }

  public search(query: string, options?: { chapterIds?: string[]; limit?: number }): SearchResult[] {
    const limit = options?.limit ?? 8;
    const queryTokens = this.tokenize(query);
    if (!queryTokens.length || !this.chunks.length) return [];

    const scores = new Map<number, number>();
    const N = this.chunks.length;
    const k1 = 1.5;
    const b = 0.75;

    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      const n = postings.length;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));

      for (const posting of postings) {
        const chunk = this.chunks[posting.chunkIndex];
        // Filter by chapter if requested
        if (options?.chapterIds && options.chapterIds.length > 0) {
          if (!chunk.chapterId || !options.chapterIds.includes(chunk.chapterId)) {
            continue;
          }
        }

        const docLen = this.docLengths[posting.chunkIndex];
        const tf = posting.tf;
        const bm25 = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docLen) / this.avgDocLength)));

        scores.set(posting.chunkIndex, (scores.get(posting.chunkIndex) ?? 0) + bm25);
      }
    }

    const results: SearchResult[] = [];
    for (const [chunkIndex, score] of scores.entries()) {
      results.push({
        chunk: this.chunks[chunkIndex],
        score,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  public getChunksByChapter(chapterId: string): DocumentChunk[] {
    return this.chunks.filter((c) => c.chapterId === chapterId);
  }

  public getAllChunks(): DocumentChunk[] {
    return this.chunks;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }
}
