import type { NormalizedDocument } from "@/lib/document/types";
import type { QuestionSet, RevisionPlan } from "@/lib/quiz/schemas";

export type QuestionGenerationInput = {
  document: NormalizedDocument;
  maxQuestions: number;
  selectedChapters?: string[];
  focus?: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
  assessmentQuestionsContext?: string;
};

export type RecommendationInput = {
  score: number;
  total: number;
  misses: unknown[];
  document: NormalizedDocument;
};

export interface AiProvider {
  name: string;
  generateQuestions(input: QuestionGenerationInput | NormalizedDocument, maxQuestions?: number): Promise<QuestionSet>;
  generateRecommendations(input: RecommendationInput): Promise<RevisionPlan>;
}
