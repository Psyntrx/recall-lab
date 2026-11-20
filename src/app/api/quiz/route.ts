import { randomUUID } from "crypto";
import { getAiProvider } from "@/lib/ai/factory";
import { createQuiz } from "@/lib/quiz/store";
import { storage, type DurableJob } from "@/lib/storage/store";
import { assertSufficientMaterial, requiredQuestionMaximum } from "@/lib/document/validation";
import { errorResponse, AppError } from "@/lib/http/errors";
import type { NormalizedDocument } from "@/lib/document/types";

export const runtime = "nodejs";

export type QuizGenerateRequestBody = {
  document?: NormalizedDocument;
  options?: {
    questionCount?: number;
    selectedChapters?: string[];
    focus?: string;
    difficulty?: "easy" | "medium" | "hard" | "mixed";
  };
  assessmentContext?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as QuizGenerateRequestBody;
    const { document, options, assessmentContext } = body;

    if (!document || !document.text) {
      throw new AppError("Extracted document text is required.", 400, "MISSING_DOCUMENT");
    }

    assertSufficientMaterial(document.text);

    const maximumAllowed = requiredQuestionMaximum(
      document.wordCount || Math.floor(document.text.length / 6)
    );
    const targetCount = options?.questionCount
      ? Math.min(options.questionCount, Math.max(5, maximumAllowed))
      : Math.min(10, Math.max(5, maximumAllowed));

    const jobId = randomUUID();
    const job: DurableJob = {
      id: jobId,
      progress: {
        stage: "generating",
        message: `Generating ${targetCount} grounded questions with AI...`,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      detectedChapters: document.chapters,
    };
    storage.saveJob(job);

    const aiProvider = getAiProvider();
    const generated = await aiProvider.generateQuestions({
      document,
      maxQuestions: targetCount,
      selectedChapters: options?.selectedChapters,
      focus: options?.focus,
      difficulty: options?.difficulty,
      assessmentQuestionsContext: assessmentContext,
    });

    const quiz = createQuiz(generated.questions, document);

    job.quizId = quiz.id;
    job.progress = { stage: "complete", message: "Quiz ready" };
    job.updatedAt = Date.now();
    storage.saveJob(job);

    return Response.json({
      quiz,
      quizId: quiz.id,
      jobId,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("jobId");
    if (!id) return Response.json({ error: "jobId is required" }, { status: 400 });
    const job = storage.getJob(id);
    if (!job) throw new AppError("Processing job was not found.", 404, "JOB_NOT_FOUND");
    return Response.json({
      id: job.id,
      progress: job.progress,
      quizId: job.quizId,
      error: job.error,
      detectedChapters: job.detectedChapters,
      coverageMap: job.coverageMap,
      extractedQuestionsCount: job.extractedQuestionsCount,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("jobId");
    if (!id) return Response.json({ error: "jobId is required" }, { status: 400 });
    const job = storage.getJob(id);
    if (job) {
      job.progress = { stage: "cancelled", message: "Cancellation requested" };
      storage.saveJob(job);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
