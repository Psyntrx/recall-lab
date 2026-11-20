import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const workerSource = path.join(
  rootDir,
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.worker.mjs"
);
const publicDir = path.join(rootDir, "public");
const workerDest = path.join(publicDir, "pdf.worker.mjs");

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

if (fs.existsSync(workerSource)) {
  fs.copyFileSync(workerSource, workerDest);
  console.log(`Copied ${workerSource} to ${workerDest}`);
} else {
  console.error(`Could not find PDF.js worker at ${workerSource}`);
  process.exit(1);
}
