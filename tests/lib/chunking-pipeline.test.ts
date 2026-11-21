import { describe, expect, it, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import {
  estimateTokens,
  createTokenAwareChunks,
  DEFAULT_MAX_CHUNK_TOKENS,
  SAFE_REQUEST_TOKEN_BUDGET,
} from "@/lib/document/chunker";
import { consolidateChunkSummaries, type ChunkSummary } from "@/lib/ai/intermediate-summaries";
import { GroqProvider } from "@/lib/ai/groq-provider";
import { createQuiz, submitAnswer } from "@/lib/quiz/store";
import { calculateScore } from "@/lib/quiz/scoring";
import { config } from "@/lib/config";
import type { DocumentPage, NormalizedDocument } from "@/lib/document/types";

describe("Token-Aware Document Chunking and Groq Pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Token Estimation", () => {
    it("conservatively estimates tokens without assuming fixed characters equals fixed tokens", () => {
      const empty = estimateTokens("");
      expect(empty).toBe(0);

      const standardText = "Active recall strengthens long-term memory retrieval pathways.";
      const est1 = estimateTokens(standardText);
      const words1 = standardText.split(/\s+/).length;
      expect(est1).toBeGreaterThanOrEqual(words1);

      // Dense technical text with formulas, symbols, and equations
      const technicalText =
        "RuBisCO catalyzes RuBP + CO2 -> 2 (3-PGA); ATP + NADPH -> G3P; Ns = 120*f/P; V_reg = (E0 - V)/V * 100%.";
      const techEst = estimateTokens(technicalText);
      // Punctuation and formulas must produce a conservative estimate higher than simple word count
      expect(techEst).toBeGreaterThan(technicalText.split(/\s+/).length * 1.2);

      // Verify conservative ratio guarantees: 10,000 chars should estimate at least 3,125 tokens
      const longCharText = "a".repeat(10000);
      expect(estimateTokens(longCharText)).toBeGreaterThanOrEqual(3125);
    });
  });

  describe("Token-Aware Document Chunking", () => {
    it("1. Small document: generates exactly 1 chunk within token budget", () => {
      const doc: NormalizedDocument = {
        filename: "small_notes.txt",
        pages: [
          {
            page: 1,
            text: "Chapter 1: Memory Fundamentals.\n\nActive recall and spaced repetition are the two most validated learning strategies. Testing yourself forces neurological retrieval.",
            source: "native",
          },
        ],
        text: "Chapter 1: Memory Fundamentals.\n\nActive recall and spaced repetition are the two most validated learning strategies. Testing yourself forces neurological retrieval.",
        wordCount: 22,
        truncated: false,
      };

      const chunks = createTokenAwareChunks(doc);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].pageStart).toBe(1);
      expect(chunks[0].pageEnd).toBe(1);
      expect(chunks[0].estimatedTokens).toBeLessThan(DEFAULT_MAX_CHUNK_TOKENS);
      expect(chunks[0].text).toContain("Active recall");
    });

    it("2. Several smaller documents: preserves document identity, chapters, and page boundaries", () => {
      const doc1Pages: DocumentPage[] = [
        { page: 1, text: "Lecture 1: Intro to Mechanics. Newton's laws of motion define classical dynamics.", source: "native" },
      ];
      const doc2Pages: DocumentPage[] = [
        { page: 2, text: "Lecture 2: Work and Energy. The work-energy theorem connects force across displacement.", source: "native" },
      ];

      const combinedDoc: NormalizedDocument = {
        filename: "physics_lectures_combined.txt",
        pages: [...doc1Pages, ...doc2Pages],
        text: `${doc1Pages[0].text}\n\n${doc2Pages[0].text}`,
        wordCount: 25,
        truncated: false,
      };

      const chunks = createTokenAwareChunks(combinedDoc);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].pageStart).toBe(1);
      expect(chunks[chunks.length - 1].pageEnd).toBe(2);
      for (const chunk of chunks) {
        expect(chunk.estimatedTokens).toBeLessThanOrEqual(DEFAULT_MAX_CHUNK_TOKENS);
      }
    });

    it("3. Large document exceeding 15,000 tokens: splits into manageable chunks within safe request budget", () => {
      // Build a realistic academic text exceeding 15,000 tokens (~60,000 characters)
      const paragraph =
        "The thermodynamic efficiency of an internal combustion engine is bounded by the Carnot cycle efficiency. " +
        "Entropy generation during irreversible processes accounts for exergy destruction. " +
        "Heat addition at constant volume in the Otto cycle yields a theoretical thermal efficiency dependent solely on the compression ratio r and specific heat ratio gamma. " +
        "For an ideal gas, internal energy depends exclusively on absolute temperature.\n\n";

      // Repeat paragraph to build ~65,000 characters (> 16,000 tokens)
      const repetitions = 140;
      let largeText = "";
      const pages: DocumentPage[] = [];
      for (let p = 1; p <= 35; p++) {
        let pageContent = `Page ${p}: Thermodynamics Section ${p}\n\n`;
        for (let j = 0; j < 4; j++) {
          pageContent += paragraph;
        }
        pages.push({ page: p, text: pageContent, source: "native" });
        largeText += pageContent;
      }

      const totalTokens = estimateTokens(largeText);
      expect(totalTokens).toBeGreaterThan(15000);

      const largeDoc: NormalizedDocument = {
        filename: "advanced_thermodynamics.txt",
        pages,
        text: largeText,
        wordCount: largeText.split(/\s+/).length,
        truncated: false,
      };

      const chunks = createTokenAwareChunks(largeDoc, {
        maxChunkTokens: 2000,
        overlapTokens: 150,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(8);
      // Verify EVERY chunk is strictly within safe chunk token budget
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        expect(chunk.estimatedTokens).toBeLessThanOrEqual(DEFAULT_MAX_CHUNK_TOKENS);
        // Total request tokens (chunk + system prompt + schemas ~1,000 tokens) stays well below SAFE_REQUEST_TOKEN_BUDGET
        expect(chunk.estimatedTokens + 1000).toBeLessThanOrEqual(SAFE_REQUEST_TOKEN_BUDGET);
        expect(chunk.pageStart).toBeLessThanOrEqual(chunk.pageEnd);
        expect(chunk.totalChunks).toBe(chunks.length);

        // Verify overlap presence on subsequent chunks
        if (i > 0) {
          expect(chunk.text).toContain("[Context from previous section]:");
        }
      }

      // Verify all pages are covered
      expect(chunks[0].pageStart).toBe(1);
      expect(chunks[chunks.length - 1].pageEnd).toBe(35);
    });

    it("4. Document containing multiple chapters: respects chapter boundaries and preserves chapter titles", () => {
      const pages: DocumentPage[] = [
        {
          page: 1,
          text: "Chapter 1: Synchronous Motors\nOperating principles of 3-phase synchronous motors. The stator magnetic field rotates at synchronous speed Ns = 120f / P.",
          source: "native",
        },
        {
          page: 10,
          text: "Chapter 2: Induction Generators\nSelf-excitation in isolated induction generators using external shunt capacitor banks to supply reactive volt-amperes.",
          source: "native",
        },
        {
          page: 25,
          text: "Chapter 3: Power System Stability\nTransient stability analysis using the equal area criterion. Rotor acceleration power Pa = Pm - Pe determines system recovery.",
          source: "native",
        },
      ];

      const chapters = [
        { id: "ch-1", title: "Chapter 1: Synchronous Motors", pageStart: 1, pageEnd: 9, chunkCount: 1 },
        { id: "ch-2", title: "Chapter 2: Induction Generators", pageStart: 10, pageEnd: 24, chunkCount: 1 },
        { id: "ch-3", title: "Chapter 3: Power System Stability", pageStart: 25, pageEnd: 40, chunkCount: 1 },
      ];

      const multiChapterDoc: NormalizedDocument = {
        filename: "electrical_power_engineering.txt",
        pages,
        chapters,
        text: pages.map((p) => p.text).join("\n\n"),
        wordCount: 75,
        truncated: false,
      };

      const chunks = createTokenAwareChunks(multiChapterDoc);
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const chunkChapterTitles = chunks.map((c) => c.chapterTitle).filter(Boolean);
      expect(chunkChapterTitles).toContain("Chapter 1: Synchronous Motors");
      expect(chunkChapterTitles).toContain("Chapter 2: Induction Generators");
      expect(chunkChapterTitles).toContain("Chapter 3: Power System Stability");
    });
  });

  describe("Intermediate Summaries Consolidation", () => {
    it("consolidates multiple chunk summaries into a structured representation without re-sending raw text", () => {
      const mockSummaries: ChunkSummary[] = [
        {
          chunkIndex: 0,
          totalChunks: 2,
          title: "Chapter 1: Photosynthesis",
          summary: "Photosynthesis converts light energy into chemical energy in chloroplasts.",
          keyConcepts: ["Chloroplast", "Thylakoid Membrane", "ATP Synthase"],
          definitionsAndFormulas: ["6 CO2 + 6 H2O -> C6H12O6 + 6 O2"],
          keyFacts: ["Occurs in plants, algae, and cyanobacteria"],
          sourceReference: "Chapter 1, Pages 1-5",
          chapterTitle: "Chapter 1: Photosynthesis",
          pageStart: 1,
          pageEnd: 5,
        },
        {
          chunkIndex: 1,
          totalChunks: 2,
          title: "Chapter 2: Cellular Respiration",
          summary: "Cellular respiration converts glucose into ATP through glycolysis and the Krebs cycle.",
          keyConcepts: ["Glycolysis", "Krebs Cycle", "Mitochondria"],
          definitionsAndFormulas: ["Net yield: 2 ATP, 2 NADH per glucose in glycolysis"],
          keyFacts: ["Glycolysis occurs anaerobically in the cytoplasm"],
          sourceReference: "Chapter 2, Pages 6-12",
          chapterTitle: "Chapter 2: Cellular Respiration",
          pageStart: 6,
          pageEnd: 12,
        },
      ];

      const consolidated = consolidateChunkSummaries(mockSummaries, "Bioenergetics Textbook");
      expect(consolidated.title).toBe("Chapter 1: Photosynthesis");
      expect(consolidated.executiveSummary).toContain("Photosynthesis converts light energy");
      expect(consolidated.executiveSummary).toContain("Cellular respiration converts glucose");
      expect(consolidated.allKeyConcepts).toContain("Chloroplast");
      expect(consolidated.allKeyConcepts).toContain("Glycolysis");
      expect(consolidated.allDefinitionsAndFormulas).toHaveLength(2);
      expect(consolidated.chapters).toHaveLength(2);
      expect(consolidated.totalChunks).toBe(2);
      expect(consolidated.totalPages).toBe(12);
      expect(consolidated.consolidatedText).toContain("Essential Definitions & Formulas");
    });
  });

  describe("Groq Error Handling and Pacing", () => {
    it("differentiates 413 (request too large) and DOES NOT retry unchanged", async () => {
      process.env.GROQ_API_KEY = "gsk_test_key_mock";
      config.groqApiKey = "gsk_test_key_mock";

      const provider = new GroqProvider();
      const mockCreate = vi.fn().mockRejectedValue(
        new OpenAI.APIError(
          413,
          {
            error: {
              message: "413 Request too large for model openai/gpt-oss-20b: TPM Limit 8000, Requested 15005.",
            },
          },
          "413 Request too large for model openai/gpt-oss-20b: TPM Limit 8000, Requested 15005.",
          new Headers()
        )
      );

      vi.spyOn(provider as any, "client").mockReturnValue({
        chat: { completions: { create: mockCreate } },
      });

      const doc: NormalizedDocument = {
        filename: "too_large.txt",
        pages: [{ page: 1, text: "Some material", source: "native" }],
        text: "Some material",
        wordCount: 50,
        truncated: false,
      };

      await expect(provider.generateQuestions(doc, 5)).rejects.toMatchObject({
        code: "AI_REQUEST_TOO_LARGE",
        status: 413,
        message: expect.stringMatching(/Groq request too large \(413\)/i),
      });

      // Crucial: 413 must NOT be retried repeatedly unchanged!
      expect(mockCreate).toHaveBeenCalledTimes(1);

      delete process.env.GROQ_API_KEY;
      config.groqApiKey = undefined;
    });

    it("retries on temporary 429 rate limit with backoff and succeeds on next attempt", async () => {
      process.env.GROQ_API_KEY = "gsk_test_key_mock";
      config.groqApiKey = "gsk_test_key_mock";

      const provider = new GroqProvider();
      const rateLimitError = new OpenAI.APIError(
        429,
        { error: { message: "Rate limit reached. Please try again in 0.1s." } },
        "Rate limit reached. Please try again in 0.1s.",
        new Headers()
      );

      const validResponse = {
        title: "Test Summary",
        summary: "This is a valid summary after retry.",
        keyTopics: ["Topic 1"],
      };

      const mockCreate = vi
        .fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(validResponse) } }],
        });

      vi.spyOn(provider as any, "client").mockReturnValue({
        chat: { completions: { create: mockCreate } },
      });

      const summary = await provider.generateSummary("Sample short text to summarize");
      expect(summary.title).toBe("Test Summary");
      expect(mockCreate).toHaveBeenCalledTimes(2);

      delete process.env.GROQ_API_KEY;
      config.groqApiKey = undefined;
    });

    it("retries on temporary 503 server capacity error and succeeds on recovery", async () => {
      process.env.GROQ_API_KEY = "gsk_test_key_mock";
      config.groqApiKey = "gsk_test_key_mock";

      const provider = new GroqProvider();
      const serverUnavailableError = new OpenAI.APIError(
        503,
        { error: { message: "Service Unavailable" } },
        "Service Unavailable",
        new Headers()
      );

      const validSummary = {
        title: "Capacity Restored",
        summary: "Summary generated once capacity was restored.",
        keyTopics: ["Reliability"],
      };

      const mockCreate = vi
        .fn()
        .mockRejectedValueOnce(serverUnavailableError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(validSummary) } }],
        });

      vi.spyOn(provider as any, "client").mockReturnValue({
        chat: { completions: { create: mockCreate } },
      });

      const result = await provider.generateSummary("Short material");
      expect(result.title).toBe("Capacity Restored");
      expect(mockCreate).toHaveBeenCalledTimes(2);

      delete process.env.GROQ_API_KEY;
      config.groqApiKey = undefined;
    });
  });

  describe("End-to-End Multi-Chunk Question Generation and Quiz Scoring", () => {
    it("generates questions distributed across chunks, preserving metadata and scoring correctly", async () => {
      process.env.GROQ_API_KEY = "gsk_test_key_mock";
      config.groqApiKey = "gsk_test_key_mock";

      const provider = new GroqProvider();

      // Create a 2-chunk document
      const docPages: DocumentPage[] = [
        {
          page: 1,
          text: "Chapter 1: Synchronous Motors.\n".repeat(60) + "Synchronous speed formula Ns = 120f / P.",
          source: "native",
        },
        {
          page: 15,
          text: "Chapter 2: Alternators and Armature Reaction.\n".repeat(60) + "Lagging power factor causes demagnetization.",
          source: "native",
        },
      ];

      const chapters = [
        { id: "ch-1", title: "Chapter 1: Synchronous Motors", pageStart: 1, pageEnd: 10, chunkCount: 1 },
        { id: "ch-2", title: "Chapter 2: Alternators", pageStart: 11, pageEnd: 20, chunkCount: 1 },
      ];

      const multiDoc: NormalizedDocument = {
        filename: "electrical_machines.txt",
        pages: docPages,
        chapters,
        text: docPages.map((p) => p.text).join("\n\n"),
        wordCount: 1200,
        truncated: false,
      };

      const mockChunkSummary1 = {
        title: "Chapter 1: Synchronous Motors",
        summary: "Principles of 3-phase synchronous motors and starting torque.",
        keyConcepts: ["Synchronous Speed", "Damper Windings"],
        definitionsAndFormulas: ["Ns = 120f / P"],
        keyFacts: ["Runs at constant speed"],
      };

      const mockChunkSummary2 = {
        title: "Chapter 2: Alternators",
        summary: "Alternator operation, voltage regulation, and armature reaction.",
        keyConcepts: ["Armature Reaction", "Voltage Regulation"],
        definitionsAndFormulas: ["Regulation = (E0 - V)/V * 100%"],
        keyFacts: ["Lagging pf demagnetizes main field flux"],
      };

      const mockQuestionsChunk1 = {
        questions: [
          {
            id: "q_temp1",
            question: "What is the synchronous speed formula for a machine with frequency f and P poles?",
            options: { A: "120f / P", B: "120P / f", C: "60f / P", D: "f / (120P)" },
            correct_answer: "A",
            topic_reference: "Synchronous Speed",
            chapter: "Chapter 1: Synchronous Motors",
            difficulty: "easy",
            explanation: "Synchronous speed in rpm is 120 times frequency divided by poles.",
            source_reference: "Chapter 1, Page 1",
          },
          {
            id: "q_temp2",
            question: "What is the primary role of damper windings in a synchronous motor?",
            options: {
              A: "To suppress hunting and provide starting torque",
              B: "To regulate terminal voltage",
              C: "To provide DC excitation",
              D: "To eliminate windage loss",
            },
            correct_answer: "A",
            topic_reference: "Damper Windings",
            chapter: "Chapter 1: Synchronous Motors",
            difficulty: "medium",
            explanation: "Damper bars develop induction motor torque during starting and dampen oscillations.",
            source_reference: "Chapter 1, Page 1",
          },
          {
            id: "q_temp3",
            question: "Under what condition does a synchronous motor stop operating synchronously?",
            options: {
              A: "When load torque exceeds pull-out torque",
              B: "When power factor is unity",
              C: "When DC excitation is optimal",
              D: "When line frequency is constant",
            },
            correct_answer: "A",
            topic_reference: "Pull-out Torque",
            chapter: "Chapter 1: Synchronous Motors",
            difficulty: "hard",
            explanation: "Exceeding pull-out torque pulls the rotor out of step with the rotating stator field.",
            source_reference: "Chapter 1, Page 1",
          },
        ],
      };

      const mockQuestionsChunk2 = {
        questions: [
          {
            id: "q_temp4",
            question: "What is the effect of a lagging power factor load on alternator armature reaction?",
            options: {
              A: "Demagnetizing effect reducing terminal voltage",
              B: "Magnetizing effect increasing terminal voltage",
              C: "Cross-magnetizing effect only",
              D: "Zero effect on main field flux",
            },
            correct_answer: "A",
            topic_reference: "Armature Reaction",
            chapter: "Chapter 2: Alternators",
            difficulty: "medium",
            explanation: "Lagging currents directly oppose the main rotor magnetic field.",
            source_reference: "Chapter 2, Page 15",
          },
          {
            id: "q_temp5",
            question: "How is percentage voltage regulation of an alternator calculated?",
            options: {
              A: "((E0 - V) / V) * 100%",
              B: "((V - E0) / E0) * 100%",
              C: "(V / E0) * 100%",
              D: "((E0 + V) / 2) * 100%",
            },
            correct_answer: "A",
            topic_reference: "Voltage Regulation",
            chapter: "Chapter 2: Alternators",
            difficulty: "easy",
            explanation: "Voltage regulation is the percentage rise in terminal voltage when full load is disconnected.",
            source_reference: "Chapter 2, Page 15",
          },
        ],
      };

      const mockCreate = vi
        .fn()
        // Chunk summary 1
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockChunkSummary1) } }],
        })
        // Chunk summary 2
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockChunkSummary2) } }],
        })
        // Questions for chunk 1
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockQuestionsChunk1) } }],
        })
        // Questions for chunk 2
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify(mockQuestionsChunk2) } }],
        });

      vi.spyOn(provider as any, "client").mockReturnValue({
        chat: { completions: { create: mockCreate } },
      });

      const progressEvents: string[] = [];
      const questionSet = await provider.generateQuestions({
        document: multiDoc,
        maxQuestions: 5,
        onProgress: (p) => {
          progressEvents.push(p.message);
        },
      });

      expect(questionSet.questions).toHaveLength(5);
      // Verify questions are distributed across both chapters
      const chaptersCovered = questionSet.questions.map((q) => q.chapter);
      expect(chaptersCovered.some((c) => c?.includes("Synchronous Motors"))).toBe(true);
      expect(chaptersCovered.some((c) => c?.includes("Alternators"))).toBe(true);

      // Verify sequential question IDs
      expect(questionSet.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);

      // Verify progress reporting captured both summary and question generation stages
      expect(progressEvents.length).toBeGreaterThanOrEqual(4);
      expect(progressEvents.some((p) => p.includes("chunk 1"))).toBe(true);
      expect(progressEvents.some((p) => p.includes("chunk 2"))).toBe(true);

      // Verify quiz creation, answering, and scoring still work seamlessly
      const quiz = createQuiz(questionSet.questions, multiDoc);
      expect(quiz.id).toBeDefined();

      for (let i = 0; i < quiz.questions.length; i++) {
        const q = quiz.questions[i];
        // Answer correctly for 4 questions, incorrectly for 1 question
        const ans = i === 4 ? "B" : q.correct_answer;
        submitAnswer(quiz.id, q.id, ans);
      }

      const score = calculateScore(quiz.questions, quiz.answers);
      expect(score.correct).toBe(4);
      expect(score.total).toBe(5);
      expect(score.percentage).toBe(80);

      delete process.env.GROQ_API_KEY;
      config.groqApiKey = undefined;
    });
  });
});
