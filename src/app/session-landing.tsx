"use client";

import type { ChangeEvent } from "react";
import type { StudySession } from "@/lib/quiz/session";

type SessionLandingProps = {
  session: StudySession;
  shareLink: string;
  shareError: string;
  importError: string;
  copyState: "idle" | "copied" | "error";
  copyError: string;
  returnLabel: string;
  onStart: () => void;
  onCopyLink: () => void;
  onDownload: () => void;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onHome: () => void;
};

export function SessionLanding({ session, shareLink, shareError, importError, copyState, copyError, returnLabel, onStart, onCopyLink, onDownload, onImportFile, onHome }: SessionLandingProps) {
  return <main className="app-shell"><SessionTopbar /><section className="session-page"><div className="session-card">
    <span className="eyebrow">Recall Lab · Shared study session</span>
    <h1>{session.title}</h1>
    <p className="session-intro">Check the session details, then start your own independent attempt.</p>
    <dl className="session-metadata">
      <div><dt>Subject or course</dt><dd>{session.subject ?? "Not specified"}</dd></div>
      <div><dt>Topics covered</dt><dd>{session.topics.length ? session.topics.join(", ") : "Not specified"}</dd></div>
      <div><dt>Questions</dt><dd>{session.question_count}</dd></div>
      <div><dt>Session created</dt><dd>{session.created_local} <small>({session.created_at})</small></dd></div>
      <div className="session-id"><dt>Session ID</dt><dd><code>{session.session_id}</code></dd></div>
    </dl>
    <button className="button-primary session-start" onClick={onStart}>Start quiz <span>→</span></button>
    <div className="session-share-actions">
      <button className="button-secondary" onClick={onCopyLink} disabled={!shareLink}>{copyState === "copied" ? "Link copied!" : copyState === "error" ? "Copy failed" : "Copy share link"}</button>
      <button className="button-secondary" onClick={onDownload}>Download session JSON</button>
      <label className="button-secondary file-picker">Open session JSON<input type="file" accept=".json,application/json" onChange={onImportFile} /></label>
    </div>
    {shareError && <p className="inline-error" role="alert">{shareError} Download the session JSON and share that file instead.</p>}
    {importError && <p className="inline-error" role="alert">{importError}</p>}
    {copyError && <p className="inline-error" role="alert">{copyError}</p>}
    {copyState === "copied" && <p className="inline-notice" role="status">The complete session link is ready to paste.</p>}
    <p className="session-privacy">The link and JSON file contain the quiz, including correct answers and explanations; recipients can inspect them. Original source documents and your attempt are not included. Your progress is saved only in this browser. Clearing browser data or switching devices can remove it.</p>
    <button className="text-button" onClick={onHome}>{returnLabel}</button>
  </div></section></main>;
}

export function InvalidSessionLanding({ message, importError, onImportFile, onHome }: { message: string; importError: string; onImportFile: (event: ChangeEvent<HTMLInputElement>) => void; onHome: () => void }) {
  return <main className="app-shell"><SessionTopbar /><section className="session-page"><div className="session-card">
    <span className="eyebrow">Recall Lab · Shared study session</span>
    <h1>Could not open this session</h1>
    <p className="inline-error" role="alert">{message}</p>
    {importError && <p className="inline-error" role="alert">{importError}</p>}
    <p className="session-intro">The link or file may be incomplete, too large, or from an unsupported session format.</p>
    <div className="session-share-actions"><label className="button-secondary file-picker">Open session JSON<input type="file" accept=".json,application/json" onChange={onImportFile} /></label><button className="button-primary" onClick={onHome}>Return to quiz import</button></div>
    <p className="session-privacy">Shared files and links are not encrypted or signed. Only open sessions from people you trust.</p>
  </div></section></main>;
}

function SessionTopbar() {
  return <header className="topbar"><span className="brand"><span className="brand-mark">r</span><span>recall<span className="brand-light">lab</span></span></span><span className="topbar-note"><span className="status-dot" />Recall Lab</span></header>;
}
