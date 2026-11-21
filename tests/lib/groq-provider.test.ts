import { describe, expect, it, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { GroqProvider } from "@/lib/ai/groq-provider";
import { getAiProvider } from "@/lib/ai/factory";
import { config } from "@/lib/config";
import type { NormalizedDocument } from "@/lib/document/types";

describe("Groq AI Provider and Provider Factory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws a clean error when GROQ_API_KEY is missing", async () => {
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;

    const provider = new GroqProvider();
    const doc: NormalizedDocument = {
      filename: "sample.txt",
      pages: [{ page: 1, text: "Sample content", source: "native" }],
      text: "Sample content",
      wordCount: 100,
      truncated: false,
    };

    await expect(provider.generateQuestions(doc, 5)).rejects.toThrow(/GROQ_API_KEY is not configured/i);
    process.env.GROQ_API_KEY = originalKey;
  });

  it("factory instantiates GroqProvider by default when GROQ_API_KEY is present", () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    config.groqApiKey = "gsk_test_key_12345";
    config.aiProvider = "groq";

    const provider = getAiProvider();
    expect(provider.name).toBe("Groq");

    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;
  });

  it("defaults to openai/gpt-oss-120b and does not reference deprecated model", () => {
    const originalModel = process.env.GROQ_MODEL;
    delete process.env.GROQ_MODEL;
    config.groqModel = "openai/gpt-oss-120b";

    const provider = new GroqProvider();
    expect(provider.getModel()).toBe("openai/gpt-oss-120b");
    expect(provider.getModelsToTry()).not.toContain("llama-3.3-70b-versatile");

    if (originalModel) process.env.GROQ_MODEL = originalModel;
  });

  it("allows configuring the Groq model via GROQ_MODEL environment variable", () => {
    const originalModel = process.env.GROQ_MODEL;
    process.env.GROQ_MODEL = "openai/gpt-oss-custom-model";

    const provider = new GroqProvider();
    expect(provider.getModel()).toBe("openai/gpt-oss-custom-model");
    expect(provider.getModelsToTry()[0]).toBe("openai/gpt-oss-custom-model");

    if (originalModel) {
      process.env.GROQ_MODEL = originalModel;
    } else {
      delete process.env.GROQ_MODEL;
    }
  });

  it("parses valid question sets with rich metadata from Groq response", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    config.groqApiKey = "gsk_test_key_12345";

    const provider = new GroqProvider();
    const sampleQuestions = {
      questions: [
        {
          id: "q1",
          question: "What is the function of a damper winding in a synchronous motor?",
          options: {
            A: "To provide starting torque and prevent hunting",
            B: "To regulate terminal voltage only",
            C: "To increase core losses",
            D: "To eliminate the need for DC excitation",
          },
          correct_answer: "A",
          topic_reference: "Synchronous Motors",
          chapter: "Chapter 2",
          difficulty: "medium",
          question_source: "generated",
          explanation: "Damper windings suppress hunting and develop induction torque during starting.",
          source_reference: "Chapter 2, Page 45",
        },
        {
          id: "q2",
          question: "Which expression represents the synchronous speed Ns of an alternator?",
          options: {
            A: "Ns = 120f / P",
            B: "Ns = 120P / f",
            C: "Ns = f / (120P)",
            D: "Ns = 60f / P",
          },
          correct_answer: "A",
          topic_reference: "Alternator Fundamentals",
          chapter: "Chapter 3",
          difficulty: "easy",
          question_source: "extracted",
          explanation: "Synchronous speed in rpm is given by 120 multiplied by frequency divided by poles.",
          source_reference: "Chapter 3, Page 82",
        },
        {
          id: "q3",
          question: "What happens when an alternator operates at leading power factor?",
          options: {
            A: "The armature reaction is magnetizing and voltage increases",
            B: "The armature reaction is demagnetizing and voltage drops",
            C: "Terminal voltage remains unchanged",
            D: "Rotor speed accelerates above synchronous speed",
          },
          correct_answer: "A",
          topic_reference: "Armature Reaction",
          chapter: "Chapter 3",
          difficulty: "hard",
          question_source: "generated",
          explanation: "Leading power factor introduces a magnetizing component assisting field flux.",
          source_reference: "Chapter 3, Page 95",
        },
        {
          id: "q4",
          question: "How is voltage regulation defined for an alternator?",
          options: {
            A: "(E0 - V) / V * 100%",
            B: "(V - E0) / E0 * 100%",
            C: "V / E0 * 100%",
            D: "(E0 + V) / 2",
          },
          correct_answer: "A",
          topic_reference: "Voltage Regulation",
          chapter: "Chapter 3",
          difficulty: "medium",
          question_source: "adapted",
          explanation: "Percentage voltage regulation is the rise in voltage when full load is thrown off divided by rated voltage.",
          source_reference: "Chapter 3, Page 104",
        },
        {
          id: "q5",
          question: "What is the primary advantage of a rotating field alternator?",
          options: {
            A: "Only two slip rings are required for low-voltage DC excitation",
            B: "No slip rings or brushes are needed at all",
            C: "Armature windings do not experience centrifugal stresses",
            D: "It eliminates all magnetic hysteresis",
          },
          correct_answer: "A",
          topic_reference: "Alternator Construction",
          chapter: "Chapter 3",
          difficulty: "easy",
          question_source: "generated",
          explanation: "Rotating field machines require only 2 slip rings for low voltage DC field excitation.",
          source_reference: "Chapter 3, Page 72",
        },
      ],
    };

    // Mock client chat completions
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(sampleQuestions) } }],
    });
    vi.spyOn(provider as any, "client").mockReturnValue({
      chat: { completions: { create: mockCreate } },
    });

    const doc: NormalizedDocument = {
      filename: "machines.txt",
      pages: [{ page: 1, text: "Sample textbook text", source: "native" }],
      text: "Sample textbook text",
      wordCount: 800,
      truncated: false,
    };

    const result = await provider.generateQuestions({
      document: doc,
      maxQuestions: 5,
      selectedChapters: ["ch-2", "ch-3"],
    });

    expect(result.questions.length).toBe(5);
    expect(result.questions[0].chapter).toBe("Chapter 2");
    expect(result.questions[0].question_source).toBe("generated");
    expect(result.questions[1].question_source).toBe("extracted");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-120b",
      })
    );

    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;
  });

  it("differentiates model-not-found / retired errors with specific message and code", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    config.groqApiKey = "gsk_test_key_12345";

    const provider = new GroqProvider();
    const notFoundError = new OpenAI.APIError(
      404,
      { error: { message: "The model llama-3.3-70b-versatile does not exist or you do not have access to it." } },
      "The model llama-3.3-70b-versatile does not exist or you do not have access to it.",
      new Headers()
    );

    vi.spyOn(provider as any, "client").mockReturnValue({
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(notFoundError),
        },
      },
    });

    const doc: NormalizedDocument = {
      filename: "test.txt",
      pages: [{ page: 1, text: "content", source: "native" }],
      text: "content",
      wordCount: 10,
      truncated: false,
    };

    await expect(provider.generateQuestions(doc, 5)).rejects.toMatchObject({
      code: "AI_MODEL_NOT_FOUND",
      status: 404,
      message: expect.stringMatching(/Groq model error/i),
    });

    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;
  });

  it("differentiates authentication errors clearly", async () => {
    process.env.GROQ_API_KEY = "gsk_invalid_key";
    config.groqApiKey = "gsk_invalid_key";

    const provider = new GroqProvider();
    const authError = new OpenAI.APIError(
      401,
      { error: { message: "Invalid API Key" } },
      "Invalid API Key",
      new Headers()
    );

    vi.spyOn(provider as any, "client").mockReturnValue({
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(authError),
        },
      },
    });

    const doc: NormalizedDocument = {
      filename: "test.txt",
      pages: [{ page: 1, text: "content", source: "native" }],
      text: "content",
      wordCount: 10,
      truncated: false,
    };

    await expect(provider.generateQuestions(doc, 5)).rejects.toMatchObject({
      code: "AI_AUTH_ERROR",
      status: 401,
      message: expect.stringMatching(/Groq authentication failed/i),
    });

    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;
  });

  it("generates summaries using the configured model", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_12345";
    config.groqApiKey = "gsk_test_key_12345";
    process.env.GROQ_MODEL = "openai/gpt-oss-120b";

    const provider = new GroqProvider();
    const sampleSummary = {
      title: "Electromagnetic Induction",
      summary: "Faraday's law describes how changing magnetic flux induces an electromotive force.",
      keyTopics: ["Faraday's Law", "Lenz's Law"],
    };

    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(sampleSummary) } }],
    });
    vi.spyOn(provider as any, "client").mockReturnValue({
      chat: { completions: { create: mockCreate } },
    });

    const summary = await provider.generateSummary("Sample lecture content on electromagnetic induction");
    expect(summary.title).toBe("Electromagnetic Induction");
    expect(summary.keyTopics).toHaveLength(2);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-oss-120b",
      })
    );

    delete process.env.GROQ_API_KEY;
    config.groqApiKey = undefined;
  });
});
