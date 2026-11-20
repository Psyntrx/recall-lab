import type { SearchIndex } from "@/lib/document/index";
import type {
  AssessmentCoverageItem,
  AssessmentCoverageMap,
  ChapterInfo,
  ExtractedAssessmentQuestion,
} from "@/lib/document/types";

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(" ").filter((w) => w.length > 2));
  const words2 = new Set(str2.split(" ").filter((w) => w.length > 2));
  if (!words1.size || !words2.size) return 0;
  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  const minSize = Math.min(words1.size, words2.size);
  return minSize ? intersection / minSize : 0;
}

export function matchQuestionsToChapters(params: {
  questions: ExtractedAssessmentQuestion[];
  chapters: ChapterInfo[];
  index: SearchIndex;
}): ExtractedAssessmentQuestion[] {
  const { questions, chapters, index } = params;

  return questions.map((q) => {
    const results = index.search(q.wording, { limit: 3 });
    if (results.length > 0 && results[0].score > 0) {
      const best = results[0];
      return {
        ...q,
        matchedChapterId: best.chunk.chapterId,
        matchedTopic: best.chunk.chapterTitle ?? "Related Topic",
        confidence: results[0].score > 2.0 ? "high" : "medium",
      };
    }
    return {
      ...q,
      confidence: "low",
    };
  });
}

export function detectRepeatedQuestions(
  questions: ExtractedAssessmentQuestion[]
): ExtractedAssessmentQuestion[] {
  const processed = questions.map((q) => ({ ...q }));

  for (let i = 0; i < processed.length; i++) {
    const q1 = processed[i];
    const norm1 = normalizeForComparison(q1.wording);
    let repeats = 1;

    for (let j = i + 1; j < processed.length; j++) {
      const q2 = processed[j];
      const norm2 = normalizeForComparison(q2.wording);

      const sim = calculateSimilarity(norm1, norm2);
      if (sim >= 0.6 || norm1 === norm2) {
        repeats++;
        q2.isRepeated = true;
        q2.repeatCount = (q2.repeatCount ?? 1) + 1;
      }
    }

    if (repeats > 1) {
      q1.isRepeated = true;
      q1.repeatCount = repeats;
    }
  }

  return processed;
}

export function buildAssessmentCoverageMap(params: {
  questions: ExtractedAssessmentQuestion[];
  chapters: ChapterInfo[];
}): AssessmentCoverageMap {
  const { questions, chapters } = params;
  const coverageMap: AssessmentCoverageMap = {};

  for (const ch of chapters) {
    const chQuestions = questions.filter((q) => q.matchedChapterId === ch.id);
    const count = chQuestions.length;
    let frequency: "High" | "Moderate" | "Low" | "None" = "None";

    if (count >= 5) frequency = "High";
    else if (count >= 2) frequency = "Moderate";
    else if (count >= 1) frequency = "Low";

    coverageMap[ch.id] = {
      topic: ch.title,
      chapterId: ch.id,
      pastPaperQuestionCount: count,
      frequency,
      sampleQuestions: chQuestions.slice(0, 3).map((q) => q.wording),
    };
  }

  return coverageMap;
}
