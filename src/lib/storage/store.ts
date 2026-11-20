import fs from "fs";
import path from "path";
import os from "os";
import type { ProcessingProgress, NormalizedDocument, ChapterInfo, ExtractedAssessmentQuestion, AssessmentCoverageMap } from "@/lib/document/types";
import type { Question, RevisionPlan } from "@/lib/quiz/schemas";

export type DurableJob = {
  id: string;
  progress: ProcessingProgress;
  quizId?: string;
  error?: { message: string; code: string };
  createdAt: number;
  updatedAt: number;
  detectedChapters?: ChapterInfo[];
  coverageMap?: AssessmentCoverageMap;
  extractedQuestionsCount?: number;
};

export type DurableQuiz = {
  id: string;
  questions: Question[];
  document: NormalizedDocument;
  answers: Record<string, string>;
  createdAt: number;
  recommendations?: RevisionPlan;
};

// Storage directory resolution
function getStorageDir(): string {
  if (process.env.STORAGE_DIR) {
    return process.env.STORAGE_DIR;
  }
  // Try local .data folder, fallback to OS tmpdir if read-only
  const localDir = path.join(process.cwd(), ".data");
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    return localDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), "recall-lab-data");
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    return tmpDir;
  }
}

class DurableStorage {
  private baseDir: string;
  private jobsCache: Map<string, DurableJob> = new Map();
  private quizzesCache: Map<string, DurableQuiz> = new Map();

  constructor() {
    this.baseDir = getStorageDir();
    this.ensureDirs();
  }

  private ensureDirs() {
    try {
      fs.mkdirSync(path.join(this.baseDir, "jobs"), { recursive: true });
      fs.mkdirSync(path.join(this.baseDir, "quizzes"), { recursive: true });
    } catch {
      // directory creation handled
    }
  }

  // JOBS
  public saveJob(job: DurableJob): void {
    job.updatedAt = Date.now();
    this.jobsCache.set(job.id, job);
    try {
      const filePath = path.join(this.baseDir, "jobs", `${job.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(job, null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not write job to disk, kept in memory cache:", err);
    }
  }

  public getJob(id: string): DurableJob | null {
    if (this.jobsCache.has(id)) {
      return this.jobsCache.get(id)!;
    }
    try {
      const filePath = path.join(this.baseDir, "jobs", `${id}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const job = JSON.parse(raw) as DurableJob;
        this.jobsCache.set(job.id, job);
        return job;
      }
    } catch {
      // Return null on read/parse error
    }
    return null;
  }

  // QUIZZES
  public saveQuiz(quiz: DurableQuiz): void {
    this.quizzesCache.set(quiz.id, quiz);
    try {
      const filePath = path.join(this.baseDir, "quizzes", `${quiz.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(quiz, null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not write quiz to disk, kept in memory cache:", err);
    }
  }

  public getQuiz(id: string): DurableQuiz | null {
    if (this.quizzesCache.has(id)) {
      return this.quizzesCache.get(id)!;
    }
    try {
      const filePath = path.join(this.baseDir, "quizzes", `${id}.json`);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const quiz = JSON.parse(raw) as DurableQuiz;
        this.quizzesCache.set(quiz.id, quiz);
        return quiz;
      }
    } catch {
      // Return null on read/parse error
    }
    return null;
  }

  public deleteQuiz(id: string): void {
    this.quizzesCache.delete(id);
    try {
      const filePath = path.join(this.baseDir, "quizzes", `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore deletion failure
    }
  }
}

export const storage = new DurableStorage();
