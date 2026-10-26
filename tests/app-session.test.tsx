/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { createStudySession, encodeStudySession, serializeStudySession } from "@/lib/quiz/session";
import { sessionProgressKey } from "@/lib/quiz/progress";
import { validateQuiz } from "@/lib/quiz/import";

const quiz = validateQuiz({ title: "Statics: Chapters 2 and 3", questions: [
  { id: "q1", question: "Which equation expresses force balance?", options: { A: "ΣFx=0", B: "ΣFy=0", C: "ΣM=0", D: "ΣF=ma" }, correct_answer: "A", topic_reference: "Chapter 2: Equilibrium", explanation: "The horizontal force components must sum to zero.", source_reference: "Page 12" },
  { id: "q2", question: "What is the unit of moment?", options: { A: "N", B: "N·m", C: "Pa", D: "J/s" }, correct_answer: "B", topic_reference: "Chapter 3: Moments", explanation: "Moment is force multiplied by perpendicular distance.", source_reference: null },
] });

function setSharedUrl(session = createStudySession(quiz, new Date("2026-10-26T08:20:00.000Z"))) {
  const token = encodeStudySession(session);
  window.history.replaceState(null, "", `/?session=${token}`);
  return session;
}

const storageData = new Map<string, string>();
const testStorage = {
  getItem: (key: string) => storageData.get(key) ?? null,
  setItem: (key: string, value: string) => { storageData.set(key, String(value)); },
  removeItem: (key: string) => { storageData.delete(key); },
  clear: () => storageData.clear(),
  key: (index: number) => [...storageData.keys()][index] ?? null,
  get length() { return storageData.size; },
} as Storage;

beforeEach(() => { storageData.clear(); Object.defineProperty(window, "localStorage", { configurable: true, value: testStorage }); });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); storageData.clear(); vi.restoreAllMocks(); });

describe("shared session experience", () => {
  it("shows the session confirmation page and starts the validated quiz", async () => {
    const session = setSharedUrl();
    render(<Home />);
    expect(await screen.findByRole("heading", { name: session.title })).toBeTruthy();
    expect(screen.getByText("AI Study Quiz · Shared study session")).toBeTruthy();
    expect(screen.getByText(session.created_local)).toBeTruthy();
    expect(screen.getByText(session.session_id)).toBeTruthy();
    expect(screen.getByText("Chapter 2: Equilibrium, Chapter 3: Moments")).toBeTruthy();
    expect(screen.getByText(/recipients can inspect them/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /start quiz/i }));
    expect(await screen.findByRole("heading", { name: quiz.questions[0].question })).toBeTruthy();
  });

  it("displays a graceful error for malformed shared links", async () => {
    window.history.replaceState(null, "", "/?session=%%%invalid%%%");
    render(<Home />);
    expect(await screen.findByRole("heading", { name: /could not open this session/i })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/malformed|damaged/i);
    expect(screen.getByText("Open session JSON")).toBeTruthy();
  });

  it("lets a recipient import a session JSON file from the invalid-link page", async () => {
    window.history.replaceState(null, "", "/?session=invalid");
    render(<Home />);
    await screen.findByRole("heading", { name: /could not open this session/i });
    const session = createStudySession(quiz);
    const file = new File([serializeStudySession(session)], "study-session.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Open session JSON"), { target: { files: [file] } });
    expect(await screen.findByRole("heading", { name: session.title })).toBeTruthy();
  });

  it("uses a local recovery reference and downloadable JSON when the share URL is too long", async () => {
    render(<Home />);
    const largeQuiz = { ...quiz, title: "Large source-grounded quiz", questions: [{ ...quiz.questions[0], explanation: "Detailed worked explanation. ".repeat(400) }] };
    fireEvent.change(screen.getByLabelText("Paste the AI’s JSON here"), { target: { value: JSON.stringify(largeQuiz) } });
    fireEvent.click(screen.getByRole("button", { name: /create shareable session/i }));
    expect(await screen.findByRole("heading", { name: largeQuiz.title })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/too large for a reliable share link/i);
    const localReference = new URLSearchParams(window.location.search).get("localSession");
    expect(localReference).toBeTruthy();
    expect(screen.getByRole("button", { name: /download session json/i })).toBeTruthy();
    cleanup();
    render(<Home />);
    expect(await screen.findByRole("heading", { name: largeQuiz.title })).toBeTruthy();
  });

  it("restores a student's answer after refresh without putting it in the shared session", async () => {
    const session = setSharedUrl();
    const token = new URLSearchParams(window.location.search).get("session")!;
    expect(token).not.toContain("answers");
    const firstRender = render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
    fireEvent.click(screen.getByRole("button", { name: /ΣFx=0/i }));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByText(/That’s right/i)).toBeTruthy();
    firstRender.unmount();

    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
    expect(await screen.findByText(/That’s right/i)).toBeTruthy();
    expect(screen.getByText(/horizontal force components must sum to zero/i)).toBeTruthy();
    const saved = JSON.parse(window.localStorage.getItem(sessionProgressKey(session.session_id)) ?? "null");
    expect(saved.answers).toEqual({ q1: "A" });
    expect(saved).not.toHaveProperty("score");
  });

  it("creates a landing session from imported quiz JSON without requiring sharing to take a quiz", async () => {
    render(<Home />);
    fireEvent.change(screen.getByLabelText("Paste the AI’s JSON here"), { target: { value: JSON.stringify(quiz) } });
    fireEvent.click(screen.getByRole("button", { name: /create shareable session/i }));
    expect(await screen.findByRole("heading", { name: quiz.title })).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy share link/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download session json/i })).toBeTruthy();
  });

  it("copies the complete generated share URL and reports clipboard rejection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Home />);
    fireEvent.change(screen.getByLabelText("Paste the AI’s JSON here"), { target: { value: JSON.stringify(quiz) } });
    fireEvent.click(screen.getByRole("button", { name: /create shareable session/i }));
    await screen.findByRole("heading", { name: quiz.title });
    fireEvent.click(screen.getByRole("button", { name: /copy share link/i }));
    expect(await screen.findByRole("button", { name: /link copied/i })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(window.location.href);
    expect(new URL(writeText.mock.calls[0][0] as string).searchParams.get("session")).toBeTruthy();

    writeText.mockRejectedValueOnce(new Error("permission denied"));
    fireEvent.click(screen.getByRole("button", { name: /link copied/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not copy the share link/i);
    expect(screen.getByRole("button", { name: /copy failed/i })).toBeTruthy();
  });

  it("offers a restart after completing a shared session", async () => {
    setSharedUrl(createStudySession({ ...quiz, questions: [quiz.questions[0]] }));
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
    fireEvent.click(screen.getByRole("button", { name: /ΣFx=0/i }));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByRole("button", { name: /restart quiz/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /restart quiz/i }));
    expect((await screen.findByRole("button", { name: /check answer/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/That’s right/i)).toBeNull();
  });

  it("copies a study report with the session and attempt timestamps", async () => {
    const session = setSharedUrl(createStudySession({ ...quiz, questions: [quiz.questions[0]] }, new Date("2026-10-26T08:20:00.000Z")));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<Home />);
    fireEvent.click(await screen.findByRole("button", { name: /start quiz/i }));
    fireEvent.click(screen.getByRole("button", { name: /ΣFx=0/i }));
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /copy study report/i }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const report = writeText.mock.calls[0][0] as string;
    expect(report).toContain(`Session ID: ${session.session_id}`);
    expect(report).toContain("Session created: 2026-10-26T08:20:00.000Z");
    expect(report).toMatch(/Attempt completed: 20\d\d-/);
    expect(report).toContain("Score: 1/1");
  });
});
