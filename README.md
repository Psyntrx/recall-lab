# Recall Lab

Recall Lab is an integrated AI-powered study quiz platform. Upload your learning materials (textbooks, lecture notes, past examination papers, and CATs) directly into Recall Lab. The system analyzes textbook chapters, cross-references historical examination questions and recurring assessment patterns, and generates an interactive study quiz grounded in your material.

Every question features four distinct choices (A–D), one correct answer, and comprehensive explanations for both the correct answer and incorrect alternatives. At the end of a quiz, Recall Lab maps your mastery by chapter and topic, producing an actionable revision report with targeted study actions.

---

## Features

- **Direct In-App AI Generation:** No need to copy prompts to external chatbots and paste JSON back. Everything happens inside Recall Lab.
- **Primary AI Provider — Groq:** High-throughput inference with `openai/gpt-oss-20b` (and `llama-3.3-70b-versatile` fallback), plus configurable support for OpenAI (`gpt-4o-mini`).
- **Scalable Document Processing:** Removes restrictive page limits to handle multi-hundred page textbooks and multiple files in a single session.
- **Intelligent Chapter Detection:** Detects chapters via table of contents and headings, allowing students to focus quizzes on specific chapters or the entire textbook.
- **Past-Paper & CAT Intelligence:** Automatically classifies assessment papers, extracts exam questions, matches them to textbook topics, detects repeated questions, and constructs an assessment coverage map.
- **Grounded Question Generation:** Generates questions testing conceptual understanding, application, and calculations, combining adapted past-paper questions with fresh AI-generated questions covering underrepresented concepts.
- **Durable Persistence:** Serverless-compatible durable storage for document indexing, processing jobs, and active quizzes.
- **Minimized Secondary JSON Import:** Retains compatibility for students who have an existing `.json` quiz file or session JSON via an unobtrusive, secondary import panel.
- **Private & Local-First Progress:** Student attempts and progress are stored privately in browser local storage. Quizzes can be exported or shared via lightweight session links.

---

## Getting Started Locally

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local`:

```powershell
copy .env.example .env.local
```

Add your Groq API key:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
GROQ_FALLBACK_MODEL=llama-3.3-70b-versatile
```

*(Optional: You can also configure `OPENAI_API_KEY` to use OpenAI as an alternative provider).*

### 3. Run development server

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Automated Tests

Run the test suite with Vitest:

```powershell
npm test
```

Build the production application:

```powershell
npm run build
```
