import OpenAI, { APIError } from "openai";
import { z } from "zod";
import { config, MIN_QUESTIONS, MAX_QUESTIONS } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import {
  questionSetSchema,
  questionSchema,
  recommendationSchema,
  documentSummarySchema,
  type QuestionSet,
  type Question,
  type RevisionPlan,
  type DocumentSummary,
} from "@/lib/quiz/schemas";
import type { NormalizedDocument, ProcessingProgress } from "@/lib/document/types";
import type {
  AiProvider,
  QuestionGenerationInput,
  RecommendationInput,
  DocumentSummaryInput,
} from "./provider";
import {
  questionSystemPrompt,
  recommendationSystemPrompt,
  summarySystemPrompt,
} from "./prompts";
import {
  createTokenAwareChunks,
  DEFAULT_MAX_CHUNK_TOKENS,
  estimateTokens,
  type TokenAwareChunk,
} from "@/lib/document/chunker";
import {
  chunkSummarySystemPrompt,
  chunkSummaryResponseSchema,
  consolidateChunkSummaries,
  type ChunkSummary,
  type ConsolidatedDocument,
} from "./intermediate-summaries";

export class GroqProvider implements AiProvider {
  public readonly name = "Groq";

  public getModel(): string {
    return process.env.GROQ_MODEL || config.groqModel || "openai/gpt-oss-120b";
  }

  public getFallbackModel(): string | undefined {
    return process.env.GROQ_FALLBACK_MODEL || config.groqFallbackModel || undefined;
  }

  public getModelsToTry(): string[] {
    const primary = this.getModel();
    const fallback = this.getFallbackModel();
    const models = [primary];
    if (fallback && fallback !== primary) {
      models.push(fallback);
    }
    return models;
  }

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async pacingDelay(): Promise<void> {
    const ms = process.env.NODE_ENV === "test" ? 10 : 1000;
    await this.sleep(ms);
  }

  private calculateBackoffMs(err: APIError, retryIndex: number): number {
    // If retry-after header or message contains wait time
    const waitMatch = err.message?.match(/try again in ([\d.]+)s/i);
    if (waitMatch) {
      return Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500;
    }
    return Math.min(2000 * Math.pow(2, retryIndex), 10000);
  }

  /**
   * Calls the Groq chat completion API with:
   * - Strict error differentiation (413, 429, 503, 404, 401/403)
   * - Retry with exponential backoff on temporary 429 rate limits and 503 server errors
   * - NEVER retries a 413 (request too large) unchanged
   * - Fallback model traversal when primary model returns 404 (retired/not found)
   * - Explicit max_tokens capping to prevent over-reserving against the TPM limit
   */
  public async callModelWithRetry<T>(
    systemPrompt: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    options?: { maxTokens?: number; temperature?: number }
  ): Promise<T> {
    const modelsToTry = this.getModelsToTry();
    let lastError: unknown;
    let attemptedModel = modelsToTry[0];

    const maxRetriesPerModel = 3;

    for (const model of modelsToTry) {
      attemptedModel = model;

      for (let retry = 0; retry < maxRetriesPerModel; retry++) {
        try {
          const client = this.client();
          const response = await client.chat.completions.create({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            response_format: { type: "json_object" },
            temperature: options?.temperature ?? 0.3,
            max_tokens: options?.maxTokens ?? 2000,
          });

          const rawText = response.choices[0]?.message?.content?.trim() ?? "{}";
          let cleanJson = rawText;
          if (cleanJson.startsWith("```")) {
            cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
          }
          const parsed = JSON.parse(cleanJson);
          return schema.parse(parsed);
        } catch (err) {
          lastError = err;

          if (err instanceof OpenAI.APIError) {
            // 413: Request too large (TPM limit exceeded) - DO NOT RETRY UNCHANGED
            if (
              err.status === 413 ||
              /413|request too large|tpm limit/i.test(err.message)
            ) {
              throw new AppError(
                `Groq request too large (413): ${err.message}. The request was not retried unchanged.`,
                413,
                "AI_REQUEST_TOO_LARGE"
              );
            }

            // 401 / 403: Authentication errors - Fatal, no retry
            if (err.status === 401 || err.status === 403) {
              throw new AppError(
                `Groq authentication failed (${err.status}): ${err.message}. Please verify your GROQ_API_KEY.`,
                401,
                "AI_AUTH_ERROR"
              );
            }

            // 404: Model not found / retired - Do not retry this model, try next model if available
            if (
              err.status === 404 ||
              /model.*(?:does not exist|not found|retired|decommissioned|not have access)/i.test(
                err.message
              )
            ) {
              break; // break inner retry loop to try next model
            }

            // 429: Rate limited - Backoff and retry
            if (err.status === 429) {
              if (retry < maxRetriesPerModel - 1) {
                const waitMs = this.calculateBackoffMs(err, retry);
                await this.sleep(waitMs);
                continue;
              }
              throw new AppError(
                "Groq rate limit reached on the free tier. Please wait a moment before trying again.",
                429,
                "RATE_LIMITED"
              );
            }

            // 503: Service temporarily unavailable - Backoff and retry
            if (err.status === 503) {
              if (retry < maxRetriesPerModel - 1) {
                await this.sleep(2000 * Math.pow(2, retry));
                continue;
              }
              throw new AppError(
                `Groq service temporarily unavailable (503): ${err.message}`,
                503,
                "AI_SERVER_UNAVAILABLE"
              );
            }
          }

          // If JSON parse or validation error, retry once or proceed
          if (err instanceof SyntaxError || err instanceof z.ZodError) {
            if (retry < maxRetriesPerModel - 1) {
              await this.sleep(500);
              continue;
            }
          }

          // Break to next model on other API errors
          break;
        }
      }
    }

    if (lastError instanceof z.ZodError) {
      throw new AppError(
        `AI model output validation failed: The model output did not match the required schema: ${lastError.issues.map((i) => i.message).join(", ")}`,
        502,
        "INVALID_AI_OUTPUT"
      );
    }

    if (lastError instanceof SyntaxError) {
      throw new AppError(
        "AI model output parsing failed: The model response was not valid JSON.",
        502,
        "INVALID_AI_OUTPUT"
      );
    }

    if (lastError instanceof OpenAI.APIError) {
      if (
        lastError.status === 404 ||
        /model.*(?:does not exist|not found|retired|decommissioned|not have access)/i.test(
          lastError.message
        )
      ) {
        throw new AppError(
          `Groq model error: The model "${attemptedModel}" does not exist, has been retired, or you do not have access to it. Configure a supported model via GROQ_MODEL in .env.local (e.g. GROQ_MODEL=openai/gpt-oss-120b).`,
          404,
          "AI_MODEL_NOT_FOUND"
        );
      }

      if (
        lastError.status === 400 &&
        /context|token|maximum context length|too long/i.test(lastError.message)
      ) {
        throw new AppError(
          `Groq model context limit exceeded: ${lastError.message}`,
          400,
          "AI_CONTEXT_LIMIT_EXCEEDED"
        );
      }

      throw new AppError(
        `Groq model request failed (${lastError.status ?? 503}): ${lastError.message}`,
        lastError.status === 429 ? 429 : 503,
        "AI_MODEL_ERROR"
      );
    }

    if (lastError instanceof Error) {
      throw new AppError(`AI model generation failed: ${lastError.message}`, 503, "AI_MODEL_ERROR");
    }

    throw new AppError("AI model generation failed. Please retry.", 503, "AI_MODEL_ERROR");
  }

  /**
   * Generates intermediate summaries for token-aware chunks sequentially with pacing,
   * preserving progress so failures do not require restarting the entire document.
   */
  public async generateChunkSummaries(
    chunks: TokenAwareChunk[],
    onProgress?: (progress: ProcessingProgress) => void
  ): Promise<ChunkSummary[]> {
    const chunkSummaries: ChunkSummary[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const pageRef =
        chunk.pageStart === chunk.pageEnd
          ? `Page ${chunk.pageStart}`
          : `Pages ${chunk.pageStart}–${chunk.pageEnd}`;
      const sectionName = chunk.chapterTitle ? `${chunk.chapterTitle} (${pageRef})` : pageRef;

      onProgress?.({
        stage: "generating",
        current: i + 1,
        total: chunks.length,
        message: `Summarizing chunk ${i + 1} of ${chunks.length}: ${sectionName}...`,
      });

      const userPrompt = `Source Material (Chunk ${i + 1} of ${chunks.length}, ${chunk.chapterTitle ? `Chapter: ${chunk.chapterTitle}, ` : ""}${pageRef}):\n\n${chunk.text}`;

      const res = await this.callModelWithRetry(
        chunkSummarySystemPrompt,
        userPrompt,
        chunkSummaryResponseSchema,
        { maxTokens: 1200 }
      );

      chunkSummaries.push({
        chunkIndex: i,
        totalChunks: chunks.length,
        title: res.title || chunk.chapterTitle || `Section (Pages ${chunk.pageStart}-${chunk.pageEnd})`,
        summary: res.summary,
        keyConcepts: res.keyConcepts || [],
        definitionsAndFormulas: res.definitionsAndFormulas || [],
        keyFacts: res.keyFacts || [],
        sourceReference: chunk.chapterTitle ? `${chunk.chapterTitle}, ${pageRef}` : pageRef,
        chapterTitle: chunk.chapterTitle,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
      });

      // Pacing delay between chunk summaries
      if (i < chunks.length - 1) {
        await this.pacingDelay();
      }
    }

    return chunkSummaries;
  }

  /**
   * Generates a document summary.
   * If the document exceeds safe single-request limits, processes chunks sequentially
   * with intermediate summaries and combines them into a consolidated summary.
   */
  public async generateSummary(
    input: DocumentSummaryInput | NormalizedDocument | string
  ): Promise<DocumentSummary> {
    let documentObj: NormalizedDocument | { text: string; filename?: string };
    let focus: string | undefined;
    let onProgress: ((progress: ProcessingProgress) => void) | undefined;

    if (typeof input === "string") {
      documentObj = { text: input, filename: "Document" };
    } else if ("pages" in input && Array.isArray(input.pages)) {
      documentObj = input;
    } else if ("document" in input) {
      documentObj =
        typeof input.document === "string"
          ? { text: input.document, filename: "Document" }
          : input.document;
      focus = input.focus;
      onProgress = input.onProgress;
    } else {
      documentObj = input as NormalizedDocument;
    }

    // Token-aware chunking
    const chunks = createTokenAwareChunks(documentObj, {
      maxChunkTokens: DEFAULT_MAX_CHUNK_TOKENS,
    });

    if (chunks.length <= 1) {
      // Small document: single request
      const text = chunks[0]?.text || documentObj.text || "";
      const userPrompt = `Summarize the following learning material${focus ? ` with particular focus on ${focus}` : ""}:\n\n${text}`;
      return this.callModelWithRetry(summarySystemPrompt, userPrompt, documentSummarySchema, {
        maxTokens: 1500,
      });
    }

    // Large document: intermediate summaries per chunk, consolidated
    const chunkSummaries = await this.generateChunkSummaries(chunks, onProgress);
    const consolidated = consolidateChunkSummaries(chunkSummaries, documentObj.filename || "Study Material");

    return {
      title: consolidated.title,
      summary: consolidated.executiveSummary,
      keyTopics: consolidated.keyTopics,
    };
  }

  /**
   * Generates high-yield multiple-choice questions grounded in the learning materials.
   * For larger documents:
   * 1. Splits document into token-aware chunks targeting 3,000–4,000 total request tokens.
   * 2. Builds intermediate summaries and a consolidated representation.
   * 3. Distributes questions across chunks/chapters so questions cover different sections
   *    rather than repeatedly focusing on the first few pages.
   * 4. Processes requests sequentially with pacing and retry handling.
   * 5. Validates against questionSetSchema and preserves accurate page/chapter references.
   */
  public async generateQuestions(
    input: QuestionGenerationInput | NormalizedDocument,
    maxQuestionsParam?: number
  ): Promise<QuestionSet> {
    const isDoc = "filename" in input && !("document" in input);
    const document = isDoc ? input : input.document;
    const maxQuestions = Math.min(
      MAX_QUESTIONS,
      Math.max(MIN_QUESTIONS, isDoc ? (maxQuestionsParam ?? 10) : input.maxQuestions)
    );
    const selectedChapters = !isDoc ? input.selectedChapters : undefined;
    const focus = !isDoc ? input.focus : undefined;
    const difficulty = !isDoc ? input.difficulty : undefined;
    const assessmentQuestionsContext = !isDoc ? input.assessmentQuestionsContext : undefined;
    const onProgress = !isDoc ? input.onProgress : undefined;

    // Token-aware chunking targeting ~2,200 text tokens (leaves ~1,600 tokens for system prompt/schema)
    const allChunks = createTokenAwareChunks(document, {
      maxChunkTokens: DEFAULT_MAX_CHUNK_TOKENS,
    });

    // Filter candidate chunks if user selected specific chapters
    let candidateChunks = allChunks;
    if (selectedChapters && selectedChapters.length > 0) {
      const filtered = allChunks.filter(
        (c) =>
          (c.chapterId && selectedChapters.includes(c.chapterId)) ||
          (c.chapterTitle &&
            selectedChapters.some((s) => c.chapterTitle?.toLowerCase().includes(s.toLowerCase())))
      );
      if (filtered.length > 0) {
        candidateChunks = filtered;
      }
    }

    if (candidateChunks.length === 0) {
      candidateChunks = allChunks.length > 0 ? allChunks : createTokenAwareChunks({ text: document.text });
    }

    // Small document path (single chunk, safe within token limits)
    if (candidateChunks.length === 1) {
      onProgress?.({
        stage: "generating",
        current: 1,
        total: 1,
        message: `Generating ${maxQuestions} grounded questions with AI...`,
      });

      const userPayload = {
        requested_questions_count: maxQuestions,
        min_questions: MIN_QUESTIONS,
        selected_chapters: selectedChapters ?? "All available chapters",
        study_focus: focus ?? "Comprehensive coverage",
        difficulty: difficulty ?? "balanced (easy, medium, hard)",
        assessment_materials_context: assessmentQuestionsContext ?? "None provided",
        source_material: candidateChunks[0].text,
      };

      const userPrompt = `Generate exactly ${maxQuestions} high-quality, defensible multiple-choice practice questions based on the following context:\n\n${JSON.stringify(userPayload, null, 2)}`;

      const data = await this.callModelWithRetry(
        questionSystemPrompt,
        userPrompt,
        questionSetSchema,
        { maxTokens: 2500 }
      );

      if (data.questions.length > maxQuestions) {
        data.questions = data.questions.slice(0, maxQuestions);
      }
      return data;
    }

    // Multi-chunk document path (sequential processing with intermediate summaries)
    // Step 1: Generate intermediate summaries for candidate chunks
    const chunkSummaries = await this.generateChunkSummaries(candidateChunks, onProgress);
    const consolidated = consolidateChunkSummaries(
      chunkSummaries,
      document.filename || "Study Material"
    );

    // Step 2: Allocate target questions across chunks to ensure coverage across all sections
    const totalChunks = candidateChunks.length;
    type ChunkAllocation = {
      chunk: TokenAwareChunk;
      summary?: ChunkSummary;
      count: number;
    };
    const allocations: ChunkAllocation[] = [];

    if (totalChunks <= maxQuestions) {
      // Each chunk gets a proportional share of questions
      const baseCount = Math.floor(maxQuestions / totalChunks);
      let remainder = maxQuestions % totalChunks;

      for (let i = 0; i < totalChunks; i++) {
        const count = baseCount + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        allocations.push({
          chunk: candidateChunks[i],
          summary: chunkSummaries[i],
          count: Math.max(1, count),
        });
      }
    } else {
      // More chunks than requested questions: sample chunks evenly across chapters/sections
      for (let j = 0; j < maxQuestions; j++) {
        const chunkIndex = Math.floor(j * (totalChunks / maxQuestions));
        const chunk = candidateChunks[chunkIndex];
        const existing = allocations.find((a) => a.chunk.id === chunk.id);
        if (existing) {
          existing.count += 1;
        } else {
          allocations.push({
            chunk,
            summary: chunkSummaries[chunkIndex],
            count: 1,
          });
        }
      }
    }

    // Step 3: Sequentially generate questions for each allocated chunk with pacing
    const collectedQuestions: Question[] = [];
    const totalAllocations = allocations.length;

    for (let i = 0; i < totalAllocations; i++) {
      const alloc = allocations[i];
      const chunk = alloc.chunk;
      const pageRef =
        chunk.pageStart === chunk.pageEnd
          ? `Page ${chunk.pageStart}`
          : `Pages ${chunk.pageStart}–${chunk.pageEnd}`;
      const chapterLabel = chunk.chapterTitle || `Section ${i + 1}`;

      onProgress?.({
        stage: "generating",
        current: i + 1,
        total: totalAllocations,
        message: `Generating questions for ${chapterLabel} (${pageRef}) [chunk ${i + 1} of ${totalAllocations}]...`,
      });

      const chunkQuestionsSchema = z.object({
        questions: z.array(questionSchema).min(1),
      });

      const userPayload = {
        requested_questions_count: alloc.count,
        target_section: chapterLabel,
        section_page_reference: pageRef,
        study_focus: focus ?? "Comprehensive section coverage",
        difficulty: difficulty ?? "balanced (easy, medium, hard)",
        section_key_concepts: alloc.summary?.keyConcepts || [],
        assessment_materials_context: assessmentQuestionsContext ?? "None provided",
        source_material: chunk.text,
      };

      const userPrompt = `Generate exactly ${alloc.count} high-quality multiple-choice questions testing conceptual understanding strictly grounded in this section:\n\n${JSON.stringify(userPayload, null, 2)}`;

      try {
        const result = await this.callModelWithRetry(
          questionSystemPrompt,
          userPrompt,
          chunkQuestionsSchema,
          { maxTokens: 1800 }
        );

        for (const q of result.questions) {
          // Ensure accurate chapter and source reference metadata
          if (!q.chapter && chunk.chapterTitle) {
            q.chapter = chunk.chapterTitle;
          }
          if (!q.source_reference) {
            q.source_reference = chunk.chapterTitle
              ? `${chunk.chapterTitle}, ${pageRef}`
              : pageRef;
          }
          collectedQuestions.push(q);
        }
      } catch (err) {
        // If a single chunk question request fails after retries, continue with remaining chunks
        // to preserve overall progress as long as we have sufficient questions
        if (allocations.length === 1) throw err;
      }

      // Pacing delay between question-generation requests
      if (i < totalAllocations - 1) {
        await this.pacingDelay();
      }
    }

    // Step 4: Deduplicate, re-index IDs, and adjust count to meet target
    const seenStems = new Set<string>();
    const deduplicatedQuestions: Question[] = [];

    for (const q of collectedQuestions) {
      const stem = q.question.trim().toLowerCase();
      if (!seenStems.has(stem)) {
        seenStems.add(stem);
        deduplicatedQuestions.push(q);
      }
    }

    // If we have fewer than MIN_QUESTIONS, generate supplemental questions from consolidated text
    if (deduplicatedQuestions.length < MIN_QUESTIONS) {
      const needed = MIN_QUESTIONS - deduplicatedQuestions.length;
      onProgress?.({
        stage: "generating",
        current: totalAllocations,
        total: totalAllocations,
        message: `Finalizing question set (${deduplicatedQuestions.length}/${MIN_QUESTIONS} questions ready)...`,
      });

      const supplementalSchema = z.object({
        questions: z.array(questionSchema).min(1),
      });

      const supplementalPayload = {
        requested_questions_count: needed,
        study_focus: focus ?? "Comprehensive coverage",
        difficulty: difficulty ?? "balanced",
        source_material: consolidated.consolidatedText,
      };

      try {
        const suppResult = await this.callModelWithRetry(
          questionSystemPrompt,
          `Generate ${needed} additional questions grounded in this consolidated study material:\n\n${JSON.stringify(supplementalPayload, null, 2)}`,
          supplementalSchema,
          { maxTokens: 1500 }
        );

        for (const q of suppResult.questions) {
          const stem = q.question.trim().toLowerCase();
          if (!seenStems.has(stem)) {
            seenStems.add(stem);
            deduplicatedQuestions.push(q);
          }
        }
      } catch {
        // Use deduplicatedQuestions as-is if supplemental call fails
      }
    }

    // Trim to maxQuestions if we have more
    const finalQuestions = deduplicatedQuestions.slice(0, maxQuestions);

    // Re-index IDs to guarantee sequential unique IDs ("q1", "q2", ...)
    for (let idx = 0; idx < finalQuestions.length; idx++) {
      finalQuestions[idx].id = `q${idx + 1}`;
    }

    // Final validation
    const questionSet = questionSetSchema.parse({ questions: finalQuestions });
    return questionSet;
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

    return this.callModelWithRetry(recommendationSystemPrompt, userPrompt, recommendationSchema, {
      maxTokens: 1500,
    });
  }
}
