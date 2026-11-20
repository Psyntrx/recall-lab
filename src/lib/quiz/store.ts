import { randomUUID } from "crypto";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { calculateScore } from "./scoring";
import type { Question, RevisionPlan } from "./schemas";
import type { NormalizedDocument } from "@/lib/document/types";
import { storage, type DurableQuiz } from "@/lib/storage/store";

function alive(id: string): DurableQuiz {
  const quiz = storage.getQuiz(id);
  if (!quiz || Date.now() - quiz.createdAt > config.quizTtlMs) {
    if (quiz) storage.deleteQuiz(id);
    throw new AppError("This quiz has expired or the server restarted. Please upload your material again.", 404, "QUIZ_NOT_FOUND");
  }
  return quiz;
}

export function createQuiz(questions: Question[], document: NormalizedDocument): DurableQuiz {
  const quiz: DurableQuiz = {
    id: randomUUID(),
    questions,
    document,
    answers: {},
    createdAt: Date.now(),
  };
  storage.saveQuiz(quiz);
  return quiz;
}

export function publicQuiz(id: string) {
  const q = alive(id);
  return {
    id: q.id,
    questions: q.questions.map(({ correct_answer, explanation, ...question }) => ({
      ...question,
      answered: Boolean(q.answers[question.id]),
    })),
    total: q.questions.length,
  };
}

export function submitAnswer(id: string, questionId: string, answer: string) {
  const q = alive(id);
  const question = q.questions.find((item) => item.id === questionId);
  if (!question) throw new AppError("Question not found.", 404, "QUESTION_NOT_FOUND");
  if (q.answers[questionId]) throw new AppError("This answer has already been submitted.", 409, "ANSWER_ALREADY_SUBMITTED");
  q.answers[questionId] = answer;
  storage.saveQuiz(q);
  return {
    correct: answer === question.correct_answer,
    correctAnswer: question.correct_answer,
    explanation: question.explanation,
    completed: Object.keys(q.answers).length === q.questions.length,
  };
}

export function results(id: string) {
  const q = alive(id);
  return {
    score: calculateScore(q.questions, q.answers),
    questions: q.questions.map((question) => ({
      ...question,
      selectedAnswer: q.answers[question.id] ?? null,
    })),
    recommendations: q.recommendations,
  };
}

export function quizForRecommendations(id: string) {
  return alive(id);
}

export function saveRecommendations(id: string, plan: RevisionPlan) {
  const q = alive(id);
  q.recommendations = plan;
  storage.saveQuiz(q);
}
