import { describe, expect, it } from "vitest";
import { validateQuiz } from "@/lib/quiz/import";
import { makeQuestionPrompt } from "@/lib/quiz/prompt";

const question = { id: "q1", question: "Calculate the area of the hollow circular section with D = 20 mm and d = 10 mm.", options: { A: "1 m²", B: "2 m²", C: "3 m²", D: "4 m²" }, correct_answer: "D", topic_reference: "Geometry", explanation: "Use A = π/4(D² − d²), where D is the outer diameter and d is the inner diameter. Substitute 20 mm and 10 mm: A = π/4(400 − 100) mm² = 235.6 mm². Convert to square metres: 235.6 mm² × 10⁻⁶ = 0.0002356 m².", source_reference: null };

describe("external quiz prompt and import contract", () => {
  it("accepts four options and a valid answer reference", () => {
    const imported = validateQuiz({ title: "Quiz", questions: [question] }).questions[0];
    expect(imported.correct_answer).toBe("D");
    expect(imported.explanation).toContain("235.6 mm²");
  });

  it.each([2, 3, 5])("rejects %i options instead of four", (count) => {
    const options = Object.fromEntries(["A", "B", "C", "D", "E"].slice(0, count).map((key) => [key, key])) as Record<string, string>;
    expect(() => validateQuiz({ questions: [{ ...question, options }] })).toThrow(/exactly four options/i);
  });

  it("rejects repeated choices and invalid correct-answer references", () => {
    expect(() => validateQuiz({ questions: [{ ...question, options: { ...question.options, D: "1 m²" } }] })).toThrow(/different answer choices/i);
    expect(() => validateQuiz({ questions: [{ ...question, correct_answer: "E" }] })).toThrow(/correct_answer/i);
  });

  it("asks for source-grounded conceptual, formula-selection, and verified numerical questions", () => {
    const prompt = makeQuestionPrompt(10, "Chapters 3–5");
    expect(prompt).toContain("exactly four distinct, non-empty options keyed A, B, C, and D");
    expect(prompt).toContain("Formula-selection questions");
    expect(prompt).toContain("distinguish outer diameter D from inner diameter d");
    expect(prompt).toContain("verify the arithmetic");
    expect(prompt).toContain("Vary the correct letter across questions");
    expect(prompt).toContain("useful teaching explanation");
    expect(prompt).toContain("Chapters 3–5");
    expect(prompt).toContain('"source_reference": null');
  });
});
