"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { copyText } from "@/lib/clipboard";
import { validateQuiz, type AnswerKey, type QuizFile } from "@/lib/quiz/import";
import {
  formatLocalTimestamp,
  createStudySession,
  createStudySessionUrl,
  decodeStudySession,
  localSessionDefinitionKey,
  MAX_SESSION_FILE_BYTES,
  parseStudySession,
  serializeStudySession,
  type StudySession,
} from "@/lib/quiz/session";
import { parseSessionProgress, restoreProgressAttempts, sessionProgressKey, type SessionProgress } from "@/lib/quiz/progress";
import { makeStudyReport } from "@/lib/quiz/report";
import { makeQuestionPrompt } from "@/lib/quiz/prompt";
import { InvalidSessionLanding, SessionLanding } from "./session-landing";
import { classifyDocument } from "@/lib/document/classification";
import { processDocumentsInBrowser } from "@/lib/document/browser-pipeline";
import type { DocumentType } from "@/lib/document/types";

type Attempt = { selected: AnswerKey; correct: boolean };

type UploadedFileItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  detectedType: DocumentType;
};

const exampleQuiz: QuizFile = {
  title: "Sample: Active recall",
  questions: [
    {
      id: "q1",
      question: "What is the main purpose of active recall?",
      options: {
        A: "To retrieve information from memory",
        B: "To reread the same page several times",
        C: "To highlight every sentence",
        D: "To avoid testing yourself",
      },
      correct_answer: "A",
      topic_reference: "Study methods",
      explanation:
        "Active recall strengthens learning by making you retrieve information from memory instead of only reviewing it passively.",
      source_reference: null,
    },
  ],
};

function prettyError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function download(name: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "study-quiz";
}

export default function Home() {
  // Manual JSON / Prompt States (Retained for secondary import)
  const [jsonText, setJsonText] = useState("");
  const [quiz, setQuiz] = useState<QuizFile | null>(null);
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<AnswerKey | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [focus, setFocus] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [copyError, setCopyError] = useState("");
  const [manualCopy, setManualCopy] = useState(false);

  // In-App AI Generation & Multi-Document State
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileItem[]>([]);
  const [difficulty, setDifficulty] = useState<"mixed" | "easy" | "medium" | "hard">("mixed");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStage, setGenerationStage] = useState<string>("");
  const [generationMessage, setGenerationMessage] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Shared Session State
  const [sharedSession, setSharedSession] = useState<StudySession | null>(null);
  const [activeSession, setActiveSession] = useState<StudySession | null>(null);
  const [sessionLink, setSessionLink] = useState("");
  const [sessionLinkError, setSessionLinkError] = useState("");
  const [sessionFileError, setSessionFileError] = useState("");
  const [sessionCopyState, setSessionCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [sessionCopyError, setSessionCopyError] = useState("");
  const [reportCopyState, setReportCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [reportCopyError, setReportCopyError] = useState("");
  const [attemptCompletedAt, setAttemptCompletedAt] = useState<string | null>(null);
  const [attemptCompletedLocal, setAttemptCompletedLocal] = useState<string | null>(null);
  const [progressWarning, setProgressWarning] = useState("");
  const copiedTimer = useRef<number | NodeJS.Timeout | null>(null);
  const copyLock = useRef(false);

  const complete = Boolean(quiz && quiz.questions.every((q) => attempts[q.id]));
  const score = useMemo(
    () => (quiz ? quiz.questions.reduce((total, q) => total + (attempts[q.id]?.correct ? 1 : 0), 0) : 0),
    [quiz, attempts]
  );
  const topicStats = useMemo(() => {
    if (!quiz) return [];
    const groups = new Map<string, { total: number; missed: number }>();
    quiz.questions.forEach((q) => {
      const group = groups.get(q.topic_reference) ?? { total: 0, missed: 0 };
      group.total += 1;
      if (attempts[q.id] && !attempts[q.id].correct) group.missed += 1;
      groups.set(q.topic_reference, group);
    });
    return [...groups.entries()]
      .map(([topic, stats]) => ({ topic, ...stats }))
      .sort((a, b) => b.missed - a.missed || b.total - a.total);
  }, [quiz, attempts]);

  const report = useMemo(
    () =>
      quiz && complete
        ? makeStudyReport({
            quiz,
            attempts,
            score,
            topics: topicStats,
            session: activeSession,
            completedAt: attemptCompletedAt,
            completedLocal: attemptCompletedLocal,
          })
        : "",
    [quiz, complete, attempts, score, topicStats, activeSession, attemptCompletedAt, attemptCompletedLocal]
  );
  const answerSheet = useMemo(() => (quiz ? makeAnswerSheet(quiz) : ""), [quiz]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const localId = url.searchParams.get("localSession");
    if (localId !== null) {
      try {
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(localId)) throw new Error("The local session reference is invalid.");
        const serialized = window.localStorage.getItem(localSessionDefinitionKey(localId));
        if (!serialized)
          throw new Error(
            "This large session was saved only in the original browser. Re-open the session JSON file on this device."
          );
        const session = parseStudySession(serialized);
        if (session.session_id !== localId) throw new Error("The saved session ID does not match this link.");
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSharedSession(session);
        try {
          setSessionLink(createStudySessionUrl(session, `${url.origin}${url.pathname}`));
        } catch (cause) {
          setSessionLink("");
          setSessionLinkError(prettyError(cause));
        }
        return;
      } catch (cause) {
        setSessionLinkError(prettyError(cause));
        return;
      }
    }
    if (!url.searchParams.has("session")) return;
    try {
      const session = decodeStudySession(url.searchParams.get("session") ?? "");
      setSharedSession(session);
      setSessionLink(url.href);
      setSessionLinkError("");
      setSessionFileError("");
    } catch (cause) {
      setSessionLinkError(prettyError(cause));
    }
  }, []);

  useEffect(() => {
    if (!activeSession || !quiz) return;
    const answers = Object.fromEntries(
      Object.entries(attempts).map(([id, attempt]) => [id, attempt.selected])
    );
    const progress = {
      version: 1,
      session_id: activeSession.session_id,
      answers,
      current_index: index,
      completed_at: attemptCompletedAt,
      completed_local: attemptCompletedLocal,
    };
    try {
      window.localStorage.setItem(sessionProgressKey(activeSession.session_id), JSON.stringify(progress));
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressWarning("This browser could not save local progress. Keep this tab open to finish your attempt.");
    }
  }, [activeSession, quiz, attempts, index, attemptCompletedAt, attemptCompletedLocal]);

  // Handle file additions
  function handleFiles(files: FileList | File[]) {
    const nextList: UploadedFileItem[] = [...uploadedFiles];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".pdf") && !lower.endsWith(".txt")) {
        setError(`"${file.name}" is not supported. Please upload PDF or TXT files.`);
        continue;
      }
      const detectedType = classifyDocument(file.name, "");
      nextList.push({
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file,
        name: file.name,
        size: file.size,
        detectedType,
      });
    }
    setUploadedFiles(nextList);
    setError("");
  }

  function removeFile(id: string) {
    setUploadedFiles(uploadedFiles.filter((f) => f.id !== id));
  }

  // Generate Questions via In-App AI
  async function triggerAiGeneration() {
    if (uploadedFiles.length === 0) {
      setError("Please upload at least one study document (textbook, past paper, or notes).");
      return;
    }
    setError("");
    setNotice("");
    setIsGenerating(true);
    setGenerationStage("validating");
    setGenerationMessage("Analyzing learning materials in browser...");

    try {
      // Step 1: Process documents locally in browser memory
      const processed = await processDocumentsInBrowser(
        uploadedFiles.map((item) => item.file),
        {
          questionCount,
          focus: focus.trim() || undefined,
          difficulty: difficulty !== "mixed" ? difficulty : undefined,
        },
        (p) => {
          setGenerationStage(p.stage);
          setGenerationMessage(p.message);
        }
      );

      // Step 2: Send structured text excerpts, chunks, and metadata to API for AI generation
      setGenerationStage("generating");
      setGenerationMessage(
        `Generating ${questionCount} grounded questions with AI...`
      );

      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document: processed.masterDoc,
          options: {
            questionCount,
            focus: focus.trim() || undefined,
            difficulty: difficulty !== "mixed" ? difficulty : undefined,
          },
          assessmentContext: processed.assessmentContext,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to generate quiz.");
      }

      const resData = await res.json();

      if (resData.quiz) {
        const constructedQuiz: QuizFile = {
          title: resData.quiz.title || `Quiz (${uploadedFiles[0]?.name || "Recall Lab"})`,
          questions: resData.quiz.questions,
        };
        setQuiz(constructedQuiz);
        setActiveSession(null);
        setAttempts({});
        setIndex(0);
        setChoice(null);
        setRevealed(false);
        setAttemptCompletedAt(null);
        setAttemptCompletedLocal(null);
        setIsGenerating(false);
        setNotice(
          `Generated ${constructedQuiz.questions.length} questions grounded in your learning materials.`
        );
      } else if (resData.jobId) {
        // Poll job progress if asynchronous
        const pollInterval = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/quiz?jobId=${resData.jobId}`);
            if (!pollRes.ok) return;
            const jobData = await pollRes.json();

            if (jobData.progress) {
              setGenerationStage(jobData.progress.stage);
              setGenerationMessage(jobData.progress.message || "Generating questions...");
            }

            if (jobData.progress?.stage === "complete" && jobData.quizId) {
              clearInterval(pollInterval);
              const quizRes = await fetch(`/api/quiz/${jobData.quizId}`);
              if (!quizRes.ok) throw new Error("Could not load the generated quiz.");
              const quizData = await quizRes.json();

              const constructedQuiz: QuizFile = {
                title: `Quiz (${uploadedFiles[0]?.name || "Recall Lab"})`,
                questions: quizData.questions,
              };
              setQuiz(constructedQuiz);
              setActiveSession(null);
              setAttempts({});
              setIndex(0);
              setChoice(null);
              setRevealed(false);
              setAttemptCompletedAt(null);
              setAttemptCompletedLocal(null);
              setIsGenerating(false);
              setNotice(
                `Generated ${constructedQuiz.questions.length} questions grounded in your learning materials.`
              );
            } else if (jobData.progress?.stage === "failed" || jobData.error) {
              clearInterval(pollInterval);
              setIsGenerating(false);
              setError(jobData.error?.message || "Generation failed. Please retry.");
            }
          } catch (pollErr) {
            clearInterval(pollInterval);
            setIsGenerating(false);
            setError(prettyError(pollErr));
          }
        }, 1500);
      }
    } catch (err) {
      setIsGenerating(false);
      setError(prettyError(err));
    }
  }

  function showSharedSession(session: StudySession) {
    setSharedSession(session);
    setSessionLinkError("");
    setSessionFileError("");
    setSessionCopyState("idle");
    setSessionCopyError("");
    try {
      const link = createStudySessionUrl(session, `${window.location.origin}${window.location.pathname}`);
      setSessionLink(link);
      window.history.replaceState(null, "", link);
      setSessionLinkError("");
    } catch (cause) {
      setSessionLink("");
      setSessionLinkError(prettyError(cause));
      try {
        window.localStorage.setItem(localSessionDefinitionKey(session.session_id), serializeStudySession(session));
        const localUrl = new URL(window.location.href);
        localUrl.searchParams.delete("session");
        localUrl.searchParams.set("localSession", session.session_id);
        window.history.replaceState(null, "", localUrl.href);
      } catch (cacheError) {
        setSessionFileError(
          `${prettyError(cacheError)} Refresh recovery for this oversized session requires reopening its JSON file.`
        );
      }
    }
  }

  function createSessionFromJson(raw: string) {
    try {
      const validatedQuiz = validateQuiz(JSON.parse(raw));
      showSharedSession(createStudySession(validatedQuiz));
      setError("");
      setNotice("");
    } catch (cause) {
      setError(prettyError(cause));
      setNotice("");
    }
  }

  function onSessionFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_SESSION_FILE_BYTES) {
      setSessionFileError("The session JSON exceeds the 10 MB import limit.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        showSharedSession(parseStudySession(String(reader.result ?? "")));
      } catch (cause) {
        setSessionFileError(prettyError(cause));
      }
    };
    reader.onerror = () => setSessionFileError("The session JSON file could not be read.");
    reader.readAsText(file);
  }

  function downloadSharedSession() {
    if (!sharedSession) return;
    try {
      download(
        `${slug(sharedSession.title)}-study-session.json`,
        serializeStudySession(sharedSession),
        "application/json;charset=utf-8"
      );
    } catch (cause) {
      setSessionFileError(prettyError(cause));
    }
  }

  async function copySessionLink() {
    if (!sessionLink) return;
    setSessionCopyState("idle");
    setSessionCopyError("");
    try {
      await copyText(sessionLink);
      setSessionCopyState("copied");
    } catch (cause) {
      setSessionCopyState("error");
      setSessionCopyError(`Could not copy the share link: ${prettyError(cause)}`);
    }
  }

  function startStudySession(session: StudySession) {
    let saved: SessionProgress | null = null;
    let storageUnavailable = false;
    try {
      saved = parseSessionProgress(window.localStorage.getItem(sessionProgressKey(session.session_id)), session);
    } catch {
      storageUnavailable = true;
    }
    const restored = restoreProgressAttempts(saved, session.quiz);
    const currentQuestion = session.quiz.questions[saved?.current_index ?? 0];
    setActiveSession(session);
    setQuiz(session.quiz);
    setAttempts(restored);
    setIndex(saved?.current_index ?? 0);
    setChoice(saved?.answers[currentQuestion.id] ?? null);
    setRevealed(Boolean(saved?.answers[currentQuestion.id]));
    setAttemptCompletedAt(saved?.completed_at ?? null);
    setAttemptCompletedLocal(saved?.completed_local ?? null);
    setError("");
    setProgressWarning(
      storageUnavailable ? "Local storage is unavailable. Your progress will last only while this tab remains open." : ""
    );
  }

  function restartStudySession() {
    if (!activeSession) return;
    try {
      window.localStorage.removeItem(sessionProgressKey(activeSession.session_id));
      setProgressWarning("");
    } catch {
      setProgressWarning("Local storage could not clear the previous attempt; the restarted quiz remains available in this tab.");
    }
    setQuiz(activeSession.quiz);
    setAttempts({});
    setIndex(0);
    setChoice(null);
    setRevealed(false);
    setAttemptCompletedAt(null);
    setAttemptCompletedLocal(null);
  }

  async function copyStudyReport() {
    if (!report) return;
    setReportCopyState("idle");
    setReportCopyError("");
    try {
      await copyText(report);
      setReportCopyState("copied");
    } catch (cause) {
      setReportCopyState("error");
      setReportCopyError(`Could not copy the study report: ${prettyError(cause)}`);
    }
  }

  function returnToImport() {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.delete("localSession");
    window.history.replaceState(null, "", url.href);
    setSharedSession(null);
    setActiveSession(null);
    if (!quiz) setAttempts({});
    setSessionLinkError("");
    setSessionFileError("");
  }

  function loadJson(raw: string) {
    try {
      const parsed = validateQuiz(JSON.parse(raw));
      setQuiz(parsed);
      setActiveSession(null);
      setAttempts({});
      setIndex(0);
      setChoice(null);
      setRevealed(false);
      setAttemptCompletedAt(null);
      setAttemptCompletedLocal(null);
      setError("");
      setNotice(
        `Loaded ${parsed.questions.length} questions. Your answers stay in this browser tab until you close or restart the session.`
      );
    } catch (e) {
      setQuiz(null);
      setError(prettyError(e));
      setNotice("");
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      setError("Choose a .json quiz file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      setJsonText(raw);
      loadJson(raw);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  }

  function submitAnswer() {
    if (!quiz || !choice || revealed) return;
    const question = quiz.questions[index];
    const nextAttempts = { ...attempts, [question.id]: { selected: choice, correct: choice === question.correct_answer } };
    setAttempts(nextAttempts);
    setRevealed(true);
    if (quiz.questions.every((item) => nextAttempts[item.id])) {
      const completed = new Date();
      setAttemptCompletedAt(completed.toISOString());
      setAttemptCompletedLocal(formatLocalTimestamp(completed));
    }
  }

  function advance() {
    if (!quiz) return;
    if (index + 1 < quiz.questions.length) {
      setIndex(index + 1);
      setChoice(null);
      setRevealed(false);
    }
  }

  async function copy(text: string, label: string) {
    if (!text.trim() || copyLock.current) return;
    copyLock.current = true;
    const isPrompt = label === "AI prompt";
    if (isPrompt) {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      setCopyState("copying");
      setCopyError("");
      setManualCopy(false);
    }
    try {
      await copyText(text);
      setNotice(`${label} copied to clipboard.`);
      if (isPrompt) {
        setCopyState("copied");
        copiedTimer.current = window.setTimeout(() => {
          setCopyState("idle");
          copiedTimer.current = null;
        }, 1800);
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : "The browser did not provide more detail.";
      if (isPrompt) {
        setCopyState("error");
        setCopyError(`Could not copy: ${reason} Select the prompt below and copy it manually.`);
        setManualCopy(true);
      }
    } finally {
      copyLock.current = false;
    }
  }

  if (sharedSession && !activeSession) {
    return (
      <SessionLanding
        session={sharedSession}
        shareLink={sessionLink}
        shareError={sessionLinkError}
        importError={sessionFileError}
        copyState={sessionCopyState}
        copyError={sessionCopyError}
        returnLabel={quiz ? "Return to current quiz" : "Return to quiz import"}
        onStart={() => startStudySession(sharedSession)}
        onCopyLink={copySessionLink}
        onDownload={downloadSharedSession}
        onImportFile={onSessionFile}
        onHome={returnToImport}
      />
    );
  }

  if (sessionLinkError && !sharedSession) {
    return (
      <InvalidSessionLanding
        message={sessionLinkError}
        importError={sessionFileError}
        onImportFile={onSessionFile}
        onHome={returnToImport}
      />
    );
  }

  if (quiz && complete) {
    return (
      <Results
        quiz={quiz}
        attempts={attempts}
        score={score}
        topicStats={topicStats}
        report={report}
        answerSheet={answerSheet}
        session={activeSession}
        completedAt={attemptCompletedAt}
        completedLocal={attemptCompletedLocal}
        reportCopyState={reportCopyState}
        reportCopyError={reportCopyError}
        onCopyReport={copyStudyReport}
        onRestart={activeSession ? restartStudySession : undefined}
        onNew={() => {
          if (activeSession) {
            setQuiz(null);
            setActiveSession(null);
            setAttempts({});
          } else {
            setQuiz(null);
            setSharedSession(null);
            setAttempts({});
            setJsonText("");
            setNotice("");
            setError("");
          }
        }}
      />
    );
  }

  if (quiz) {
    const q = quiz.questions[index];
    const response = attempts[q.id];
    return (
      <main className="app-shell">
        <Topbar />
        <section className="quiz-wrap">
          <div className="quiz-heading">
            <span className="eyebrow">{activeSession?.title ?? quiz.title}</span>
            <span className="count">
              Question {index + 1} <span>of {quiz.questions.length}</span>
            </span>
          </div>
          {activeSession && (
            <p className="session-progress-note">Session {activeSession.session_id} · your answers are saved in this browser only.</p>
          )}
          {progressWarning && (
            <p className="inline-notice" role="status">
              {progressWarning}
            </p>
          )}
          <div className="progress-track">
            <span style={{ width: `${((index + (response ? 1 : 0)) / quiz.questions.length) * 100}%` }} />
          </div>
          <div className="quiz-card">
            <div className="question-meta">
              {q.question_source && (
                <span className={`source-badge source-${q.question_source}`}>
                  {q.question_source === "extracted" ? "Past Paper" : q.question_source === "adapted" ? "Adapted Exam" : "AI Generated"}
                </span>
              )}
              {q.chapter && <span>{q.chapter}</span>}
              <span>{q.topic_reference}</span>
              {q.source_reference && <span>{q.source_reference}</span>}
            </div>
            <h1>{q.question}</h1>
            <div className="answer-list">
              {(["A", "B", "C", "D"] as AnswerKey[]).map((key) => (
                <button
                  key={key}
                  className={`answer-option ${choice === key ? "chosen" : ""} ${revealed && key === q.correct_answer ? "right-option" : ""} ${
                    revealed && choice === key && !response?.correct ? "wrong-option" : ""
                  }`}
                  onClick={() => !revealed && setChoice(key)}
                  disabled={revealed}
                >
                  <span className="answer-letter">{key}</span>
                  <span>{q.options[key]}</span>
                  {revealed && key === q.correct_answer && <span className="option-mark">Correct</span>}
                </button>
              ))}
            </div>
            {revealed && (
              <div className={`explanation ${response?.correct ? "explanation-good" : "explanation-review"}`}>
                <strong>{response?.correct ? "That’s right" : `The correct answer is ${q.correct_answer}`}</strong>
                <p>{q.explanation}</p>
              </div>
            )}
            <div className="quiz-actions">
              <span className="quiet-label">{Object.keys(attempts).length} answered</span>
              {!revealed ? (
                <button className="button-primary" disabled={!choice} onClick={submitAnswer}>
                  Check answer <span>→</span>
                </button>
              ) : (
                <button className="button-primary" onClick={advance}>
                  {index + 1 === quiz.questions.length ? "See your results" : "Next question"} <span>→</span>
                </button>
              )}
            </div>
          </div>
          {!activeSession && (
            <button className="button-secondary" onClick={() => showSharedSession(createStudySession(quiz))}>
              Share quiz
            </button>
          )}
          <button
            className="text-button"
            onClick={() => {
              setQuiz(null);
              setAttempts({});
              if (activeSession) setActiveSession(null);
              else setNotice("Your session has been cleared.");
            }}
          >
            End session
          </button>
        </section>
      </main>
    );
  }

  const aiPrompt = makeQuestionPrompt(questionCount, focus);

  return (
    <main className="app-shell">
      <Topbar />

      <section className="intro">
        <div className="intro-copy">
          <span className="eyebrow">A better way to revise</span>
          <h1>
            Make your study material
            <br />
            <em>ask you back.</em>
          </h1>
          <p>
            Upload your textbooks, lecture notes, and past examination papers. Recall Lab analyzes the material,
            cross-references exam patterns, and generates an interactive study quiz directly inside the app.
          </p>
        </div>
        <div className="intro-art" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <span className="art-card art-card-back">A / B / C / D</span>
          <span className="art-card art-card-front">
            <i>✳</i>
            <b>
              Recall
              <br />
              beats rereading.
            </b>
            <small>01 / study note</small>
          </span>
          <span className="art-dot" />
        </div>
      </section>

      <section className="workflow">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Three small steps</span>
            <h2>From notes to knowing</h2>
          </div>
          <span className="step-note">No external prompts needed. Everything runs in Recall Lab.</span>
        </div>
        <div className="steps">
          <article className="step">
            <span className="step-number">01</span>
            <h3>Upload your materials</h3>
            <p>Add your textbook, lecture notes, past papers, or CATs. The system supports multi-document sessions.</p>
          </article>
          <article className="step">
            <span className="step-number">02</span>
            <h3>Configure & Generate</h3>
            <p>Select your question count, optional chapter focus, and difficulty. Groq AI indexes and creates your quiz.</p>
          </article>
          <article className="step">
            <span className="step-number">03</span>
            <h3>Practice & Review</h3>
            <p>Test your active recall with immediate explanations, scoring, and a targeted chapter revision report.</p>
          </article>
        </div>
      </section>

      {/* Main In-App AI Question Generation Workspace */}
      <section className="workspace">
        <div className="workspace-main">
          <div className="section-heading">
            <div>
              <span className="eyebrow">AI Study Studio</span>
              <h2>Generate Practice Questions</h2>
            </div>
            <span className="file-label">Direct AI Generation</span>
          </div>

          <div className="import-panel">
            {/* Multi-Document Upload Dropzone */}
            <div
              className={`upload-zone ${dragActive ? "drag-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.length) {
                  handleFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.txt,application/pdf,text/plain"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleFiles(e.target.files);
                  }
                }}
              />
              <div className="upload-zone-inner">
                <span className="upload-icon">📄</span>
                <span className="upload-title">Drop your study documents here, or click to browse</span>
                <span className="upload-hint">
                  Upload textbooks, lecture notes, past papers, or CATs (PDF & TXT supported up to 50 MB)
                </span>
              </div>
            </div>

            {/* Uploaded Documents List */}
            {uploadedFiles.length > 0 && (
              <div className="uploaded-files-list">
                {uploadedFiles.map((item) => (
                  <div key={item.id} className="file-item">
                    <div className="file-info">
                      <span className={`doc-badge badge-${item.detectedType}`}>
                        {item.detectedType === "past_paper"
                          ? "Past Paper"
                          : item.detectedType === "cat"
                          ? "CAT / Assignment"
                          : item.detectedType === "textbook"
                          ? "Textbook"
                          : item.detectedType === "lecture_notes"
                          ? "Notes"
                          : "Reference"}
                      </span>
                      <span className="file-name" title={item.name}>
                        {item.name}
                      </span>
                      <span className="file-size">({formatBytes(item.size)})</span>
                    </div>
                    <button
                      type="button"
                      className="file-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(item.id);
                      }}
                      title="Remove file"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Quiz Configuration Controls */}
            <div className="quiz-config-grid">
              <div className="config-group">
                <label className="field-label" htmlFor="question-count">
                  Number of questions
                </label>
                <select
                  id="question-count"
                  disabled={isGenerating}
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                >
                  <option value={5}>5 questions</option>
                  <option value={10}>10 questions</option>
                  <option value={15}>15 questions</option>
                  <option value={20}>20 questions</option>
                  <option value={30}>30 questions</option>
                </select>
              </div>

              <div className="config-group">
                <label className="field-label" htmlFor="difficulty-select">
                  Difficulty level
                </label>
                <select
                  id="difficulty-select"
                  disabled={isGenerating}
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as any)}
                >
                  <option value="mixed">Mixed (Balanced)</option>
                  <option value="easy">Foundational (Easy)</option>
                  <option value="medium">Standard (Medium)</option>
                  <option value="hard">Advanced (Hard)</option>
                </select>
              </div>

              <div className="config-group" style={{ gridColumn: "1 / -1" }}>
                <label className="field-label" htmlFor="study-focus">
                  Optional topic or chapter focus
                </label>
                <input
                  id="study-focus"
                  disabled={isGenerating}
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="e.g. Chapters 2–3, AC Fundamentals, or Phasors"
                />
              </div>
            </div>

            {/* Generation Progress Indicator */}
            {isGenerating && (
              <div className="generation-banner" role="status">
                <span className="pulse-spinner" />
                <div className="generation-status-text">
                  <strong>Generating your interactive quiz...</strong>
                  <p>{generationMessage || "Analyzing uploaded material..."}</p>
                </div>
              </div>
            )}

            {/* Primary Action Button */}
            <div className="import-actions" style={{ marginTop: "20px" }}>
              <button
                type="button"
                className="button-primary"
                onClick={triggerAiGeneration}
                disabled={isGenerating || uploadedFiles.length === 0}
              >
                {isGenerating ? "Analyzing & Generating…" : "Generate Questions"} <span>→</span>
              </button>
            </div>

            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="inline-notice" role="status">
                {notice}
              </p>
            )}
          </div>

          {/* Secondary Unobtrusive JSON Import (Requirement 9) */}
          <div className="secondary-import-wrapper">
            <details className="secondary-import-details">
              <summary>Already have a quiz file? Import JSON ▾</summary>
              <div className="secondary-import-content">
                <div className="import-panel" style={{ marginTop: "12px" }}>
                  <label className="field-label" htmlFor="quiz-json">
                    Paste the AI’s JSON here
                  </label>
                  <textarea
                    id="quiz-json"
                    spellCheck={false}
                    placeholder={'{\n  "title": "Biology: Cell structure",\n  "questions": [...]\n}'}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                  />
                  <div className="import-actions">
                    <label className="button-secondary file-picker">
                      Choose a .json file
                      <input type="file" accept=".json,application/json" onChange={onFile} />
                    </label>
                    <label className="button-secondary file-picker">
                      Open session JSON
                      <input type="file" accept=".json,application/json" onChange={onSessionFile} />
                    </label>
                    <button
                      className="button-primary"
                      onClick={() => loadJson(jsonText)}
                      disabled={!jsonText.trim()}
                    >
                      Start quiz <span>→</span>
                    </button>
                    <button
                      className="button-secondary"
                      onClick={() => createSessionFromJson(jsonText)}
                      disabled={!jsonText.trim()}
                    >
                      Create shareable session
                    </button>
                    <button
                      className="text-button inline"
                      onClick={() => {
                        const raw = JSON.stringify(exampleQuiz, null, 2);
                        setJsonText(raw);
                        loadJson(raw);
                      }}
                    >
                      Try an example
                    </button>
                  </div>
                  {sessionFileError && (
                    <p className="inline-error" role="alert">
                      {sessionFileError}
                    </p>
                  )}
                </div>

                <details className="format-details">
                  <summary>View the required JSON format</summary>
                  <pre>{JSON.stringify(exampleQuiz, null, 2)}</pre>
                </details>
              </div>
            </details>
          </div>
        </div>

        {/* Sidebar Prompt Panel (Retained for external prompt copy option) */}
        <aside className="prompt-panel">
          <div className="prompt-title">
            <span className="prompt-icon">✳</span>
            <div>
              <span className="eyebrow">External AI prompt</span>
              <h2>Prompt Helper</h2>
            </div>
          </div>
          <p>
            Prefer generating externally in ChatGPT or Claude? Copy this optimized prompt, paste it with your study files,
            then import the resulting JSON below.
          </p>

          <button
            className={`button-dark full-button ${copyState === "copied" ? "copy-success" : ""} ${
              copyState === "error" ? "copy-failure" : ""
            }`}
            aria-live="polite"
            disabled={copyState === "copying"}
            onClick={() => copy(aiPrompt, "AI prompt")}
          >
            {copyState === "copying"
              ? "Copying…"
              : copyState === "copied"
              ? "Copied!"
              : copyState === "error"
              ? "Copy failed"
              : "Copy prompt"}
            <span>{copyState === "copied" ? "✓" : "↗"}</span>
          </button>

          {copyError && (
            <p className="inline-error" role="alert">
              {copyError}
            </p>
          )}
          {manualCopy && (
            <textarea
              className="manual-copy-field"
              aria-label="Select and copy the prompt"
              readOnly
              value={aiPrompt}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
            />
          )}

          <p className="privacy-note">
            When using Recall Lab&apos;s direct generation, your files are analyzed server-side with Groq AI and stay private to your session.
          </p>
        </aside>
      </section>

      <footer className="app-footer">
        <span>
          Recall Lab <i>·</i> study with intention
        </span>
        <span>Your session lives in this tab and is cleared when you leave.</span>
      </footer>
    </main>
  );
}

function Topbar() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark">r</span>
        <span>
          recall<span className="brand-light">lab</span>
        </span>
      </Link>
      <span className="topbar-note">
        <span className="status-dot" />
        Your private study space
      </span>
    </header>
  );
}

function makeAnswerSheet(quiz: QuizFile) {
  return `# ${quiz.title} — Questions and answers\n\n${quiz.questions
    .map(
      (q, i) =>
        `## ${i + 1}. ${q.question}\n\n- **A.** ${q.options.A}\n- **B.** ${q.options.B}\n- **C.** ${q.options.C}\n- **D.** ${
          q.options.D
        }\n- **Correct answer:** ${q.correct_answer}. ${q.options[q.correct_answer]}\n- **Topic:** ${q.topic_reference}${
          q.chapter ? `\n- **Chapter:** ${q.chapter}` : ""
        }${q.source_reference ? `\n- **Source:** ${q.source_reference}` : ""}\n- **Explanation:** ${q.explanation}`
    )
    .join("\n\n")}\n`;
}

function Results({
  quiz,
  attempts,
  score,
  topicStats,
  report,
  answerSheet,
  session,
  completedAt,
  completedLocal,
  reportCopyState,
  reportCopyError,
  onNew,
  onCopyReport,
  onRestart,
}: {
  quiz: QuizFile;
  attempts: Record<string, Attempt>;
  score: number;
  topicStats: { topic: string; total: number; missed: number }[];
  report: string;
  answerSheet: string;
  session: StudySession | null;
  completedAt: string | null;
  completedLocal: string | null;
  reportCopyState: "idle" | "copied" | "error";
  reportCopyError: string;
  onNew: () => void;
  onCopyReport: () => void;
  onRestart?: () => void;
}) {
  const percentage = Math.round((score / quiz.questions.length) * 100);
  return (
    <main className="app-shell">
      <Topbar />
      <section className="results-page">
        <div className="results-header">
          <span className="eyebrow">Session complete · {quiz.title}</span>
          <div className="score-row">
            <div>
              <h1>
                {percentage}
                <sup>%</sup>
              </h1>
              <p>
                {score} of {quiz.questions.length} answers correct
              </p>
            </div>
            <div className="score-ring" style={{ "--score": `${percentage}%` } as React.CSSProperties}>
              <span>
                {score}
                <small>/{quiz.questions.length}</small>
              </span>
            </div>
          </div>
          {session && (
            <p className="report-hint">
              Created {session.created_local} · Attempt completed {completedLocal ?? completedAt ?? "time unavailable"}
            </p>
          )}
          <div className="result-actions">
            <button className="button-primary" onClick={onCopyReport}>
              {reportCopyState === "copied"
                ? "Report copied!"
                : reportCopyState === "error"
                ? "Copy failed"
                : "Copy study report"}{" "}
              <span>↗</span>
            </button>
            <button
              className="button-secondary"
              onClick={() => download(`${slug(quiz.title)}-study-report.txt`, report)}
            >
              Download study report
            </button>
            <button
              className="button-secondary"
              onClick={() => download(`${slug(quiz.title)}-answers.md`, answerSheet, "text/markdown;charset=utf-8")}
            >
              Download questions & answers
            </button>
            {onRestart && (
              <button className="button-secondary" onClick={onRestart}>
                Restart quiz
              </button>
            )}
          </div>
          {reportCopyError && (
            <p className="inline-error" role="alert">
              {reportCopyError}
            </p>
          )}
        </div>

        <section className="focus-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Your review map</span>
              <h2>Where to focus next</h2>
            </div>
          </div>
          <div className="topic-list">
            {topicStats.map((topic) => (
              <article className="topic-row" key={topic.topic}>
                <div className="topic-name">
                  <span className={`topic-indicator ${topic.missed ? "needs-work" : "mastered"}`} />
                  <div>
                    <strong>{topic.topic}</strong>
                    <small>
                      {topic.missed
                        ? `${topic.missed} to revisit · ${topic.total} question${topic.total === 1 ? "" : "s"}`
                        : `All ${topic.total} correct`}
                    </small>
                  </div>
                </div>
                <div className="topic-meter">
                  <span
                    style={{
                      width: `${topic.total ? ((topic.total - topic.missed) / topic.total) * 100 : 100}%`,
                    }}
                  />
                </div>
              </article>
            ))}
          </div>
          <p className="report-hint">
            The report includes each response and explanation. Send it to your AI for a tailored chapter-by-chapter study plan.
          </p>
        </section>

        <section className="review-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Look back</span>
              <h2>Questions and explanations</h2>
            </div>
          </div>
          <div className="review-list">
            {quiz.questions.map((q, i) => {
              const attempt = attempts[q.id];
              return (
                <article className="review-item" key={q.id}>
                  <div className="review-number">{String(i + 1).padStart(2, "0")}</div>
                  <div className="review-content">
                    <div className="question-meta">
                      {q.question_source && (
                        <span className={`source-badge source-${q.question_source}`}>
                          {q.question_source === "extracted" ? "Past Paper" : q.question_source === "adapted" ? "Adapted Exam" : "AI Generated"}
                        </span>
                      )}
                      {q.chapter && <span>{q.chapter}</span>}
                      <span>{q.topic_reference}</span>
                      {q.source_reference && <span>{q.source_reference}</span>}
                    </div>
                    <h3>{q.question}</h3>
                    <p className={attempt.correct ? "review-answer right-text" : "review-answer wrong-text"}>
                      Your answer: {attempt.selected}. {q.options[attempt.selected]} ·{" "}
                      {attempt.correct ? "Correct" : `Correct answer: ${q.correct_answer}. ${q.options[q.correct_answer]}`}
                    </p>
                    <p className="review-explanation">{q.explanation}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <div className="end-actions">
          <button className="text-button" onClick={onNew}>
            ← {session ? "Back to study session" : "Start a new session"}
          </button>
          <span>
            {session ? "Your attempt is private to this browser." : "This session isn’t saved. Download anything you want to keep."}
          </span>
        </div>
      </section>
    </main>
  );
}
