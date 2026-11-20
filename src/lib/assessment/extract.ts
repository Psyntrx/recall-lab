import type { DocumentPage, ExtractedAssessmentQuestion } from "@/lib/document/types";

export function extractAssessmentQuestions(params: {
  documentName: string;
  pages: DocumentPage[];
}): ExtractedAssessmentQuestion[] {
  const { documentName, pages } = params;
  const questions: ExtractedAssessmentQuestion[] = [];
  let questionCounter = 1;

  const marksRegex = /\[\s*(\d+)\s*marks?\s*\]|\(\s*(\d+)\s*marks?\s*\)/i;

  for (const page of pages) {
    if (!page.text || page.text.trim().length === 0) continue;

    const lines = page.text.split("\n");
    let currentQuestion: {
      id: string;
      wording: string;
      marks?: string;
      subquestions: string[];
      page: number;
    } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const qMatch = /(?:^|\s)(?:Question\s*(\d+|[A-Z]+)|Q(\d+)|(\d+)\.)[:.-]?\s+([A-Za-z0-9].{6,})/i.exec(line);
      const isSubquestion = /^\(([a-z]|[ivx]+)\)\s+(.+)/i.exec(line);

      if (qMatch) {
        if (currentQuestion && currentQuestion.wording.trim().length > 10) {
          questions.push({
            id: currentQuestion.id,
            wording: currentQuestion.wording.trim(),
            marks: currentQuestion.marks,
            subquestions: currentQuestion.subquestions.length ? currentQuestion.subquestions : undefined,
            sourceDocument: documentName,
            page: currentQuestion.page,
          });
        }

        const markMatch = line.match(marksRegex);
        currentQuestion = {
          id: `ext-q-${questionCounter++}`,
          wording: qMatch[4],
          marks: markMatch ? markMatch[0] : undefined,
          subquestions: [],
          page: page.page,
        };
      } else if (isSubquestion && currentQuestion) {
        currentQuestion.subquestions.push(line);
        currentQuestion.wording += `\n${line}`;
      } else if (currentQuestion) {
        const markMatch = line.match(marksRegex);
        if (markMatch && !currentQuestion.marks) {
          currentQuestion.marks = markMatch[0];
        }
        currentQuestion.wording += ` ${line}`;
      }
    }

    if (currentQuestion && currentQuestion.wording.trim().length > 10) {
      questions.push({
        id: currentQuestion.id,
        wording: currentQuestion.wording.trim(),
        marks: currentQuestion.marks,
        subquestions: currentQuestion.subquestions.length ? currentQuestion.subquestions : undefined,
        sourceDocument: documentName,
        page: currentQuestion.page,
      });
    }
  }

  return questions;
}
