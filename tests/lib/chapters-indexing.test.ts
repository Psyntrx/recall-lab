import { describe, expect, it } from "vitest";
import { detectChapters } from "@/lib/document/chapters";
import { createDocumentChunks, SearchIndex } from "@/lib/document/index";
import { classifyDocument } from "@/lib/document/classification";
import type { DocumentPage } from "@/lib/document/types";

describe("document classification, chapter detection and indexing", () => {
  it("classifies past examination papers, CATs, and textbooks accurately", () => {
    expect(classifyDocument("EE_301_Past_Paper_2023.pdf", "Final Examination Semester II Total marks: 100")).toBe("past_paper");
    expect(classifyDocument("CAT_1_Machines.pdf", "Continuous Assessment Test 1 Time: 1 hour")).toBe("cat");
    expect(classifyDocument("Electrical_Machines_Textbook.pdf", "Table of contents Chapter 1 Preface ISBN")).toBe("textbook");
    expect(classifyDocument("Lecture_Notes_Week_3.pdf", "Lecture 3 Slides on Synchronous Motors")).toBe("lecture_notes");
  });

  it("detects chapters from table of contents and headings", () => {
    const pages: DocumentPage[] = [
      {
        page: 1,
        text: "Table of Contents\nChapter 1: AC Fundamentals ...... 5\nChapter 2: Synchronous Motors ...... 25\nChapter 3: Synchronous Generators ...... 55",
        source: "native",
      },
      { page: 5, text: "Chapter 1: AC Fundamentals\nIntroduction to sinusoidal waveforms and phasors.", source: "native" },
      { page: 25, text: "Chapter 2: Synchronous Motors\nOperating principles of 3-phase synchronous motors.", source: "native" },
      { page: 55, text: "Chapter 3: Synchronous Generators\nAlternator construction, emf equation, and voltage regulation.", source: "native" },
    ];

    const chapters = detectChapters(pages);
    expect(chapters.length).toBe(3);
    expect(chapters[0].title).toContain("AC Fundamentals");
    expect(chapters[0].pageStart).toBe(5);
    expect(chapters[1].title).toContain("Synchronous Motors");
    expect(chapters[1].pageStart).toBe(25);
    expect(chapters[2].title).toContain("Synchronous Generators");
    expect(chapters[2].pageStart).toBe(55);
  });

  it("chunks documents and enables BM25 search with chapter filtering", () => {
    const pages: DocumentPage[] = [
      {
        page: 1,
        text: "Chapter 1: AC Fundamentals. In an AC circuit, the voltage and current vary sinusoidally with time. The root-mean-square value is calculated by dividing the peak value by the square root of two.",
        source: "native",
      },
      {
        page: 2,
        text: "Chapter 2: Synchronous Motors. Synchronous motors operate at constant synchronous speed regardless of the load, up to pull-out torque. The rotor is excited by direct current.",
        source: "native",
      },
    ];

    const chapters = [
      { id: "ch-1", title: "Chapter 1: AC Fundamentals", pageStart: 1, pageEnd: 1, chunkCount: 0 },
      { id: "ch-2", title: "Chapter 2: Synchronous Motors", pageStart: 2, pageEnd: 2, chunkCount: 0 },
    ];

    const chunks = createDocumentChunks({
      documentId: "doc-1",
      documentName: "machines.pdf",
      documentType: "textbook",
      pages,
      chapters,
    });

    expect(chunks.length).toBe(2);
    expect(chunks[0].chapterId).toBe("ch-1");
    expect(chunks[1].chapterId).toBe("ch-2");

    const index = new SearchIndex(chunks);
    const searchAll = index.search("synchronous motor speed");
    expect(searchAll.length).toBeGreaterThan(0);
    expect(searchAll[0].chunk.chapterId).toBe("ch-2");

    // Search with chapter filter
    const searchFiltered = index.search("voltage current", { chapterIds: ["ch-1"] });
    expect(searchFiltered.length).toBe(1);
    expect(searchFiltered[0].chunk.chapterId).toBe("ch-1");
  });
});
