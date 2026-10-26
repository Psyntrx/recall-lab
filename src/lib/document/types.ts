export type DocumentPage = { page: number; text: string; source: "native" | "ocr"; ocrFailed?: boolean };
export type NormalizedDocument = { filename: string; pages: DocumentPage[]; text: string; wordCount: number; truncated: boolean };
export type ProcessingProgress = { stage: "validating" | "extracting" | "ocr" | "generating" | "complete" | "failed" | "cancelled"; current?: number; total?: number; message: string };
