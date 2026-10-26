import { validateQuiz, type QuizFile } from "./import";

export const MAX_SHARE_URL_LENGTH = 7_000;
export const MAX_SESSION_FILE_BYTES = 10_000_000;
const MAX_SESSION_TOKEN_LENGTH = Math.ceil(MAX_SESSION_FILE_BYTES * 4 / 3) + 8;

export type StudySession = {
  version: 1;
  session_id: string;
  title: string;
  subject: string | null;
  topics: string[];
  question_count: number;
  created_at: string;
  created_local: string;
  quiz: QuizFile;
};

export function localSessionDefinitionKey(sessionId: string): string {
  return `ai-study-quiz:session:v1:${sessionId}`;
}

export function formatLocalTimestamp(date: Date): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(date);
  } catch {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
    return `${date.toLocaleString()} (UTC${sign}${hours}:${minutes})`;
  }
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createStudySession(quizInput: QuizFile, createdAt = new Date()): StudySession {
  const quiz = validateQuiz(quizInput);
  return {
    version: 1,
    session_id: createSessionId(),
    title: quiz.title,
    subject: null,
    topics: [...new Set(quiz.questions.map((question) => question.topic_reference.trim()))],
    question_count: quiz.questions.length,
    created_at: createdAt.toISOString(),
    created_local: formatLocalTimestamp(createdAt),
    quiz,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateStudySession(value: unknown): StudySession {
  if (!isObject(value)) throw new Error("The study session must be a JSON object.");
  const expectedFields = ["created_at", "created_local", "question_count", "quiz", "session_id", "subject", "title", "topics", "version"];
  if (Object.keys(value).sort().join(",") !== expectedFields.join(",")) throw new Error("The study session has missing or unsupported fields.");
  if (value.version !== 1) throw new Error("This study session version is missing or unsupported.");
  if (typeof value.session_id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value.session_id)) throw new Error("The study session ID is invalid.");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 300) throw new Error("The study session title is missing or invalid.");
  if (value.subject !== null && (typeof value.subject !== "string" || value.subject.length > 300)) throw new Error("The study session subject is invalid.");
  if (!Array.isArray(value.topics) || value.topics.length > 120 || value.topics.some((topic) => typeof topic !== "string" || !topic.trim() || topic.length > 250)) throw new Error("The study session topics are invalid.");
  if (typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) throw new Error("The study session creation timestamp is invalid.");
  if (typeof value.created_local !== "string" || !value.created_local.trim() || value.created_local.length > 200) throw new Error("The study session local creation time is missing or invalid.");
  let quiz: QuizFile;
  try { quiz = validateQuiz(value.quiz); }
  catch (error) { throw new Error(`The study session quiz is invalid: ${error instanceof Error ? error.message : "invalid quiz data"}`); }
  if (!Number.isInteger(value.question_count) || value.question_count !== quiz.questions.length) throw new Error("The study session question count does not match its quiz.");
  if (new Set(value.topics as string[]).size !== (value.topics as string[]).length) throw new Error("The study session contains duplicate topics.");
  const quizTopics = [...new Set(quiz.questions.map((question) => question.topic_reference.trim()))];
  if (quizTopics.length !== (value.topics as string[]).length || quizTopics.some((topic) => !(value.topics as string[]).includes(topic))) throw new Error("The study session topics do not match its quiz.");
  return {
    version: 1,
    session_id: value.session_id,
    title: value.title.trim(),
    subject: typeof value.subject === "string" && value.subject.trim() ? value.subject.trim() : null,
    topics: [...value.topics as string[]],
    question_count: value.question_count as number,
    created_at: value.created_at,
    created_local: value.created_local,
    quiz,
  };
}

export function serializeStudySession(session: StudySession): string {
  const validated = validateStudySession(session);
  const serialized = JSON.stringify(validated, null, 2);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SESSION_FILE_BYTES) throw new Error("This session file is larger than the supported 10 MB limit.");
  return serialized;
}

export function parseStudySession(serialized: string): StudySession {
  if (new TextEncoder().encode(serialized).byteLength > MAX_SESSION_FILE_BYTES) throw new Error("This session file is larger than the supported 10 MB limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); }
  catch { throw new Error("The session file is not valid JSON."); }
  return validateStudySession(parsed);
}

export function encodeStudySession(session: StudySession): string {
  const bytes = new TextEncoder().encode(serializeStudySession(session));
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeStudySession(token: string): StudySession {
  if (!token || token.length > MAX_SESSION_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("The shared session link is malformed or too large.");
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return parseStudySession(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof Error && /study session|session file|timestamp|quiz|question count|topics|version|ID|title|subject/i.test(error.message)) throw error;
    throw new Error("The shared session link contains invalid or damaged data.");
  }
}

export function createStudySessionUrl(session: StudySession, baseUrl: string, maxLength = MAX_SHARE_URL_LENGTH): string {
  const url = new URL(baseUrl);
  url.searchParams.set("session", encodeStudySession(session));
  if (url.href.length > maxLength) throw new Error("This quiz is too large for a reliable share link. Download the session JSON and share that file instead.");
  return url.href;
}
