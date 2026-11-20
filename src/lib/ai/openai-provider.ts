import OpenAI from "openai";
import { z } from "zod";
import { config, MIN_QUESTIONS } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { questionSetSchema, recommendationSchema, type QuestionSet, type RevisionPlan } from "@/lib/quiz/schemas";
import type { NormalizedDocument } from "@/lib/document/types";
import type { AiProvider, QuestionGenerationInput, RecommendationInput } from "./provider";
import { questionSystemPrompt, recommendationSystemPrompt } from "./prompts";

export class OpenAiProvider implements AiProvider {
  public readonly name = "OpenAI";

  private client() {
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new AppError(
        "OPENAI_API_KEY is not configured. Add it to .env.local and restart the server.",
        503,
        "MISSING_API_KEY"
      );
    }
    return new OpenAI({
      apiKey,
      timeout: config.aiTimeoutMs,
      maxRetries: 0,
    });
  }

  private async structured<T>(system: string, input: unknown, schema: z.ZodType<T>, name: string): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const client = this.client();
        const response = await client.chat.completions.create({
          model: config.openaiModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(input) },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
        });
        const content = response.choices[0]?.message?.content ?? "{}";
        return schema.parse(JSON.parse(content));
      } catch (error) {
        last = error;
      }
    }
    if (last instanceof z.ZodError) {
      throw new AppError("The AI response did not pass validation. Please retry generation.", 502, "INVALID_AI_OUTPUT");
    }
    if (last instanceof OpenAI.APIError) {
      throw new AppError(
        `AI provider request failed: ${last.message}`,
        last.status === 429 ? 429 : 503,
        "AI_PROVIDER_ERROR"
      );
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

    let textExcerpt = document.text;
    if (selectedChapters && selectedChapters.length > 0 && document.chunks) {
      const filteredChunks = document.chunks.filter((c) => c.chapterId && selectedChapters.includes(c.chapterId));
      if (filteredChunks.length > 0) {
        textExcerpt = filteredChunks.map((c) => `[${c.chapterTitle ?? "Chapter"}]\n${c.text}`).join("\n\n");
      }
    }

    if (textExcerpt.length > 100_000) {
      textExcerpt = textExcerpt.slice(0, 100_000) + "\n\n[Excerpt truncated to fit context]";
    }

    const data = await this.structured(
      questionSystemPrompt,
      {
        min_questions: MIN_QUESTIONS,
        max_questions: maxQuestions,
        selected_chapters: selectedChapters ?? "All",
        study_focus: focus,
        difficulty,
        source_material: textExcerpt,
      },
      questionSetSchema,
      "question_set"
    );

    if (data.questions.length > maxQuestions) {
      data.questions = data.questions.slice(0, maxQuestions);
    }
    return data;
  }

  public async generateRecommendations(input: RecommendationInput): Promise<RevisionPlan> {
    return this.structured(recommendationSystemPrompt, input, recommendationSchema, "revision_plan");
  }
}
