import type { AnswerKey, QuizFile } from "./import";
import type { StudySession } from "./session";

export type SessionProgress = {
  version: 1;
  session_id: string;
  answers: Record<string, AnswerKey>;
  current_index: number;
  completed_at: string | null;
  completed_local: string | null;
};

export function sessionProgressKey(sessionId: string): string {
  return `ai-study-quiz:attempt:v1:${sessionId}`;
}

export function parseSessionProgress(raw: string | null, session: StudySession): SessionProgress | null {
  if (!raw || raw.length > 100_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const progress = value as Record<string, unknown>;
    if (Object.keys(progress).sort().join(",") !== "answers,completed_at,completed_local,current_index,session_id,version") return null;
    if (progress.version !== 1 || progress.session_id !== session.session_id) return null;
    if (!Number.isInteger(progress.current_index) || (progress.current_index as number) < 0 || (progress.current_index as number) >= session.quiz.questions.length) return null;
    if (!progress.answers || typeof progress.answers !== "object" || Array.isArray(progress.answers)) return null;
    const questionIds = new Set(session.quiz.questions.map((question) => question.id));
    const answers: Record<string, AnswerKey> = {};
    for (const [id, answer] of Object.entries(progress.answers)) {
      if (!questionIds.has(id) || !["A", "B", "C", "D"].includes(answer as string)) return null;
      answers[id] = answer as AnswerKey;
    }
    const completedAt = progress.completed_at;
    const completedLocal = progress.completed_local;
    if (completedAt !== null && (typeof completedAt !== "string" || !Number.isFinite(Date.parse(completedAt)))) return null;
    if (completedLocal !== null && (typeof completedLocal !== "string" || completedLocal.length > 200)) return null;
    if ((completedAt === null) !== (completedLocal === null)) return null;
    if (Object.keys(answers).length === session.quiz.questions.length && (typeof completedAt !== "string" || typeof completedLocal !== "string")) return null;
    return {
      version: 1,
      session_id: session.session_id,
      answers,
      current_index: progress.current_index as number,
      completed_at: completedAt as string | null,
      completed_local: completedLocal as string | null,
    };
  } catch {
    return null;
  }
}

export function restoreProgressAttempts(progress: SessionProgress | null, quiz: QuizFile) {
  const attempts: Record<string, { selected: AnswerKey; correct: boolean }> = {};
  if (!progress) return attempts;
  for (const question of quiz.questions) {
    const selected = progress.answers[question.id];
    if (selected) attempts[question.id] = { selected, correct: selected === question.correct_answer };
  }
  return attempts;
}
