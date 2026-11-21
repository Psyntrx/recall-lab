import type { NormalizedDocument, ProcessingProgress } from "@/lib/document/types";
import type { QuestionSet, RevisionPlan, DocumentSummary } from "@/lib/quiz/schemas";

export type QuestionGenerationInput = {
  document: NormalizedDocument;
  maxQuestions: number;
  selectedChapters?: string[];
  focus?: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
  assessmentQuestionsContext?: string;
  onProgress?: (progress: ProcessingProgress) => void;
};

export type RecommendationInput = {
  score: number;
  total: number;
  misses: unknown[];
  document: NormalizedDocument;
};

export type DocumentSummaryInput = {
  document: NormalizedDocument | string;
  focus?: string;
  onProgress?: (progress: ProcessingProgress) => void;
};

export interface AiProvider {
  name: string;
  generateQuestions(input: QuestionGenerationInput | NormalizedDocument, maxQuestions?: number): Promise<QuestionSet>;
  generateRecommendations(input: RecommendationInput): Promise<RevisionPlan>;
  generateSummary?(input: DocumentSummaryInput | NormalizedDocument | string): Promise<DocumentSummary>;
}
