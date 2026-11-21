import { z } from "zod";

export const chunkSummaryResponseSchema = z.object({
  title: z.string().default("Section Summary"),
  summary: z.string().min(1),
  keyConcepts: z.array(z.string()).default([]),
  definitionsAndFormulas: z.array(z.string()).default([]),
  keyFacts: z.array(z.string()).default([]),
  sourceReference: z.string().nullable().optional(),
});

export type ChunkSummaryResponse = z.infer<typeof chunkSummaryResponseSchema>;

export type ChunkSummary = {
  chunkIndex: number;
  totalChunks: number;
  title: string;
  summary: string;
  keyConcepts: string[];
  definitionsAndFormulas: string[];
  keyFacts: string[];
  sourceReference: string;
  chapterTitle?: string;
  pageStart: number;
  pageEnd: number;
};

export type ConsolidatedChapter = {
  title: string;
  pageRange: string;
  summary: string;
  concepts: string[];
  formulas: string[];
};

export type ConsolidatedDocument = {
  title: string;
  executiveSummary: string;
  keyTopics: string[];
  chunkSummaries: ChunkSummary[];
  allKeyConcepts: string[];
  allDefinitionsAndFormulas: string[];
  allKeyFacts: string[];
  chapters: ConsolidatedChapter[];
  totalChunks: number;
  totalPages: number;
  consolidatedText: string;
};

export const chunkSummarySystemPrompt = `You are an expert academic summarizer and study coach.
Analyze the provided excerpt from the learning materials.
Extract key principles, definitions, formulas, and facts with precision.
Preserve exact scientific terminology, mathematical formulas, and section context.
Return ONLY a valid JSON object matching this schema:
{
  "title": "Concise section or topic title",
  "summary": "Clear, high-yield summary of key conceptual principles (2-3 paragraphs)",
  "keyConcepts": ["Concept 1", "Concept 2", ...],
  "definitionsAndFormulas": ["Formula or definition 1", ...],
  "keyFacts": ["Key factual statement 1", ...]
}`;

/**
 * Combines intermediate chunk summaries into a structured, consolidated document representation.
 * Deduplicates concepts, formulas, and facts while maintaining source references and chapter boundaries.
 * The consolidated representation is compact (~800–1,500 tokens) and avoids re-sending full source texts.
 */
export function consolidateChunkSummaries(
  chunkSummaries: ChunkSummary[],
  documentTitle = "Study Material"
): ConsolidatedDocument {
  if (chunkSummaries.length === 0) {
    return {
      title: documentTitle,
      executiveSummary: "No material available.",
      keyTopics: [],
      chunkSummaries: [],
      allKeyConcepts: [],
      allDefinitionsAndFormulas: [],
      allKeyFacts: [],
      chapters: [],
      totalChunks: 0,
      totalPages: 0,
      consolidatedText: "No material available.",
    };
  }

  // Deduplicate and aggregate key concepts, definitions, formulas, and facts
  const seenConcepts = new Set<string>();
  const allKeyConcepts: string[] = [];
  for (const cs of chunkSummaries) {
    for (const concept of cs.keyConcepts) {
      const normalized = concept.trim();
      const lower = normalized.toLowerCase();
      if (normalized && !seenConcepts.has(lower)) {
        seenConcepts.add(lower);
        allKeyConcepts.push(normalized);
      }
    }
  }

  const seenFormulas = new Set<string>();
  const allDefinitionsAndFormulas: string[] = [];
  for (const cs of chunkSummaries) {
    for (const df of cs.definitionsAndFormulas) {
      const normalized = df.trim();
      const lower = normalized.toLowerCase();
      if (normalized && !seenFormulas.has(lower)) {
        seenFormulas.add(lower);
        allDefinitionsAndFormulas.push(normalized);
      }
    }
  }

  const seenFacts = new Set<string>();
  const allKeyFacts: string[] = [];
  for (const cs of chunkSummaries) {
    for (const fact of cs.keyFacts) {
      const normalized = fact.trim();
      const lower = normalized.toLowerCase();
      if (normalized && !seenFacts.has(lower)) {
        seenFacts.add(lower);
        allKeyFacts.push(normalized);
      }
    }
  }

  // Group by chapter or section
  const chapterMap = new Map<string, { summaries: string[]; concepts: string[]; formulas: string[]; pages: number[] }>();

  for (const cs of chunkSummaries) {
    const chKey = cs.chapterTitle || cs.title || `Section (Pages ${cs.pageStart}-${cs.pageEnd})`;
    const existing = chapterMap.get(chKey) ?? {
      summaries: [],
      concepts: [],
      formulas: [],
      pages: [],
    };
    existing.summaries.push(cs.summary);
    existing.concepts.push(...cs.keyConcepts);
    existing.formulas.push(...cs.definitionsAndFormulas);
    existing.pages.push(cs.pageStart, cs.pageEnd);
    chapterMap.set(chKey, existing);
  }

  const chapters: ConsolidatedChapter[] = [];
  for (const [title, data] of chapterMap.entries()) {
    const minPage = Math.min(...data.pages);
    const maxPage = Math.max(...data.pages);
    chapters.push({
      title,
      pageRange: minPage === maxPage ? `Page ${minPage}` : `Pages ${minPage}–${maxPage}`,
      summary: data.summaries.join("\n\n"),
      concepts: Array.from(new Set(data.concepts)).slice(0, 8),
      formulas: Array.from(new Set(data.formulas)).slice(0, 6),
    });
  }

  const executiveSummary = chunkSummaries.map((cs) => cs.summary).join("\n\n");
  const keyTopics = allKeyConcepts.slice(0, 12);
  const minTotalPage = Math.min(...chunkSummaries.map((c) => c.pageStart));
  const maxTotalPage = Math.max(...chunkSummaries.map((c) => c.pageEnd));
  const totalPages = Math.max(1, maxTotalPage - minTotalPage + 1);

  // Build markdown representation
  const sectionsText = chapters
    .map(
      (ch) =>
        `### ${ch.title} (${ch.pageRange})\n${ch.summary}${
          ch.concepts.length ? `\nKey Concepts: ${ch.concepts.join(", ")}` : ""
        }${ch.formulas.length ? `\nDefinitions & Formulas:\n${ch.formulas.map((f) => `- ${f}`).join("\n")}` : ""}`
    )
    .join("\n\n");

  const consolidatedText = `# ${documentTitle} — Consolidated Learning Representation

## Executive Summary
${executiveSummary}

## Key Topics & Conceptual Coverage
${keyTopics.map((t) => `- ${t}`).join("\n")}

${
  allDefinitionsAndFormulas.length
    ? `## Essential Definitions & Formulas\n${allDefinitionsAndFormulas
        .slice(0, 15)
        .map((f) => `- ${f}`)
        .join("\n")}\n\n`
    : ""
}## Section Summaries
${sectionsText}`;

  return {
    title: chunkSummaries[0]?.title && chunkSummaries[0].title !== "Section Summary"
      ? chunkSummaries[0].title
      : documentTitle,
    executiveSummary,
    keyTopics,
    chunkSummaries,
    allKeyConcepts,
    allDefinitionsAndFormulas,
    allKeyFacts,
    chapters,
    totalChunks: chunkSummaries.length,
    totalPages,
    consolidatedText,
  };
}
