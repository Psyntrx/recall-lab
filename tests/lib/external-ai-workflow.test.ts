import { describe, expect, it } from "vitest";
import { createZipArchive, crc32 } from "@/lib/zip/zip-writer";
import {
  buildStudyPackage,
  makeDynamicAiPrompt,
  makeStudyInstructions,
  OUTPUT_SCHEMA,
  OUTPUT_TEMPLATE,
} from "@/lib/export/external-package";
import {
  validateExternalAiJson,
  cleanRawJsonText,
} from "@/lib/quiz/import-validation";
import { validateQuiz } from "@/lib/quiz/import";
import { createQuiz, submitAnswer } from "@/lib/quiz/store";
import { calculateScore } from "@/lib/quiz/scoring";
import type { NormalizedDocument } from "@/lib/document/types";

describe("External AI Export and JSON Import Workflow", () => {
  describe("Pure-TypeScript ZIP Generation", () => {
    it("computes accurate CRC-32 checksums", () => {
      const data = new TextEncoder().encode("Hello, Recall Lab!");
      const checksum = crc32(data);
      expect(checksum).toBeGreaterThan(0);
      expect(typeof checksum).toBe("number");
    });

    it("creates a standard PKZip archive with local headers, central directory, and EOCD", () => {
      const archiveBytes = createZipArchive([
        { name: "test.txt", data: "Sample content" },
        { name: "nested/file.md", data: "# Header" },
      ]);

      expect(archiveBytes).toBeInstanceOf(Uint8Array);
      expect(archiveBytes.length).toBeGreaterThan(100);

      const view = new DataView(archiveBytes.buffer);
      // Local Header signature: 0x04034b50 ("PK\x03\x04")
      expect(view.getUint32(0, true)).toBe(0x04034b50);

      // Verify EOCD signature exists near the end: 0x06054b50 ("PK\x05\x06")
      const lastFour = view.getUint32(archiveBytes.length - 22, true);
      expect(lastFour).toBe(0x06054b50);
    });
  });

  describe("Downloadable Study Package Generation", () => {
    it("builds a complete ZIP package with references, instructions, prompt, and schemas", async () => {
      const fakePdfContent = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
      const fakeNotesContent = "Chapter 1: Principles of Thermodynamic Cycles.\nEfficiency depends on temperatures.";

      const pkg = await buildStudyPackage({
        files: [
          { name: "Thermodynamics_Textbook.pdf", content: fakePdfContent },
          { name: "Lecture_Notes_Week_1.txt", content: fakeNotesContent },
        ],
        questionCount: 15,
        focus: "Carnot and Otto Cycles",
        difficulty: "hard",
        selectedChapters: ["Chapter 1: Fundamentals", "Chapter 2: Cycles"],
      });

      expect(pkg.filename).toBe("RecallLab_Thermodynamics_Textbook_Package.zip");
      expect(pkg.zipBytes.length).toBeGreaterThan(500);
      expect(pkg.zipBlob.type).toBe("application/zip");

      // Verify dynamic prompt includes user preferences
      expect(pkg.aiPromptText).toContain("15");
      expect(pkg.aiPromptText).toContain("Carnot and Otto Cycles");
      expect(pkg.aiPromptText).toContain("hard");
      expect(pkg.aiPromptText).toContain("Thermodynamics_Textbook.pdf");
      expect(pkg.aiPromptText).toContain("Lecture_Notes_Week_1.txt");
      expect(pkg.aiPromptText).toContain("OUTPUT_SCHEMA.json");
      expect(pkg.aiPromptText).toContain("OUTPUT_TEMPLATE.json");

      // Verify instructions include file inventory and metadata
      expect(pkg.instructionsText).toContain("**Target Question Count**: 15");
      expect(pkg.instructionsText).toContain("Carnot and Otto Cycles");
      expect(pkg.instructionsText).toContain("Thermodynamics_Textbook.pdf");

      // Verify schema and template are valid JSON
      expect(() => JSON.parse(pkg.outputSchemaText)).not.toThrow();
      expect(() => JSON.parse(pkg.outputTemplateText)).not.toThrow();

      // Ensure no credentials or keys are in any generated file
      expect(pkg.aiPromptText).not.toMatch(/gsk_[a-zA-Z0-9]+/);
      expect(pkg.instructionsText).not.toMatch(/gsk_[a-zA-Z0-9]+/);
    });
  });

  describe("JSON Import Validation and Preview", () => {
    it("strips Markdown code block wrappers safely", () => {
      const rawWithFences = "```json\n{\n  \"title\": \"Sample\",\n  \"questions\": []\n}\n```";
      expect(cleanRawJsonText(rawWithFences)).toBe('{\n  "title": "Sample",\n  "questions": []\n}');

      const rawBareFences = "```\n{\"questions\": []}\n```";
      expect(cleanRawJsonText(rawBareFences)).toBe('{"questions": []}');
    });

    it("successfully validates, parses, and previews a compliant external AI quiz JSON", () => {
      const validExternalAiJson = JSON.stringify({
        title: "Electrical Machines Quiz",
        summary: "Covers 3-phase synchronous motors, starting torques, and alternators.",
        questions: [
          {
            id: "q1",
            question: "What is the synchronous speed formula for a machine with frequency f and P poles?",
            options: {
              A: "Ns = 120f / P",
              B: "Ns = 120P / f",
              C: "Ns = 60f / P",
              D: "Ns = f / (120P)",
            },
            correct_answer: "A",
            topic_reference: "Synchronous Speed",
            chapter: "Chapter 1: Synchronous Motors",
            difficulty: "easy",
            explanation: "Synchronous speed in rpm is given by 120 multiplied by frequency divided by poles.",
            source_reference: "Chapter 1, Page 12",
          },
          {
            id: "q2",
            question: "What is the function of damper windings in a synchronous motor?",
            options: {
              A: "To provide starting torque and dampen rotor hunting oscillations",
              B: "To regulate terminal voltage at no-load",
              C: "To provide DC excitation to the rotor poles",
              D: "To eliminate magnetic hysteresis in the stator core",
            },
            correct_answer: "A",
            topic_reference: "Damper Windings",
            chapter: "Chapter 1: Synchronous Motors",
            difficulty: "medium",
            explanation: "Damper windings act like an induction squirrel-cage rotor to start the motor and suppress hunting.",
            source_reference: "Chapter 1, Page 15",
          },
        ],
      });

      const result = validateExternalAiJson(validExternalAiJson);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.quiz).toBeDefined();
      expect(result.quiz?.questions).toHaveLength(2);

      // Verify preview construction
      expect(result.preview).toBeDefined();
      expect(result.preview?.title).toBe("Electrical Machines Quiz");
      expect(result.preview?.questionCount).toBe(2);
      expect(result.preview?.topics).toContain("Synchronous Speed");
      expect(result.preview?.topics).toContain("Damper Windings");
      expect(result.preview?.difficulties.easy).toBe(1);
      expect(result.preview?.difficulties.medium).toBe(1);
      expect(result.preview?.sampleQuestions).toHaveLength(2);
    });

    it("detects and clearly reports missing required fields and schema violations", () => {
      const invalidJson = JSON.stringify({
        title: "Broken Quiz",
        questions: [
          {
            // Missing id
            question: "Is this question valid?",
            options: { A: "Yes", B: "No", C: "Maybe" }, // Missing D
            correct_answer: "E", // Invalid answer key
            // Missing topic_reference
            // Missing explanation
          },
        ],
      });

      const result = validateExternalAiJson(invalidJson);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);

      const combinedErrors = result.errors.join("\n");
      expect(combinedErrors).toContain("Question 1");
      expect(combinedErrors).toMatch(/Missing or empty option|Missing required 'topic_reference'|'correct_answer' must be one of/i);
    });

    it("rejects non-distinct answer options and duplicate questions", () => {
      const duplicateOptionsJson = JSON.stringify({
        questions: [
          {
            id: "q1",
            question: "What is the capital of France?",
            options: { A: "Paris", B: "paris", C: "Lyon", D: "Marseille" }, // Paris & paris are duplicate
            correct_answer: "A",
            topic_reference: "Geography",
            explanation: "Paris is the capital.",
          },
          {
            id: "q2",
            question: "What is the capital of France?", // Duplicate question stem
            options: { A: "Berlin", B: "Rome", C: "Madrid", D: "Paris" },
            correct_answer: "D",
            topic_reference: "Geography",
            explanation: "Paris is the capital.",
          },
        ],
      });

      const result = validateExternalAiJson(duplicateOptionsJson);
      expect(result.success).toBe(false);
      const combined = result.errors.join("\n");
      expect(combined).toMatch(/distinct|Duplicate question stem/i);
    });

    it("gracefully reports invalid JSON syntax", () => {
      const malformed = "{ title: 'Unquoted key', questions: [ ";
      const result = validateExternalAiJson(malformed);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Invalid JSON syntax/i);
    });
  });

  describe("End-to-End Quiz Completion & Scoring with Imported Materials", () => {
    it("completes quiz session and scores imported questions correctly", () => {
      const importedJson = JSON.stringify({
        title: "Photosynthesis Practice",
        questions: [
          {
            id: "q1",
            question: "Where do the light-dependent reactions of photosynthesis take place?",
            options: {
              A: "Thylakoid membrane",
              B: "Stroma",
              C: "Cytosol",
              D: "Mitochondrial matrix",
            },
            correct_answer: "A",
            topic_reference: "Light Reactions",
            explanation: "Thylakoids house photosystems I and II.",
            source_reference: "Page 4",
          },
          {
            id: "q2",
            question: "What is the primary carbon-fixing enzyme in the Calvin cycle?",
            options: {
              A: "RuBisCO",
              B: "ATP Synthase",
              C: "Hexokinase",
              D: "Pyruvate dehydrogenase",
            },
            correct_answer: "A",
            topic_reference: "Calvin Cycle",
            explanation: "RuBisCO fixes carbon dioxide to RuBP.",
            source_reference: "Page 8",
          },
        ],
      });

      const validation = validateExternalAiJson(importedJson);
      expect(validation.success).toBe(true);
      const validatedQuiz = validateQuiz(validation.quiz);

      const mockDoc: NormalizedDocument = {
        filename: "External_Import.json",
        pages: [{ page: 1, text: "Imported material", source: "native" }],
        text: "Imported material",
        wordCount: 50,
        truncated: false,
      };

      const quiz = createQuiz(validatedQuiz.questions, mockDoc);
      expect(quiz.id).toBeDefined();

      // Submit Q1 correct, Q2 wrong
      const r1 = submitAnswer(quiz.id, "q1", "A");
      expect(r1.correct).toBe(true);
      expect(r1.completed).toBe(false);

      const r2 = submitAnswer(quiz.id, "q2", "B");
      expect(r2.correct).toBe(false);
      expect(r2.completed).toBe(true);

      const score = calculateScore(quiz.questions, quiz.answers);
      expect(score.correct).toBe(1);
      expect(score.total).toBe(2);
      expect(score.percentage).toBe(50);
    });
  });
});
