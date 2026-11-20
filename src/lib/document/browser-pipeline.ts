import { validateUpload, assertSufficientMaterial } from "./validation";
import { extractTxt, normalizePages } from "./extract";
import { extractPdfInBrowser } from "./browser-extract";
import { classifyDocument } from "./classification";
import { detectChapters } from "./chapters";
import { createDocumentChunks, SearchIndex } from "./index";
import { extractAssessmentQuestions } from "@/lib/assessment/extract";
import {
  buildAssessmentCoverageMap,
  detectRepeatedQuestions,
  matchQuestionsToChapters,
} from "@/lib/assessment/analysis";
import type {
  AssessmentCoverageMap,
  ChapterInfo,
  DocumentChunk,
  ExtractedAssessmentQuestion,
  NormalizedDocument,
  ProcessingProgress,
} from "./types";

export type ClientProcessingOptions = {
  questionCount?: number;
  selectedChapters?: string[];
  focus?: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
};

export type ProcessedDocumentsResult = {
  masterDoc: NormalizedDocument;
  assessmentContext?: string;
  detectedChapters: ChapterInfo[];
  coverageMap?: AssessmentCoverageMap;
  extractedQuestionsCount: number;
};

/**
 * Runs the entire document analysis pipeline directly inside the browser.
 * PDFs and notes are read and parsed in client memory; original binaries never leave the client.
 */
export async function processDocumentsInBrowser(
  files: File[],
  options: ClientProcessingOptions | undefined,
  onProgress: (progress: ProcessingProgress) => void,
  signal?: AbortSignal
): Promise<ProcessedDocumentsResult> {
  if (!files.length) {
    throw new Error("At least one document is required.");
  }

  for (const file of files) {
    validateUpload(file);
  }

  const allNormalizedDocs: NormalizedDocument[] = [];
  const allChunks: DocumentChunk[] = [];
  let aggregatedChapters: ChapterInfo[] = [];
  const allExtractedQuestions: ExtractedAssessmentQuestion[] = [];

  for (let fIndex = 0; fIndex < files.length; fIndex++) {
    if (signal?.aborted) throw new Error("Processing was cancelled.");

    const file = files[fIndex];
    const filePrefix = `[${fIndex + 1}/${files.length} ${file.name}]`;

    onProgress({
      stage: "extracting",
      message: `${filePrefix} Extracting content...`,
    });

    let normDoc: NormalizedDocument;

    if (file.name.toLowerCase().endsWith(".txt")) {
      normDoc = await extractTxt(file);
    } else {
      const result = await extractPdfInBrowser(
        file,
        (p) => {
          onProgress({
            stage: p.stage,
            current: p.current,
            total: p.total,
            message: `${filePrefix} ${p.message}`,
          });
        },
        signal
      );

      await result.pdf.destroy();
      normDoc = result.document;
    }

    // Document classification
    const docType = classifyDocument(file.name, normDoc.text);
    normDoc.documentType = docType;
    normDoc.id = `doc-${fIndex + 1}`;

    // Chapter detection for textbooks & lecture notes
    onProgress({
      stage: "identifying_chapters",
      message: `${filePrefix} Detecting chapters and sections...`,
    });

    const chapters = detectChapters(normDoc.pages);
    normDoc.chapters = chapters;
    if (docType === "textbook" || aggregatedChapters.length === 0) {
      aggregatedChapters = chapters;
    }

    // Chunking for search indexing
    onProgress({
      stage: "indexing",
      message: `${filePrefix} Indexing content for retrieval...`,
    });

    const chunks = createDocumentChunks({
      documentId: normDoc.id,
      documentName: file.name,
      documentType: docType,
      pages: normDoc.pages,
      chapters,
    });

    normDoc.chunks = chunks;
    allChunks.push(...chunks);

    // Assessment question extraction
    if (docType === "past_paper" || docType === "cat") {
      onProgress({
        stage: "analyzing_assessments",
        message: `${filePrefix} Extracting assessment questions...`,
      });

      const examQuestions = extractAssessmentQuestions({
        documentName: file.name,
        pages: normDoc.pages,
      });

      normDoc.extractedQuestions = examQuestions;
      allExtractedQuestions.push(...examQuestions);
    }

    allNormalizedDocs.push(normDoc);

    // Yield control so UI stays fluid
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Cross-reference extracted assessment questions if present
  let processedAssessmentQuestions: ExtractedAssessmentQuestion[] = [];
  let coverageMap: AssessmentCoverageMap | undefined;

  if (allExtractedQuestions.length > 0) {
    onProgress({
      stage: "analyzing_assessments",
      message: "Matching assessment questions to textbook chapters...",
    });

    const searchIndex = new SearchIndex(allChunks);
    const matchedQuestions = matchQuestionsToChapters({
      questions: allExtractedQuestions,
      chapters: aggregatedChapters,
      index: searchIndex,
    });

    processedAssessmentQuestions = detectRepeatedQuestions(matchedQuestions);
    coverageMap = buildAssessmentCoverageMap({
      questions: processedAssessmentQuestions,
      chapters: aggregatedChapters,
    });
  }

  // Combine documents into master document for generation
  const combinedText = allNormalizedDocs
    .map((d) => `=== DOCUMENT: ${d.filename} (${d.documentType}) ===\n${d.text}`)
    .join("\n\n");

  const masterDoc: NormalizedDocument = {
    filename: allNormalizedDocs.map((d) => d.filename).join(", "),
    pages: allNormalizedDocs.flatMap((d) => d.pages),
    text: combinedText,
    wordCount: allNormalizedDocs.reduce((sum, d) => sum + d.wordCount, 0),
    truncated: allNormalizedDocs.some((d) => d.truncated),
    chapters: aggregatedChapters,
    chunks: allChunks,
    extractedQuestions: processedAssessmentQuestions,
  };

  assertSufficientMaterial(masterDoc.text);

  // Prepare context of past assessment questions if available
  let assessmentContext = "";
  if (processedAssessmentQuestions.length > 0) {
    const topQuestions = processedAssessmentQuestions.slice(0, 15);
    assessmentContext = `Extracted Past Examination Questions:\n${topQuestions
      .map(
        (q, i) =>
          `${i + 1}. [${q.sourceDocument}${q.marks ? ` ${q.marks}` : ""}] ${q.wording}${
            q.isRepeated ? ` (Repeated in multiple assessments: ${q.repeatCount}x)` : ""
          }`
      )
      .join("\n")}`;
  }

  return {
    masterDoc,
    assessmentContext: assessmentContext || undefined,
    detectedChapters: aggregatedChapters,
    coverageMap,
    extractedQuestionsCount: processedAssessmentQuestions.length,
  };
}
