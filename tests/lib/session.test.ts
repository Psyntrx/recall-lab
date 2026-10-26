import { describe, expect, it } from "vitest";
import { validateQuiz } from "@/lib/quiz/import";
import { createStudySession, createStudySessionUrl, decodeStudySession, encodeStudySession, MAX_SHARE_URL_LENGTH, parseStudySession, serializeStudySession, validateStudySession } from "@/lib/quiz/session";
import { makeStudyReport } from "@/lib/quiz/report";
import { parseSessionProgress, restoreProgressAttempts, sessionProgressKey } from "@/lib/quiz/progress";

const quiz = validateQuiz({ title: "Statics: Chapters 2 and 3", questions: [
  { id: "q1", question: "Which equilibrium equation applies?", options: { A: "ΣFx=0", B: "ΣFy=0", C: "ΣM=0", D: "All three" }, correct_answer: "D", topic_reference: "Chapter 2: Equilibrium", explanation: "A body in planar static equilibrium has zero net force and moment.", source_reference: "Chapter 2, page 12" },
  { id: "q2", question: "What is the unit of moment?", options: { A: "N", B: "N·m", C: "Pa", D: "J/s" }, correct_answer: "B", topic_reference: "Chapter 3: Moments", explanation: "Moment is force multiplied by perpendicular distance.", source_reference: null },
] });

describe("portable study sessions", () => {
  it("creates a unique session with one stable creation timestamp and derived topics", () => {
    const createdAt = new Date("2026-10-26T08:20:00.000Z");
    const first = createStudySession(quiz, createdAt);
    const second = createStudySession(quiz, createdAt);
    expect(first.session_id).not.toBe(second.session_id);
    expect(first.created_at).toBe("2026-10-26T08:20:00.000Z");
    expect(first.created_local).toBeTruthy();
    expect(first.title).toBe(quiz.title);
    expect(first.subject).toBeNull();
    expect(first.topics).toEqual(["Chapter 2: Equilibrium", "Chapter 3: Moments"]);
    expect(first.question_count).toBe(2);
  });

  it("round-trips session JSON and encoded share data without changing metadata", () => {
    const session = createStudySession(quiz, new Date("2026-10-26T08:20:00.000Z"));
    const fromFile = parseStudySession(serializeStudySession(session));
    const fromLink = decodeStudySession(encodeStudySession(session));
    expect(fromFile).toEqual(session);
    expect(fromLink).toEqual(session);
  });

  it("rejects malformed, incomplete, unsupported, and oversized session data", () => {
    const session = createStudySession(quiz);
    expect(() => parseStudySession("{" )).toThrow(/valid JSON/i);
    expect(() => validateStudySession({ ...session, version: 2 })).toThrow(/unsupported/i);
    expect(() => validateStudySession({ ...session, question_count: 99 })).toThrow(/does not match/i);
    expect(() => validateStudySession({ ...session, answers: { q1: "A" } })).toThrow(/unsupported fields/i);
    expect(() => validateStudySession({ ...session, topics: ["Different topic"] })).toThrow(/topics do not match/i);
    expect(() => decodeStudySession("%%%invalid%%%" )).toThrow(/malformed|damaged/i);
    expect(() => parseStudySession(" ".repeat(10_000_001))).toThrow(/10 MB/i);
    expect(MAX_SHARE_URL_LENGTH).toBeGreaterThan(1000);
  });

  it("refuses to create a URL above the configured limit so the file fallback can be used", () => {
    const session = createStudySession(quiz);
    expect(() => createStudySessionUrl(session, "https://study.example/", 200)).toThrow(/download the session JSON/i);
  });

  it("scopes saved answers to one session and recomputes correctness from that session quiz", () => {
    const session = createStudySession(quiz);
    const other = createStudySession(quiz);
    const stored = JSON.stringify({ version: 1, session_id: session.session_id, answers: { q1: "A" }, current_index: 0, completed_at: null, completed_local: null });
    const progress = parseSessionProgress(stored, session);
    expect(progress?.answers).toEqual({ q1: "A" });
    expect(parseSessionProgress(stored, other)).toBeNull();
    expect(parseSessionProgress(JSON.stringify({ ...JSON.parse(stored), score: 1 }), session)).toBeNull();
    expect(sessionProgressKey(session.session_id)).not.toBe(sessionProgressKey(other.session_id));
    expect(restoreProgressAttempts(progress, quiz)).toEqual({ q1: { selected: "A", correct: false } });
  });

  it("builds a structured report with session and attempt timestamps, score, misses, and references", () => {
    const session = createStudySession(quiz, new Date("2026-10-26T08:20:00.000Z"));
    const report = makeStudyReport({
      quiz,
      attempts: { q1: { selected: "D", correct: true }, q2: { selected: "A", correct: false } },
      score: 1,
      topics: [{ topic: "Chapter 2: Equilibrium", total: 1, missed: 0 }, { topic: "Chapter 3: Moments", total: 1, missed: 1 }],
      session,
      completedAt: "2026-10-26T09:15:00.000Z",
      completedLocal: "Oct 26, 2026, 12:15 PM EAT",
    });
    expect(report).toContain(`Session ID: ${session.session_id}`);
    expect(report).toContain("2026-10-26T08:20:00.000Z");
    expect(report).toContain("2026-10-26T09:15:00.000Z");
    expect(report).toContain("Score: 1/2");
    expect(report).toContain("Incorrect answers: 1");
    expect(report).toContain("Chapter 3: Moments: 1 missed out of 1");
    expect(report).toContain("Chapter 2, page 12");
    expect(report).toContain("REQUEST FOR AI");
  });
});
