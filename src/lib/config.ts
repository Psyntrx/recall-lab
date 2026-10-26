export const config = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024), maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 40), maxOcrPages: Number(process.env.MAX_OCR_PAGES ?? 40), maxTextCharacters: Number(process.env.MAX_TEXT_CHARACTERS ?? 45_000), extractionTimeoutMs: Number(process.env.EXTRACTION_TIMEOUT_MS ?? 45_000), ocrPageTimeoutMs: Number(process.env.OCR_PAGE_TIMEOUT_MS ?? 60_000), ocrJobTimeoutMs: Number(process.env.OCR_JOB_TIMEOUT_MS ?? 900_000), aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60_000), quizTtlMs: Number(process.env.QUIZ_TTL_MINUTES ?? 60) * 60_000, ocrLanguage: process.env.OCR_LANGUAGE ?? "eng", model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};
export const MIN_QUESTIONS = 5; export const MAX_QUESTIONS = 30;
