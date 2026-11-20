import { describe, expect, it } from "vitest";
import { storage } from "@/lib/storage/store";
import type { DurableJob, DurableQuiz } from "@/lib/storage/store";

describe("durable storage layer", () => {
  it("saves and retrieves processing jobs with status and metadata", () => {
    const job: DurableJob = {
      id: "test-job-123",
      progress: { stage: "extracting", message: "Extracting page 1" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      detectedChapters: [{ id: "ch-1", title: "Chapter 1", pageStart: 1, pageEnd: 10, chunkCount: 3 }],
      extractedQuestionsCount: 4,
    };

    storage.saveJob(job);
    const retrieved = storage.getJob("test-job-123");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe("test-job-123");
    expect(retrieved?.progress.stage).toBe("extracting");
    expect(retrieved?.detectedChapters?.length).toBe(1);
    expect(retrieved?.extractedQuestionsCount).toBe(4);
  });

  it("saves, retrieves and deletes durable quizzes", () => {
    const quiz: DurableQuiz = {
      id: "test-quiz-456",
      questions: [
        {
          id: "q1",
          question: "What is active recall?",
          options: { A: "Retrieval practice", B: "Passive reading", C: "Highlighting", D: "Sleeping" },
          correct_answer: "A",
          topic_reference: "Learning Science",
          explanation: "Active recall forces retrieval from memory.",
          source_reference: "Page 1",
        },
      ],
      document: {
        filename: "notes.txt",
        pages: [{ page: 1, text: "Sample", source: "native" }],
        text: "Sample",
        wordCount: 100,
        truncated: false,
      },
      answers: {},
      createdAt: Date.now(),
    };

    storage.saveQuiz(quiz);
    const retrieved = storage.getQuiz("test-quiz-456");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.questions[0].question).toBe("What is active recall?");

    storage.deleteQuiz("test-quiz-456");
    expect(storage.getQuiz("test-quiz-456")).toBeNull();
  });
});
