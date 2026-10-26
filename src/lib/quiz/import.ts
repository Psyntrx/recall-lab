export type AnswerKey = "A" | "B" | "C" | "D";
export type Question = {
  id: string;
  question: string;
  options: Record<AnswerKey, string>;
  correct_answer: AnswerKey;
  topic_reference: string;
  explanation: string;
  source_reference: string | null;
};
export type QuizFile = { title: string; questions: Question[] };

export function validateQuiz(value: unknown): QuizFile {
  if (!value || typeof value !== "object") throw new Error("The JSON must be an object with a questions array.");
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.questions) || candidate.questions.length === 0) throw new Error("Add at least one question to the questions array.");
  if (candidate.questions.length > 30) throw new Error("A quiz can contain no more than 30 questions.");
  const seen = new Set<string>();
  const questions = candidate.questions.map((raw, index): Question => {
    const path = `Question ${index + 1}`;
    if (!raw || typeof raw !== "object") throw new Error(`${path} must be an object.`);
    const q = raw as Record<string, unknown>;
    if (typeof q.id !== "string" || !q.id.trim()) throw new Error(`${path} needs a non-empty id.`);
    if (seen.has(q.id)) throw new Error(`Question id “${q.id}” is repeated.`);
    seen.add(q.id);
    if (typeof q.question !== "string" || !q.question.trim()) throw new Error(`${path} needs question text.`);
    if (!q.options || typeof q.options !== "object" || Array.isArray(q.options)) throw new Error(`${path} needs exactly four options: A, B, C, and D.`);
    const options = q.options as Record<string, unknown>;
    if (Object.keys(options).sort().join(",") !== "A,B,C,D") throw new Error(`${path} must have exactly four options: A, B, C, and D.`);
    const keys: AnswerKey[] = ["A", "B", "C", "D"];
    if (keys.some((key) => typeof options[key] !== "string" || !options[key].trim())) throw new Error(`${path} needs four non-empty answer choices.`);
    if (new Set(keys.map((key) => (options[key] as string).trim().toLocaleLowerCase())).size !== 4) throw new Error(`${path} must have four different answer choices.`);
    if (!keys.includes(q.correct_answer as AnswerKey)) throw new Error(`${path} correct_answer must be “A”, “B”, “C”, or “D”.`);
    if (typeof q.topic_reference !== "string" || !q.topic_reference.trim()) throw new Error(`${path} needs a topic_reference.`);
    if (typeof q.explanation !== "string" || !q.explanation.trim()) throw new Error(`${path} needs an explanation.`);
    if (q.source_reference !== null && typeof q.source_reference !== "string") throw new Error(`${path} source_reference must be text or null.`);
    return { id: q.id, question: q.question, options: { A: options.A as string, B: options.B as string, C: options.C as string, D: options.D as string }, correct_answer: q.correct_answer as AnswerKey, topic_reference: q.topic_reference, explanation: q.explanation, source_reference: q.source_reference as string | null };
  });
  if (new Set(questions.map((q) => q.question.trim().toLocaleLowerCase())).size !== questions.length) throw new Error("Questions must be unique.");
  return { title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : "Study quiz", questions };
}
