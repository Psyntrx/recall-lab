import { createWorker } from "tesseract.js";
import { config } from "@/lib/config";
import { AppError } from "@/lib/http/errors";
import { withTimeout } from "./timeout";
import type { DocumentPage, ProcessingProgress } from "./types";

export type ProgressCallback = (progress: ProcessingProgress) => void;

/**
 * Performs client-side OCR on pages with sparse or missing selectable text
 * using browser-native HTML5 Canvas and Tesseract.js Web Worker.
 */
export async function ocrSparsePagesInBrowser(
  pdf: any,
  pages: DocumentPage[],
  progress: ProgressCallback,
  signal?: AbortSignal
): Promise<DocumentPage[]> {
  const targets = pages.filter((p) => p.text.trim().length < 50);
  if (!targets.length) return pages;

  if (targets.length > config.maxOcrPages) {
    throw new AppError("Too many pages require OCR.", 413, "TOO_MANY_OCR_PAGES");
  }

  // Check if we are running in a browser with canvas support
  if (typeof document === "undefined" || !document.createElement) {
    return pages;
  }

  const started = Date.now();
  const worker = await createWorker(config.ocrLanguage);

  try {
    for (let index = 0; index < targets.length; index++) {
      if (signal?.aborted) throw new AppError("OCR was cancelled.", 499, "CANCELLED");
      if (Date.now() - started > config.ocrJobTimeoutMs) {
        throw new AppError("OCR exceeded its total time limit. Try fewer or clearer pages.", 504, "OCR_TIMEOUT");
      }

      const target = targets[index];
      progress({
        stage: "ocr",
        current: index + 1,
        total: targets.length,
        message: `Recognising scanned page ${target.page} (${index + 1}/${targets.length})`,
      });

      try {
        const pdfPage = await pdf.getPage(target.page);
        const viewport = pdfPage.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) throw new Error("Could not acquire 2D canvas context");

        await pdfPage.render({ canvasContext, viewport }).promise;

        const result = await withTimeout(
          worker.recognize(canvas),
          config.ocrPageTimeoutMs,
          `OCR timed out on page ${target.page}.`
        );

        target.text = result.data.text;
        target.source = "ocr";
      } catch {
        target.ocrFailed = true;
      }

      // Yield execution so the browser UI thread can render updates smoothly
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return pages;
  } finally {
    await worker.terminate();
  }
}
