import type { NormalizedDocument } from "@/lib/document/types"; import type { QuestionSet, RevisionPlan } from "@/lib/quiz/schemas";
export interface AiProvider { generateQuestions(document: NormalizedDocument, maxQuestions: number): Promise<QuestionSet>; generateRecommendations(input: { score: number; total: number; misses: unknown[]; document: NormalizedDocument }): Promise<RevisionPlan>; }
