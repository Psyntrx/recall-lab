import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { meaningfulWords } from "./validation";
import type { DocumentPage, NormalizedDocument, ProcessingProgress } from "./types";

export type ProgressCallback = (progress: ProcessingProgress) => void;

export function normalizePages(filename: string, pages: DocumentPage[]): NormalizedDocument {
  let text = pages
    .map((p) => `[Page ${p.page}]\n${p.text}`)
    .join("\n\n")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const truncated = text.length > config.maxTextCharacters;
  if (truncated) text = text.slice(0, config.maxTextCharacters);
  return {
    filename,
    pages,
    text,
    wordCount: meaningfulWords(text),
    truncated,
  };
}

export async function extractTxt(file: File): Promise<NormalizedDocument> {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  if (/\x00/.test(text)) {
    throw new AppError("The text file appears to be binary rather than readable text.", 422, "INVALID_TEXT");
  }
  return normalizePages(file.name, [{ page: 1, text, source: "native" }]);
}
