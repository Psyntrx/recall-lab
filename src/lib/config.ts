export const config = {
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024), // 50 MB
  maxPdfPages: Number(process.env.MAX_PDF_PAGES ?? 1000), // Scalable textbook support
  maxOcrPages: Number(process.env.MAX_OCR_PAGES ?? 100),
  maxTextCharacters: Number(process.env.MAX_TEXT_CHARACTERS ?? 2_000_000), // Scalable character limit
  extractionTimeoutMs: Number(process.env.EXTRACTION_TIMEOUT_MS ?? 120_000),
  ocrPageTimeoutMs: Number(process.env.OCR_PAGE_TIMEOUT_MS ?? 60_000),
  ocrJobTimeoutMs: Number(process.env.OCR_JOB_TIMEOUT_MS ?? 900_000),
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
  quizTtlMs: Number(process.env.QUIZ_TTL_MINUTES ?? 120) * 60_000,
  ocrLanguage: process.env.OCR_LANGUAGE ?? "eng",
  aiProvider: process.env.AI_PROVIDER ?? "groq",
  groqApiKey: process.env.GROQ_API_KEY,
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  groqFallbackModel: process.env.GROQ_FALLBACK_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};

export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 30;
