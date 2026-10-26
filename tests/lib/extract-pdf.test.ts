import { describe, expect, it } from "vitest";
import { extractPdf } from "@/lib/document/extract";

function textPdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([new TextEncoder().encode(pdf)], "notes.pdf", { type: "application/pdf" });
}

describe("PDF extraction", () => {
  it("extracts selectable text from a valid server-side PDF", async () => {
    const result = await extractPdf(textPdf("Lecture material supports this question"), () => {});
    expect(result.document.pages).toHaveLength(1);
    expect(result.document.text).toContain("Lecture material supports this question");
    await result.pdf.destroy();
  }, 15_000);
});
