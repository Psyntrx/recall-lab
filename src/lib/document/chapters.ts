import type { ChapterInfo, DocumentPage } from "./types";

export function detectChapters(pages: DocumentPage[]): ChapterInfo[] {
  if (!pages.length) return [];
  const maxPageFromData = Math.max(...pages.map((p) => p.page), pages.length);
  const totalPages = maxPageFromData;

  // Strategy 1: Check Table of Contents in the first 35 pages
  const tocCandidates = pages.slice(0, Math.min(35, pages.length));
  const tocText = tocCandidates.map((p) => p.text).join("\n");

  const tocChapters: Array<{ numberStr: string; title: string; pageNum: number }> = [];
  const tocRegex = /(?:Chapter|CHAPTER|Unit|UNIT|Module|MODULE)\s+(\d+|[IVXLCDM]+)[:.\s]+([^\n\d.]{3,70})[.\s_]{2,}(\d+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tocRegex.exec(tocText)) !== null) {
    const num = match[1].trim();
    const title = match[2].trim();
    const targetPage = parseInt(match[3].trim(), 10);
    if (!isNaN(targetPage) && targetPage > 0 && targetPage <= totalPages + 100) {
      tocChapters.push({ numberStr: num, title: `Chapter ${num}: ${title}`, pageNum: targetPage });
    }
  }

  if (tocChapters.length >= 2) {
    tocChapters.sort((a, b) => a.pageNum - b.pageNum);
    const result: ChapterInfo[] = [];
    for (let i = 0; i < tocChapters.length; i++) {
      const current = tocChapters[i];
      const next = tocChapters[i + 1];
      const start = Math.max(1, current.pageNum);
      const end = next ? Math.max(start, next.pageNum - 1) : totalPages;
      result.push({
        id: `ch-${current.numberStr.toLowerCase()}`,
        title: current.title,
        pageStart: start,
        pageEnd: end,
        chunkCount: 0,
      });
    }
    return result;
  }

  // Strategy 2: Direct Page Scanning for Chapter Headings
  const detectedHeadingChapters: Array<{ id: string; title: string; page: number }> = [];
  const chapterHeadingRegex = /(?:^|\n)\s*(?:Chapter|CHAPTER|Unit|UNIT|Module|MODULE)\s+(\d+|[IVXLCDM]+)[:.\s-—]+([^\n]{3,80})/i;

  for (const page of pages) {
    const headingMatch = page.text.match(chapterHeadingRegex);
    if (headingMatch) {
      const num = headingMatch[1].trim();
      const rawTitle = headingMatch[2].trim();
      const cleanTitle = rawTitle.split(/\.\s|\n/)[0].trim();
      const id = `ch-${num.toLowerCase()}`;
      const existing = detectedHeadingChapters.find((c) => c.id === id);
      if (!existing) {
        detectedHeadingChapters.push({
          id,
          title: `Chapter ${num}: ${cleanTitle}`,
          page: page.page,
        });
      }
    }
  }

  if (detectedHeadingChapters.length >= 2) {
    detectedHeadingChapters.sort((a, b) => a.page - b.page);
    const result: ChapterInfo[] = [];
    for (let i = 0; i < detectedHeadingChapters.length; i++) {
      const current = detectedHeadingChapters[i];
      const next = detectedHeadingChapters[i + 1];
      const pageStart = current.page;
      const pageEnd = next ? Math.max(pageStart, next.page - 1) : totalPages;
      result.push({
        id: current.id,
        title: current.title,
        pageStart,
        pageEnd,
        chunkCount: 0,
      });
    }
    return result;
  }

  // Strategy 3: Fallback for unsegmented or short documents
  if (totalPages <= 5) {
    return [
      {
        id: "ch-all",
        title: "Complete Document",
        pageStart: 1,
        pageEnd: totalPages,
        chunkCount: 0,
      },
    ];
  }

  const segmentCount = Math.min(8, Math.max(2, Math.ceil(totalPages / 15)));
  const pagesPerSegment = Math.ceil(totalPages / segmentCount);
  const fallbackChapters: ChapterInfo[] = [];

  for (let s = 0; s < segmentCount; s++) {
    const pageStart = s * pagesPerSegment + 1;
    const pageEnd = Math.min(totalPages, (s + 1) * pagesPerSegment);
    if (pageStart <= totalPages) {
      fallbackChapters.push({
        id: `section-${s + 1}`,
        title: `Section ${s + 1} (Pages ${pageStart}–${pageEnd})`,
        pageStart,
        pageEnd,
        chunkCount: 0,
      });
    }
  }

  return fallbackChapters;
}
