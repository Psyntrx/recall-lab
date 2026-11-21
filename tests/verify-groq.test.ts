import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GroqProvider } from "@/lib/ai/groq-provider";
import { extractTxt } from "@/lib/document/extract";
import { createQuiz, submitAnswer } from "@/lib/quiz/store";
import { calculateScore } from "@/lib/quiz/scoring";
import { config } from "@/lib/config";

// Ensure .env.local values are loaded into process.env in Vitest environment
beforeAll(() => {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      const val = rest.join("=").trim();
      if (key && val && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
  if (process.env.GROQ_API_KEY) {
    config.groqApiKey = process.env.GROQ_API_KEY;
  }
});

const sampleText = `
Chapter 1: Principles of Photosynthesis and Energy Conversion

Photosynthesis is the fundamental biological process that transforms light energy into chemical energy stored in glucose and other carbohydrate molecules.
Oxygenic photosynthesis is utilized by land plants, green algae, and cyanobacteria. In oxygenic photosynthesis, water (H2O) serves as the primary electron donor, resulting in the release of molecular oxygen (O2) into the atmosphere.
The overall chemical equation is summarized as: 6 CO2 + 6 H2O + light energy -> C6H12O6 + 6 O2.

The photosynthetic mechanism is divided into two spatially and chemically distinct phases:
1. Light-Dependent Reactions: Located within the thylakoid membrane of chloroplasts. Photosystems I and II absorb photons, exciting chlorophyll electrons. As these electrons traverse the electron transport chain, a proton gradient drives ATP synthase to produce ATP, while NADP+ reductase synthesizes NADPH.
2. The Calvin Cycle (Light-Independent Reactions): Located in the stroma of chloroplasts. The enzyme Ribulose-1,5-bisphosphate carboxylase-oxygenase (RuBisCO) catalyzes the fixation of carbon dioxide to ribulose 1,5-bisphosphate (RuBP), producing 3-phosphoglycerate (3-PGA). ATP and NADPH from the light reactions then drive the reduction of 3-PGA into glyceraldehyde 3-phosphate (G3P), which is utilized to regenerate RuBP and synthesize glucose.

Chapter 2: Cellular Respiration and Glycolysis

Cellular respiration is the complementary metabolic pathway wherein biochemical energy from nutrients is converted into adenosine triphosphate (ATP).
Glycolysis is the initial anaerobic stage occurring in the cytoplasm, breaking one molecule of glucose into two molecules of pyruvate, yielding a net gain of 2 ATP and 2 NADH.
In aerobic conditions, pyruvate enters the mitochondrial matrix for decarboxylation and the citric acid cycle (Krebs cycle).
`;

describe("Live Groq Integration Verification", () => {
  it("verifies document extraction, live Groq summary, question generation, and quiz completion", async () => {
    // 1. Document Extraction
    const fakeFile = new File([sampleText], "photosynthesis_respiration.txt", { type: "text/plain" });
    const extractedDoc = await extractTxt(fakeFile);
    expect(extractedDoc.text).toContain("Photosynthesis");
    expect(extractedDoc.wordCount).toBeGreaterThan(50);
    console.log("1. Document Extraction: PASSED");

    const provider = new GroqProvider();
    expect(provider.getModel()).toBe("openai/gpt-oss-120b");
    console.log("Active Model:", provider.getModel());

    // 2. AI Summary Generation
    const summary = await provider.generateSummary(extractedDoc);
    expect(summary).toBeDefined();
    expect(summary.summary.length).toBeGreaterThan(20);
    console.log("2. Live AI Summary:", summary.title);

    // 3. Question Generation
    const questionSet = await provider.generateQuestions({
      document: extractedDoc,
      maxQuestions: 5,
    });
    expect(questionSet.questions).toHaveLength(5);
    for (const q of questionSet.questions) {
      expect(q.options).toHaveProperty("A");
      expect(q.options).toHaveProperty("B");
      expect(q.options).toHaveProperty("C");
      expect(q.options).toHaveProperty("D");
      expect(["A", "B", "C", "D"]).toContain(q.correct_answer);
      expect(q.explanation.length).toBeGreaterThan(10);
    }
    console.log("3. Live Question Generation: PASSED (5 questions generated)");

    // 4. Quiz Interface Completion
    const quiz = createQuiz(questionSet.questions, extractedDoc);
    expect(quiz.id).toBeDefined();

    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const answerToSubmit = i === 4 ? (q.correct_answer === "A" ? "B" : "A") : q.correct_answer;
      const result = submitAnswer(quiz.id, q.id, answerToSubmit);
      if (i < 4) {
        expect(result.correct).toBe(true);
      } else {
        expect(result.correct).toBe(false);
      }
    }

    const score = calculateScore(quiz.questions, quiz.answers);
    expect(score.correct).toBe(4);
    expect(score.total).toBe(5);
    expect(score.percentage).toBe(80);
    console.log("4. Quiz Completion & Scoring: PASSED (80%)");
  }, 60_000);
});
