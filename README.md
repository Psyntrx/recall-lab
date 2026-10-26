# Recall Lab

Recall Lab is a local-first study quiz app. Use an AI service of your choice to turn your study files into a JSON quiz, then import that JSON here. Every question has four distinct choices (A–D), one correct answer, and an explanation. At the end, the app groups results by topic and creates a report you can send back to AI for a tailored study plan.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. No API key or provider setup is required by the app.

## Study flow

1. In Recall Lab, set the requested question count and optional chapter focus, then copy the AI prompt.
2. Attach your PDF, notes, or other study files in a chat with your preferred AI. Paste the prompt and ask it to return only the specified JSON.
3. Paste the JSON into Recall Lab or import the `.json` file, then start the quiz.
4. Answer each question. The app reveals whether you were correct and shows the explanation.
5. At the end, copy or download the study report to ask AI for a chapter-by-chapter plan. Download the Markdown questions-and-answers document to keep a revision copy.

## Share a study session

1. Paste or import a valid quiz, then choose **Create shareable session** before starting, or choose **Share quiz** from the quiz screen.
2. Confirm the session title, topics, question count, creation time, and session ID on the landing page. The current app does not collect a separate course/subject field, so that value is shown as not specified.
3. Choose **Copy share link** and send the URL. It opens the session landing page directly; each recipient starts an independent attempt.
4. If the quiz is too large for a reliable URL, download the session JSON and send that file. Recipients open Recall Lab and choose **Open session JSON** to import it.
5. Recipients can refresh and resume their attempt in the same browser. **Restart quiz** clears that session's saved answers and starts a new attempt.

Shared links and exported session files contain the quiz, including correct answers and explanations, and can be inspected or edited by anyone who receives them. They do not contain original PDFs, notes, creator results, or student attempts. This client-side app has no database or account sync. Attempt recovery is stored in browser-local storage under that session ID; clearing browser data or changing devices removes access to that local progress.

The imported JSON has this shape:

```json
{
  "title": "Cell structure",
  "questions": [
    {
      "id": "q1",
      "question": "Which structure contains most of a cell's genetic material?",
      "options": { "A": "Nucleus", "B": "Cell membrane", "C": "Ribosome", "D": "Cell wall" },
      "correct_answer": "A",
      "topic_reference": "Cell organelles",
      "explanation": "The nucleus contains most of the cell's DNA.",
      "source_reference": "Chapter 2, page 18"
    }
  ]
}
```

`source_reference` may be `null` when the AI cannot reliably identify a page or section. Question IDs must be unique. Each question must have exactly four distinct, non-empty choices keyed `A`, `B`, `C`, and `D`; `correct_answer` must be one of those letters. Include a topic and a useful explanation.

## Privacy and session behaviour

Recall Lab does not upload or process study files and does not call an AI API. Files are shared only with the AI service you choose. Individual quizzes are kept in the current browser tab. Shared-session attempts are saved locally in the browser, separately from the shared quiz package. Download the answer sheet or study report before closing an individual session if you want to keep it. A study report includes your answers and the quiz’s answer key, so share it only with a service you trust.
