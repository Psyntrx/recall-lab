export type DocumentType = "textbook" | "lecture_notes" | "past_paper" | "cat" | "reference";

export type DocumentPage = {
  page: number;
  text: string;
  source: "native" | "ocr";
  ocrFailed?: boolean;
};

export type ChapterInfo = {
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  chunkCount: number;
};

export type DocumentChunk = {
  id: string;
  documentId: string;
  documentName: string;
  documentType: DocumentType;
  pageStart: number;
  pageEnd: number;
  chapterId?: string;
  chapterTitle?: string;
  section?: string;
  text: string;
  wordCount: number;
};

export type ExtractedAssessmentQuestion = {
  id: string;
  wording: string;
  marks?: string;
  subquestions?: string[];
  sourceDocument: string;
  page: number;
  matchedChapterId?: string;
  matchedTopic?: string;
  confidence?: "high" | "medium" | "low";
  isRepeated?: boolean;
  repeatCount?: number;
};

export type AssessmentCoverageItem = {
  topic: string;
  chapterId?: string;
  pastPaperQuestionCount: number;
  frequency: "High" | "Moderate" | "Low" | "None";
  sampleQuestions: string[];
};

export type AssessmentCoverageMap = Record<string, AssessmentCoverageItem>;

export type NormalizedDocument = {
  id?: string;
  filename: string;
  documentType?: DocumentType;
  pages: DocumentPage[];
  text: string;
  wordCount: number;
  truncated: boolean;
  chapters?: ChapterInfo[];
  chunks?: DocumentChunk[];
  extractedQuestions?: ExtractedAssessmentQuestion[];
};

export type ProcessingProgress = {
  stage:
    | "validating"
    | "extracting"
    | "ocr"
    | "identifying_chapters"
    | "indexing"
    | "analyzing_assessments"
    | "generating"
    | "complete"
    | "failed"
    | "cancelled";
  current?: number;
  total?: number;
  message: string;
};
