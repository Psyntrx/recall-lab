export function makeQuestionPrompt(count: number, focus: string) {
  return `I am attaching study material such as lecture notes, textbook extracts, chapters, or past papers. Read it carefully and create up to ${count} high-quality questions, with fewer if the material does not support that many useful questions. Never pad the quiz. Stay within a total limit of 30 questions.${focus.trim() ? ` Prioritize ${focus.trim()} where the material supports it.` : ""}

Use a balanced mix of:
- Conceptual questions about definitions, principles, assumptions, applications, and understanding.
- Formula-selection questions that state a technical problem and offer four candidate formulas. Define variables in the question whenever needed (for example, distinguish outer diameter D from inner diameter d for a hollow circular section). Explain what the correct formula represents and why it applies; explain why alternatives are unsuitable only when the supplied material establishes that.
- Numerical calculation questions, when the supplied material gives enough information. Before writing each one, identify the equation and assumptions, substitute the supplied values with units, calculate the result, and verify the arithmetic. Include the correct result as one option and make the other three plausible errors (such as a wrong diameter, omitted conversion, wrong equation, or arithmetic slip). Keep units consistent and vary the correct answer letter. Do not invent values or assumptions that materially affect the result; omit a question if essential information is missing.

Write a useful teaching explanation for every question. For calculations include the formula, variable definitions, unit-bearing substitution, intermediate steps, final result and units, and why the formula and assumptions fit. For formula selection explain the represented quantity and why the formula applies. For conceptual questions explain the underlying principle and why the answer is correct. Check technical claims and all calculations before returning the JSON. Ground every question in the supplied material; do not invent facts, equations, definitions, or references. Keep distractors plausible but unambiguously wrong under stated assumptions, and avoid repetition or ambiguity.

Return raw valid JSON only: no Markdown fences, commentary, comments, or trailing commas. Preserve this exact field structure and naming:
${JSON.stringify({ title: "Short quiz title", questions: [{ id: "q1", question: "Question text", options: { A: "First choice", B: "Second choice", C: "Third choice", D: "Fourth choice" }, correct_answer: "A", topic_reference: "Chapter or topic", explanation: "Worked explanation", source_reference: null }] }, null, 2)}

Requirements:
- Every question must contain exactly four distinct, non-empty options keyed A, B, C, and D, with exactly one correct answer.
- Set correct_answer to exactly one of "A", "B", "C", or "D" and ensure it points to the correct supplied option. Vary the correct letter across questions.
- Include a unique non-empty id, question text, topic_reference, useful explanation, and source_reference (a supported page/section string or null) for every question.
- Produce no more than ${count} questions or 30 total; prefer meaningful coverage over a target count when the source is limited.
- Escape JSON strings correctly and include no extra fields.`;
}
