import type { AnswerKey, QuizFile } from "./import";
import type { StudySession } from "./session";

export type QuizAttempt = { selected: AnswerKey; correct: boolean };
export type TopicStat = { topic: string; total: number; missed: number };

export function makeStudyReport(input: {
  quiz: QuizFile;
  attempts: Record<string, QuizAttempt>;
  score: number;
  topics: TopicStat[];
  session?: StudySession | null;
  completedAt?: string | null;
  completedLocal?: string | null;
}) {
  const { quiz, attempts, score, topics, session } = input;
  const prioritized = topics.filter((topic) => topic.missed > 0).map((topic) => `- ${topic.topic}: ${topic.missed} missed out of ${topic.total}`).join("\n") || "- No missed topics; review the questions marked correct to strengthen recall.";
  const answers = quiz.questions.map((question, index) => {
    const attempt = attempts[question.id];
    return `${index + 1}. ${question.question}\n   Topic: ${question.topic_reference}\n   Your answer: ${attempt.selected} — ${question.options[attempt.selected]} (${attempt.correct ? "correct" : "incorrect"})\n   Correct answer: ${question.correct_answer} — ${question.options[question.correct_answer]}\n   Explanation: ${question.explanation}${question.source_reference ? `\n   Source: ${question.source_reference}` : ""}`;
  }).join("\n\n");
  const sessionMetadata = session ? `SESSION\nSession ID: ${session.session_id}\nSession title: ${session.title}\nSubject/course: ${session.subject ?? "Not specified"}\nTopics: ${session.topics.join(", ") || "Not specified"}\nSession created: ${session.created_at} (${session.created_local})\nAttempt completed: ${input.completedAt ?? "Not recorded"}${input.completedLocal ? ` (${input.completedLocal})` : ""}\n\n` : `Attempt completed: ${input.completedAt ?? "Not recorded"}${input.completedLocal ? ` (${input.completedLocal})` : ""}\n\n`;
  return `STUDY SESSION REPORT\n${sessionMetadata}Quiz: ${quiz.title}\nScore: ${score}/${quiz.questions.length} (${Math.round(score / quiz.questions.length * 100)}%)\nCorrect answers: ${score}\nIncorrect answers: ${quiz.questions.length - score}\n\nTOPICS TO FOCUS ON\n${prioritized}\n\nQUESTION-BY-QUESTION RESULTS\n${answers}\n\nREQUEST FOR AI\nUsing only the quiz results above, tell me which chapters and concepts to prioritize. Explain the patterns in my mistakes, propose a short prioritized study plan with specific actions, and create a few follow-up practice questions for my weakest topics. If the report does not contain enough information to identify a chapter, say so instead of guessing.`;
}
