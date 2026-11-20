import type { DocumentPage, NormalizedDocument, ProcessingProgress } from "./types";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { withTimeout } from "./timeout";
import { normalizePages, extractTxt } from "./extract";
import { ocrSparsePagesInBrowser } from "./browser-ocr";

export type ProgressCallback = (progress: ProcessingProgress) => void;

let workerInitialized = false;

/**
 * Dynamically loads PDF.js and configures its worker path.
 * In browser environments, points directly to `/pdf.worker.mjs` served statically from public/.
 * In Node.js / test environments, resolves the installed worker module.
 */
export async function getPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerInitialized) {
    if (typeof window !== "undefined") {
      // In browser: load from static public path
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    } else {
      // In Node.js / Vitest test runner
      try {
        if (typeof import.meta.resolve === "function") {
          pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve(
            "pdfjs-dist/legacy/build/pdf.worker.mjs"
          );
        }
      } catch {
        // Fallback
      }
    }
    workerInitialized = true;
  }
  return pdfjs;
}

/**
 * Extracts text page-by-page from a PDF in the browser without uploading binary files to any server.
 * Interleaves micro-yields so the browser interface stays responsive and progress bars animate smoothly.
 */
export async function extractPdfInBrowser(
  file: File,
  progress: ProgressCallback,
  signal?: AbortSignal
): Promise<{ document: NormalizedDocument; pdf: any }> {
  return withTimeout(
    (async () => {
      const pdfjs = await getPdfJs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const loading = pdfjs.getDocument({
        data: bytes,
        useWorkerFetch: false,
        disableAutoFetch: true,
        disableStream: true,
      });
      const pdf = await loading.promise;

      if (pdf.numPages > config.maxPdfPages) {
        throw new AppError(
          `This PDF has ${pdf.numPages} pages; the configured limit is ${config.maxPdfPages}.`,
          413,
          "TOO_MANY_PAGES"
        );
      }

      const pages: DocumentPage[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        if (signal?.aborted) throw new AppError("Processing was cancelled.", 499, "CANCELLED");

        progress({
          stage: "extracting",
          current: i,
          total: pdf.numPages,
          message: `Reading page ${i} of ${pdf.numPages}`,
        });

        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/[ \t]+/g, " ")
          .trim();
        pages.push({ page: i, text: pageText, source: "native" });

        // Yield to browser event loop to keep UI animations responsive
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Perform client-side OCR on sparse pages if in browser
      let finalPages = pages;
      if (typeof window !== "undefined") {
        finalPages = await ocrSparsePagesInBrowser(pdf, pages, progress, signal);
      }

      return {
        document: normalizePages(file.name, finalPages),
        pdf,
      };
    })(),
    config.extractionTimeoutMs,
    "PDF text extraction timed out. Try a smaller document or verify file integrity."
  );
}

// Export aliases
export const extractPdf = extractPdfInBrowser;
export { extractTxt, normalizePages };
