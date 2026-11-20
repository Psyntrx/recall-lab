import type { DocumentType, NormalizedDocument } from "./types";

export function classifyDocument(filename: string, text: string): DocumentType {
  const name = filename.toLowerCase();
  const sample = text.slice(0, 10_000).toLowerCase();

  // Past examination paper indicators
  const pastPaperSignals = [
    "examination",
    "exam paper",
    "past paper",
    "final examination",
    "semester examination",
    "university examination",
    "time allowed:",
    "instructions to candidates",
    "answer any four",
    "answer question one",
    "total marks",
    "paper code",
  ];

  // Continuous Assessment Test (CAT) / Assignment indicators
  const catSignals = [
    "continuous assessment",
    "cat 1",
    "cat 2",
    "cat i",
    "cat ii",
    "assignment 1",
    "assignment 2",
    "mid-term",
    "midterm",
    "term test",
    "class test",
  ];

  // Check filename first for strong explicit classification
  if (name.includes("cat") || name.includes("assignment") || name.includes("midterm") || name.includes("test")) {
    return "cat";
  }
  if (name.includes("past-paper") || name.includes("past_paper") || name.includes("pastpaper") || name.includes("exam") || name.includes("examination")) {
    return "past_paper";
  }
  if (name.includes("lecture") || name.includes("slides") || name.includes("notes") || name.includes("week")) {
    return "lecture_notes";
  }

  // Check content signals
  const catMatchCount = catSignals.filter((signal) => sample.includes(signal)).length;
  if (catMatchCount >= 1) return "cat";

  const pastPaperMatchCount = pastPaperSignals.filter((signal) => sample.includes(signal)).length;
  if (pastPaperMatchCount >= 2) return "past_paper";

  // Textbook indicators
  const textbookSignals = [
    "table of contents",
    "contents",
    "preface",
    "chapter 1",
    "chapter one",
    "isbn",
    "edition",
    "all rights reserved",
    "index",
  ];
  const textbookMatchCount = textbookSignals.filter((signal) => sample.includes(signal)).length;
  if (textbookMatchCount >= 2 || text.length > 50_000) {
    return "textbook";
  }

  if (sample.includes("slide") || sample.includes("lecture")) {
    return "lecture_notes";
  }

  return "reference";
}
