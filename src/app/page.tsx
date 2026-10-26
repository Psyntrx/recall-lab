"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { copyText } from "@/lib/clipboard";
import { validateQuiz, type AnswerKey, type QuizFile } from "@/lib/quiz/import";
import { formatLocalTimestamp, createStudySession, createStudySessionUrl, decodeStudySession, localSessionDefinitionKey, MAX_SESSION_FILE_BYTES, parseStudySession, serializeStudySession, type StudySession } from "@/lib/quiz/session";
import { parseSessionProgress, restoreProgressAttempts, sessionProgressKey, type SessionProgress } from "@/lib/quiz/progress";
import { makeStudyReport } from "@/lib/quiz/report";
import { makeQuestionPrompt } from "@/lib/quiz/prompt";
import { InvalidSessionLanding, SessionLanding } from "./session-landing";

type Attempt = { selected: AnswerKey; correct: boolean };

const exampleQuiz: QuizFile = {
  title: "Sample: Active recall",
  questions: [{
    id: "q1",
    question: "What is the main purpose of active recall?",
    options: { A: "To retrieve information from memory", B: "To reread the same page several times", C: "To highlight every sentence", D: "To avoid testing yourself" },
    correct_answer: "A",
    topic_reference: "Study methods",
    explanation: "Active recall strengthens learning by making you retrieve information from memory instead of only reviewing it passively.",
    source_reference: null,
  }],
};

function prettyError(error: unknown) { return error instanceof Error ? error.message : "Something went wrong."; }
function download(name: string, content: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "study-quiz"; }

export default function Home() {
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
  const score = useMemo(() => quiz ? quiz.questions.reduce((total, q) => total + (attempts[q.id]?.correct ? 1 : 0), 0) : 0, [quiz, attempts]);
  const topicStats = useMemo(() => {
    if (!quiz) return [];
    const groups = new Map<string, { total: number; missed: number }>();
    quiz.questions.forEach((q) => {
      const group = groups.get(q.topic_reference) ?? { total: 0, missed: 0 };
      group.total += 1;
      if (attempts[q.id] && !attempts[q.id].correct) group.missed += 1;
      groups.set(q.topic_reference, group);
    });
    return [...groups.entries()].map(([topic, stats]) => ({ topic, ...stats })).sort((a, b) => b.missed - a.missed || b.total - a.total);
  }, [quiz, attempts]);
  const report = useMemo(() => quiz && complete ? makeStudyReport({ quiz, attempts, score, topics: topicStats, session: activeSession, completedAt: attemptCompletedAt, completedLocal: attemptCompletedLocal }) : "", [quiz, complete, attempts, score, topicStats, activeSession, attemptCompletedAt, attemptCompletedLocal]);
  const answerSheet = useMemo(() => quiz ? makeAnswerSheet(quiz) : "", [quiz]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const localId = url.searchParams.get("localSession");
    if (localId !== null) {
      try {
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(localId)) throw new Error("The local session reference is invalid.");
        const serialized = window.localStorage.getItem(localSessionDefinitionKey(localId));
        if (!serialized) throw new Error("This large session was saved only in the original browser. Re-open the session JSON file on this device.");
        const session = parseStudySession(serialized);
        if (session.session_id !== localId) throw new Error("The saved session ID does not match this link.");
        // URL state is read once on mount to hydrate a directly opened shared session.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSharedSession(session);
        try { setSessionLink(createStudySessionUrl(session, `${url.origin}${url.pathname}`)); }
        catch (cause) { setSessionLink(""); setSessionLinkError(prettyError(cause)); }
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
    const answers = Object.fromEntries(Object.entries(attempts).map(([id, attempt]) => [id, attempt.selected]));
    const progress = { version: 1, session_id: activeSession.session_id, answers, current_index: index, completed_at: attemptCompletedAt, completed_local: attemptCompletedLocal };
    try {
      window.localStorage.setItem(sessionProgressKey(activeSession.session_id), JSON.stringify(progress));
    } catch {
      // Report the storage failure to the user from this synchronization effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressWarning("This browser could not save local progress. Keep this tab open to finish your attempt.");
    }
  }, [activeSession, quiz, attempts, index, attemptCompletedAt, attemptCompletedLocal]);

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
        setSessionFileError(`${prettyError(cacheError)} Refresh recovery for this oversized session requires reopening its JSON file.`);
      }
    }
  }

  function createSessionFromJson(raw: string) {
    try {
      const quiz = validateQuiz(JSON.parse(raw));
      showSharedSession(createStudySession(quiz));
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
    if (file.size > MAX_SESSION_FILE_BYTES) { setSessionFileError("The session JSON exceeds the 10 MB import limit."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { showSharedSession(parseStudySession(String(reader.result ?? ""))); }
      catch (cause) { setSessionFileError(prettyError(cause)); }
    };
    reader.onerror = () => setSessionFileError("The session JSON file could not be read.");
    reader.readAsText(file);
  }

  function downloadSharedSession() {
    if (!sharedSession) return;
    try { download(`${slug(sharedSession.title)}-study-session.json`, serializeStudySession(sharedSession), "application/json;charset=utf-8"); }
    catch (cause) { setSessionFileError(prettyError(cause)); }
  }

  async function copySessionLink() {
    if (!sessionLink) return;
    setSessionCopyState("idle");
    setSessionCopyError("");
    try { await copyText(sessionLink); setSessionCopyState("copied"); }
    catch (cause) { setSessionCopyState("error"); setSessionCopyError(`Could not copy the share link: ${prettyError(cause)}`); }
  }

  function startStudySession(session: StudySession) {
    let saved: SessionProgress | null = null;
    let storageUnavailable = false;
    try { saved = parseSessionProgress(window.localStorage.getItem(sessionProgressKey(session.session_id)), session); }
    catch { storageUnavailable = true; }
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
    setProgressWarning(storageUnavailable ? "Local storage is unavailable. Your progress will last only while this tab remains open." : "");
  }

  function restartStudySession() {
    if (!activeSession) return;
    try { window.localStorage.removeItem(sessionProgressKey(activeSession.session_id)); setProgressWarning(""); }
    catch { setProgressWarning("Local storage could not clear the previous attempt; the restarted quiz remains available in this tab."); }
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
    try { await copyText(report); setReportCopyState("copied"); }
    catch (cause) { setReportCopyState("error"); setReportCopyError(`Could not copy the study report: ${prettyError(cause)}`); }
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
    try { const parsed = validateQuiz(JSON.parse(raw)); setQuiz(parsed); setActiveSession(null); setAttempts({}); setIndex(0); setChoice(null); setRevealed(false); setAttemptCompletedAt(null); setAttemptCompletedLocal(null); setError(""); setNotice(`Loaded ${parsed.questions.length} questions. Your answers stay in this browser tab until you close or restart the session.`); }
    catch (e) { setQuiz(null); setError(prettyError(e)); setNotice(""); }
  }
  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".json")) { setError("Choose a .json quiz file."); return; }
    const reader = new FileReader(); reader.onload = () => { const raw = String(reader.result ?? ""); setJsonText(raw); loadJson(raw); }; reader.onerror = () => setError("Could not read that file."); reader.readAsText(file);
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
    if (index + 1 < quiz.questions.length) { setIndex(index + 1); setChoice(null); setRevealed(false); }
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
        copiedTimer.current = window.setTimeout(() => { setCopyState("idle"); copiedTimer.current = null; }, 1800);
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

  if (sharedSession && !activeSession) return <SessionLanding session={sharedSession} shareLink={sessionLink} shareError={sessionLinkError} importError={sessionFileError} copyState={sessionCopyState} copyError={sessionCopyError} returnLabel={quiz ? "Return to current quiz" : "Return to quiz import"} onStart={() => startStudySession(sharedSession)} onCopyLink={copySessionLink} onDownload={downloadSharedSession} onImportFile={onSessionFile} onHome={returnToImport} />;
  if (sessionLinkError && !sharedSession) return <InvalidSessionLanding message={sessionLinkError} importError={sessionFileError} onImportFile={onSessionFile} onHome={returnToImport} />;
  if (quiz && complete) return <Results quiz={quiz} attempts={attempts} score={score} topicStats={topicStats} report={report} answerSheet={answerSheet} session={activeSession} completedAt={attemptCompletedAt} completedLocal={attemptCompletedLocal} reportCopyState={reportCopyState} reportCopyError={reportCopyError} onCopyReport={copyStudyReport} onRestart={activeSession ? restartStudySession : undefined} onNew={() => { if (activeSession) { setQuiz(null); setActiveSession(null); setAttempts({}); } else { setQuiz(null); setSharedSession(null); setAttempts({}); setJsonText(""); setNotice(""); setError(""); } }} />;
  if (quiz) {
    const q = quiz.questions[index]; const response = attempts[q.id];
    return <main className="app-shell"><Topbar /><section className="quiz-wrap"><div className="quiz-heading"><span className="eyebrow">{activeSession?.title ?? quiz.title}</span><span className="count">Question {index + 1} <span>of {quiz.questions.length}</span></span></div>{activeSession && <p className="session-progress-note">Session {activeSession.session_id} · your answers are saved in this browser only.</p>}{progressWarning && <p className="inline-notice" role="status">{progressWarning}</p>}<div className="progress-track"><span style={{ width: `${((index + (response ? 1 : 0)) / quiz.questions.length) * 100}%` }} /></div><div className="quiz-card"><div className="question-meta"><span>{q.topic_reference}</span>{q.source_reference && <span>{q.source_reference}</span>}</div><h1>{q.question}</h1><div className="answer-list">{(["A", "B", "C", "D"] as AnswerKey[]).map((key) => <button key={key} className={`answer-option ${choice === key ? "chosen" : ""} ${revealed && key === q.correct_answer ? "right-option" : ""} ${revealed && choice === key && !response?.correct ? "wrong-option" : ""}`} onClick={() => !revealed && setChoice(key)} disabled={revealed}><span className="answer-letter">{key}</span><span>{q.options[key]}</span>{revealed && key === q.correct_answer && <span className="option-mark">Correct</span>}</button>)}</div>{revealed && <div className={`explanation ${response?.correct ? "explanation-good" : "explanation-review"}`}><strong>{response?.correct ? "That’s right" : `The correct answer is ${q.correct_answer}`}</strong><p>{q.explanation}</p></div>}<div className="quiz-actions"><span className="quiet-label">{Object.keys(attempts).length} answered</span>{!revealed ? <button className="button-primary" disabled={!choice} onClick={submitAnswer}>Check answer <span>→</span></button> : <button className="button-primary" onClick={advance}>{index + 1 === quiz.questions.length ? "See your results" : "Next question"} <span>→</span></button>}</div></div>{!activeSession && <button className="button-secondary" onClick={() => showSharedSession(createStudySession(quiz))}>Share quiz</button>}<button className="text-button" onClick={() => { setQuiz(null); setAttempts({}); if (activeSession) setActiveSession(null); else setNotice("Your session has been cleared."); }}>End session</button></section></main>;
  }

  const aiPrompt = makeQuestionPrompt(questionCount, focus);
  return <main className="app-shell"><Topbar /><section className="intro"><div className="intro-copy"><span className="eyebrow">A better way to revise</span><h1>Make your study material<br /><em>ask you back.</em></h1><p>Bring your notes to an AI, turn its questions into a quiz, and find out what deserves another look.</p></div><div className="intro-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="art-card art-card-back">A / B / C / D</span><span className="art-card art-card-front"><i>✳</i><b>Recall<br />beats rereading.</b><small>01 / study note</small></span><span className="art-dot" /></div></section>
    <section className="workflow"><div className="section-heading"><div><span className="eyebrow">Three small steps</span><h2>From notes to knowing</h2></div><span className="step-note">No account. Shared attempts stay on this device.</span></div><div className="steps"><article className="step"><span className="step-number">01</span><h3>Ask your AI</h3><p>Attach your files to your preferred AI and use the ready-made prompt to request a quiz in the format this app accepts.</p></article><article className="step"><span className="step-number">02</span><h3>Play it through</h3><p>Import the JSON. Choose between four answers, check your understanding, and read the explanation after each response.</p></article><article className="step"><span className="step-number">03</span><h3>Take the next step</h3><p>Get a focused study report to send back to AI, plus a document of every question and answer to keep.</p></article></div></section>
    <section className="workspace"><div className="workspace-main"><div className="section-heading"><div><span className="eyebrow">Start a study session</span><h2>Bring in a quiz</h2></div><span className="file-label">JSON format</span></div><div className="import-panel"><label className="field-label" htmlFor="quiz-json">Paste the AI’s JSON here</label><textarea id="quiz-json" spellCheck={false} placeholder={'{\n  "title": "Biology: Cell structure",\n  "questions": [...]\n}'} value={jsonText} onChange={(e) => setJsonText(e.target.value)} /><div className="import-actions"><label className="button-secondary file-picker">Choose a .json file<input type="file" accept=".json,application/json" onChange={onFile} /></label><label className="button-secondary file-picker">Open session JSON<input type="file" accept=".json,application/json" onChange={onSessionFile} /></label><button className="button-primary" onClick={() => loadJson(jsonText)} disabled={!jsonText.trim()}>Start quiz <span>→</span></button><button className="button-secondary" onClick={() => createSessionFromJson(jsonText)} disabled={!jsonText.trim()}>Create shareable session</button><button className="text-button inline" onClick={() => { const raw = JSON.stringify(exampleQuiz, null, 2); setJsonText(raw); loadJson(raw); }}>Try an example</button></div>{error && <p className="inline-error" role="alert">{error}</p>}{sessionFileError && <p className="inline-error" role="alert">{sessionFileError}</p>}{notice && <p className="inline-notice" role="status">{notice}</p>}</div><details className="format-details"><summary>View the required JSON format</summary><pre>{JSON.stringify(exampleQuiz, null, 2)}</pre></details></div>
    <aside className="prompt-panel"><div className="prompt-title"><span className="prompt-icon">✳</span><div><span className="eyebrow">Your AI companion</span><h2>Get the prompt</h2></div></div><p>Copy a ready-to-use request. Add your study files in your AI chat, then paste its JSON response into the quiz.</p><label className="field-label" htmlFor="question-count">Number of questions</label><select id="question-count" disabled={copyState === "copying"} value={questionCount} onChange={(e) => { setQuestionCount(Number(e.target.value)); setCopyState("idle"); setCopyError(""); }}><option value={5}>5 questions</option><option value={10}>10 questions</option><option value={15}>15 questions</option><option value={20}>20 questions</option><option value={30}>30 questions</option></select><label className="field-label" htmlFor="study-focus">Optional topic or chapter focus</label><input id="study-focus" disabled={copyState === "copying"} value={focus} onChange={(e) => { setFocus(e.target.value); setCopyState("idle"); setCopyError(""); }} placeholder="e.g. Chapters 3–5" /><button className={`button-dark full-button ${copyState === "copied" ? "copy-success" : ""} ${copyState === "error" ? "copy-failure" : ""}`} aria-live="polite" disabled={copyState === "copying"} onClick={() => copy(aiPrompt, "AI prompt")}>{copyState === "copying" ? "Copying…" : copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy prompt"}<span>{copyState === "copied" ? "✓" : "↗"}</span></button>{copyError && <p className="inline-error" role="alert">{copyError}</p>}{manualCopy && <textarea className="manual-copy-field" aria-label="Select and copy the prompt" readOnly value={aiPrompt} onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()} />}<p className="privacy-note">Files are handled by the AI service you choose. This app only receives the quiz JSON you import.</p></aside></section><footer className="app-footer"><span>Recall Lab <i>·</i> study with intention</span><span>Your session lives in this tab and is cleared when you leave.</span></footer></main>;
}

function Topbar() { return <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">r</span><span>recall<span className="brand-light">lab</span></span></Link><span className="topbar-note"><span className="status-dot" />Your private study space</span></header>; }

function makeAnswerSheet(quiz: QuizFile) {
  return `# ${quiz.title} — Questions and answers\n\n${quiz.questions.map((q, i) => `## ${i + 1}. ${q.question}\n\n- **A.** ${q.options.A}\n- **B.** ${q.options.B}\n- **C.** ${q.options.C}\n- **D.** ${q.options.D}\n- **Correct answer:** ${q.correct_answer}. ${q.options[q.correct_answer]}\n- **Topic:** ${q.topic_reference}${q.source_reference ? `\n- **Source:** ${q.source_reference}` : ""}\n- **Explanation:** ${q.explanation}`).join("\n\n")}\n`;
}

function Results({ quiz, attempts, score, topicStats, report, answerSheet, session, completedAt, completedLocal, reportCopyState, reportCopyError, onNew, onCopyReport, onRestart }: { quiz: QuizFile; attempts: Record<string, Attempt>; score: number; topicStats: { topic: string; total: number; missed: number }[]; report: string; answerSheet: string; session: StudySession | null; completedAt: string | null; completedLocal: string | null; reportCopyState: "idle" | "copied" | "error"; reportCopyError: string; onNew: () => void; onCopyReport: () => void; onRestart?: () => void }) {
  const percentage = Math.round(score / quiz.questions.length * 100);
  return <main className="app-shell"><Topbar /><section className="results-page"><div className="results-header"><span className="eyebrow">Session complete · {quiz.title}</span><div className="score-row"><div><h1>{percentage}<sup>%</sup></h1><p>{score} of {quiz.questions.length} answers correct</p></div><div className="score-ring" style={{ "--score": `${percentage}%` } as React.CSSProperties}><span>{score}<small>/{quiz.questions.length}</small></span></div></div>{session && <p className="report-hint">Created {session.created_local} · Attempt completed {completedLocal ?? completedAt ?? "time unavailable"}</p>}<div className="result-actions"><button className="button-primary" onClick={onCopyReport}>{reportCopyState === "copied" ? "Report copied!" : reportCopyState === "error" ? "Copy failed" : "Copy study report"} <span>↗</span></button><button className="button-secondary" onClick={() => download(`${slug(quiz.title)}-study-report.txt`, report)}>Download study report</button><button className="button-secondary" onClick={() => download(`${slug(quiz.title)}-answers.md`, answerSheet, "text/markdown;charset=utf-8")}>Download questions & answers</button>{onRestart && <button className="button-secondary" onClick={onRestart}>Restart quiz</button>}</div>{reportCopyError && <p className="inline-error" role="alert">{reportCopyError}</p>}</div><section className="focus-section"><div className="section-heading"><div><span className="eyebrow">Your review map</span><h2>Where to focus next</h2></div></div><div className="topic-list">{topicStats.map((topic) => <article className="topic-row" key={topic.topic}><div className="topic-name"><span className={`topic-indicator ${topic.missed ? "needs-work" : "mastered"}`} /><div><strong>{topic.topic}</strong><small>{topic.missed ? `${topic.missed} to revisit · ${topic.total} question${topic.total === 1 ? "" : "s"}` : `All ${topic.total} correct`}</small></div></div><div className="topic-meter"><span style={{ width: `${topic.total ? (topic.total - topic.missed) / topic.total * 100 : 100}%` }} /></div></article>)}</div><p className="report-hint">The report includes each response and explanation. Send it to your AI for a tailored chapter-by-chapter study plan.</p></section><section className="review-section"><div className="section-heading"><div><span className="eyebrow">Look back</span><h2>Questions and explanations</h2></div></div><div className="review-list">{quiz.questions.map((q, i) => { const attempt = attempts[q.id]; return <article className="review-item" key={q.id}><div className="review-number">{String(i + 1).padStart(2, "0")}</div><div className="review-content"><div className="question-meta"><span>{q.topic_reference}</span>{q.source_reference && <span>{q.source_reference}</span>}</div><h3>{q.question}</h3><p className={attempt.correct ? "review-answer right-text" : "review-answer wrong-text"}>Your answer: {attempt.selected}. {q.options[attempt.selected]} · {attempt.correct ? "Correct" : `Correct answer: ${q.correct_answer}. ${q.options[q.correct_answer]}`}</p><p className="review-explanation">{q.explanation}</p></div></article>; })}</div></section><div className="end-actions"><button className="text-button" onClick={onNew}>← {session ? "Back to study session" : "Start a new session"}</button><span>{session ? "Your attempt is private to this browser." : "This session isn’t saved. Download anything you want to keep."}</span></div></section></main>;
}
