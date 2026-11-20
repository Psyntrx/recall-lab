import { describe, expect, it } from "vitest";
import { extractAssessmentQuestions } from "@/lib/assessment/extract";
import { buildAssessmentCoverageMap, detectRepeatedQuestions, matchQuestionsToChapters } from "@/lib/assessment/analysis";
import { createDocumentChunks, SearchIndex } from "@/lib/document/index";
import type { DocumentPage } from "@/lib/document/types";

describe("past-paper and CAT assessment intelligence", () => {
  it("extracts assessment questions with marks and subquestions", () => {
    const pages: DocumentPage[] = [
      {
        page: 1,
        text: `DEPARTMENT OF ELECTRICAL ENGINEERING
FINAL EXAMINATION 2023
Question 1: Explain the difference between synchronous motors and induction motors. [10 marks]
(a) Define pull-in torque.
(b) Derive the expression for synchronous impedance.
Question 2: State three methods of voltage regulation for an alternator. [15 marks]`,
        source: "native",
      },
    ];

    const questions = extractAssessmentQuestions({
      documentName: "Exam_2023.pdf",
      pages,
    });

    expect(questions.length).toBe(2);
    expect(questions[0].wording).toContain("synchronous motors");
    expect(questions[0].marks).toContain("10 marks");
    expect(questions[0].subquestions?.length).toBe(2);
    expect(questions[1].wording).toContain("voltage regulation");
    expect(questions[1].marks).toContain("15 marks");
  });

  it("detects repeated and similar questions across multiple past papers", () => {
    const questions = [
      {
        id: "q-1",
        wording: "Explain the methods of starting a synchronous motor.",
        sourceDocument: "Exam_2022.pdf",
        page: 2,
      },
      {
        id: "q-2",
        wording: "Explain the different methods used for starting a synchronous motor.",
        sourceDocument: "Exam_2023.pdf",
        page: 1,
      },
      {
        id: "q-3",
        wording: "Calculate the pitch factor and distribution factor of an armature winding.",
        sourceDocument: "CAT_1.pdf",
        page: 1,
      },
    ];

    const processed = detectRepeatedQuestions(questions);
    expect(processed[0].isRepeated).toBe(true);
    expect(processed[0].repeatCount).toBe(2);
    expect(processed[1].isRepeated).toBe(true);
    expect(processed[2].isRepeated).toBeUndefined();
  });

  it("matches assessment questions to chapters and builds coverage map", () => {
    const chapters = [
      { id: "ch-1", title: "Chapter 1: Synchronous Motors", pageStart: 1, pageEnd: 20, chunkCount: 5 },
      { id: "ch-2", title: "Chapter 2: Alternator Voltage Regulation", pageStart: 21, pageEnd: 40, chunkCount: 5 },
    ];

    const chunks = [
      {
        id: "chunk-1",
        documentId: "textbook",
        documentName: "textbook.pdf",
        documentType: "textbook" as const,
        pageStart: 1,
        pageEnd: 10,
        chapterId: "ch-1",
        chapterTitle: "Chapter 1: Synchronous Motors",
        text: "Synchronous motors starting methods include pony motor, damper windings, and variable frequency drive.",
        wordCount: 15,
      },
      {
        id: "chunk-2",
        documentId: "textbook",
        documentName: "textbook.pdf",
        documentType: "textbook" as const,
        pageStart: 21,
        pageEnd: 30,
        chapterId: "ch-2",
        chapterTitle: "Chapter 2: Alternator Voltage Regulation",
        text: "Voltage regulation of an alternator can be determined using synchronous impedance method, MMF method, and Potier triangle method.",
        wordCount: 19,
      },
    ];

    const index = new SearchIndex(chunks);
    const questions = [
      {
        id: "q-1",
        wording: "What are the common starting methods for synchronous motors?",
        sourceDocument: "Exam_2022.pdf",
        page: 1,
      },
      {
        id: "q-2",
        wording: "Explain the Potier triangle method for alternator voltage regulation.",
        sourceDocument: "Exam_2023.pdf",
        page: 2,
      },
    ];

    const matched = matchQuestionsToChapters({ questions, chapters, index });
    expect(matched[0].matchedChapterId).toBe("ch-1");
    expect(matched[1].matchedChapterId).toBe("ch-2");

    const coverage = buildAssessmentCoverageMap({ questions: matched, chapters });
    expect(coverage["ch-1"].pastPaperQuestionCount).toBe(1);
    expect(coverage["ch-2"].pastPaperQuestionCount).toBe(1);
  });
});
