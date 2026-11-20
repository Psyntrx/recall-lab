import OpenAI from "openai";
import { z } from "zod";
import { config, MIN_QUESTIONS } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { questionSetSchema, recommendationSchema, type QuestionSet, type RevisionPlan } from "@/lib/quiz/schemas";
import type { NormalizedDocument } from "@/lib/document/types";
import type { AiProvider, QuestionGenerationInput, RecommendationInput } from "./provider";
import { questionSystemPrompt, recommendationSystemPrompt } from "./prompts";

export class GroqProvider implements AiProvider {
  public readonly name = "Groq";

  private client(): OpenAI {
    const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new AppError(
        "GROQ_API_KEY is not configured. Add it to .env.local and restart the server.",
        503,
        "MISSING_API_KEY"
      );
    }
    return new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: config.aiTimeoutMs,
      maxRetries: 0,
    });
  }

  private async callModelWithRetry<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T>
  ): Promise<T> {
    const modelsToTry = [config.groqModel, config.groqFallbackModel];
    let lastError: unknown;

    for (const model of modelsToTry) {
      try {
        const client = this.client();
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const rawText = response.choices[0]?.message?.content?.trim() ?? "{}";
        const parsed = JSON.parse(rawText);
        return schema.parse(parsed);
      } catch (err) {
        lastError = err;
        if (err instanceof OpenAI.APIError && err.status === 429) {
          throw new AppError(
            "Groq rate limit reached on the free tier. Please wait a moment before trying again.",
            429,
            "RATE_LIMITED"
          );
        }
        // If not rate limited, try fallback model in loop
      }
    }

    if (lastError instanceof z.ZodError) {
      throw new AppError(
        `The AI output did not match the question schema: ${lastError.issues.map((i) => i.message).join(", ")}`,
        502,
        "INVALID_AI_OUTPUT"
      );
    }

    if (lastError instanceof OpenAI.APIError) {
      throw new AppError(
        `Groq API request failed: ${lastError.message}`,
        lastError.status === 429 ? 429 : 503,
        "AI_PROVIDER_ERROR"
      );
    }

    if (lastError instanceof Error) {
      throw new AppError(`AI generation failed: ${lastError.message}`, 503, "AI_PROVIDER_ERROR");
    }

    throw new AppError("AI generation failed. Please retry.", 503, "AI_PROVIDER_ERROR");
  }

  public async generateQuestions(
    input: QuestionGenerationInput | NormalizedDocument,
    maxQuestionsParam?: number
  ): Promise<QuestionSet> {
    const isDoc = "filename" in input;
    const document = isDoc ? input : input.document;
    const maxQuestions = isDoc ? (maxQuestionsParam ?? 10) : input.maxQuestions;
    const selectedChapters = !isDoc ? input.selectedChapters : undefined;
    const focus = !isDoc ? input.focus : undefined;
    const difficulty = !isDoc ? input.difficulty : undefined;
    const assessmentQuestionsContext = !isDoc ? input.assessmentQuestionsContext : undefined;

    let textExcerpt = document.text;
    // If selected chapters, prioritize text from those chapters
    if (selectedChapters && selectedChapters.length > 0 && document.chunks) {
      const filteredChunks = document.chunks.filter((c) => c.chapterId && selectedChapters.includes(c.chapterId));
      if (filteredChunks.length > 0) {
        textExcerpt = filteredChunks.map((c) => `[${c.chapterTitle ?? "Chapter"}]\n${c.text}`).join("\n\n");
      }
    }

    // Limit excerpt to reasonable size if very large (e.g. 100k chars for single prompt)
    if (textExcerpt.length > 100_000) {
      textExcerpt = textExcerpt.slice(0, 100_000) + "\n\n[Excerpt truncated to fit model context]";
    }

    const userPayload = {
      requested_questions_count: maxQuestions,
      min_questions: MIN_QUESTIONS,
      selected_chapters: selectedChapters ?? "All available chapters",
      study_focus: focus ?? "Comprehensive chapter coverage",
      difficulty: difficulty ?? "balanced (easy, medium, hard)",
      assessment_materials_context: assessmentQuestionsContext ?? "None provided",
      source_material: textExcerpt,
    };

    const userPrompt = `Generate exactly ${maxQuestions} high-quality, defensible multiple-choice questions based on the following context:\n\n${JSON.stringify(userPayload, null, 2)}`;

    const data = await this.callModelWithRetry(
      questionSystemPrompt,
      userPrompt,
      questionSetSchema
    );

    if (data.questions.length > maxQuestions) {
      data.questions = data.questions.slice(0, maxQuestions);
    }

    return data;
  }

  public async generateRecommendations(input: RecommendationInput): Promise<RevisionPlan> {
    const userPrompt = `Analyze the student's study performance and generate an actionable revision plan:\n\n${JSON.stringify(
      {
        score: input.score,
        total: input.total,
        missed_questions: input.misses,
      },
      null,
      2
    )}`;

    return this.callModelWithRetry(recommendationSystemPrompt, userPrompt, recommendationSchema);
  }
}
