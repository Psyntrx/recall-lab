/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { makeQuestionPrompt } from "@/lib/quiz/prompt";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("quiz page workflow", () => {
  it("copies the latest complete prompt and shows then clears success feedback", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.useFakeTimers();
    render(<Home />);
    fireEvent.change(screen.getByLabelText("Number of questions"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Optional topic or chapter focus"), { target: { value: "Thermodynamics" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /copy prompt/i })); await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedPrompt = writeText.mock.calls[0][0] as string;
    expect(copiedPrompt).toBe(makeQuestionPrompt(15, "Thermodynamics"));
    expect(copiedPrompt.trim()).not.toBe("");
    expect(copiedPrompt).toContain("up to 15");
    expect(copiedPrompt).toContain("Thermodynamics");
    expect(copiedPrompt).toContain("Formula-selection questions");
    expect(copiedPrompt).toContain("exactly four distinct, non-empty options keyed A, B, C, and D");
    expect(screen.getByRole("button", { name: /copied!/i })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1900); });
    expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
    vi.useRealTimers();
  });

  it("shows a visible failure when clipboard writing rejects", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
    render(<Home />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /copy prompt/i })); await Promise.resolve(); });
    expect(screen.getByRole("alert").textContent).toMatch(/permission denied/i);
    expect(screen.getByRole("button", { name: /copy failed/i })).toBeTruthy();
  });

  it("renders four choices and scores a selected correct choice with immediate explanation", async () => {
    render(<Home />);
    const quiz = { title: "Two question sample", questions: [
      { id: "q1", question: "Which choice is correct?", options: { A: "Wrong one", B: "Wrong two", C: "Wrong three", D: "Correct option" }, correct_answer: "D", topic_reference: "Topic", explanation: "The supplied notes support choice D.", source_reference: null },
      { id: "q2", question: "Which option is also valid?", options: { A: "First", B: "Second", C: "Third", D: "Fourth" }, correct_answer: "B", topic_reference: "Topic", explanation: "The notes support choice B.", source_reference: null },
    ] };
    fireEvent.change(screen.getByLabelText("Paste the AI’s JSON here"), { target: { value: JSON.stringify(quiz) } });
    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    for (const key of ["A", "B", "C", "D"]) expect(screen.getByText(key, { selector: ".answer-letter" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Correct option/i }));
    fireEvent.click(screen.getByRole("button", { name: /Check answer/i }));
    expect(screen.getByText(/That’s right/i)).toBeTruthy();
    expect(screen.getByText(/supplied notes support choice D/i)).toBeTruthy();
  });
});
