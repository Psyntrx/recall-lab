import { createZipArchive, type ZipEntry } from "@/lib/zip/zip-writer";

export type UploadedReferenceFile = {
  name: string;
  size?: number;
  content?: Uint8Array | string;
  file?: File;
};

export type StudyPackageOptions = {
  files: UploadedReferenceFile[];
  questionCount: number;
  focus?: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
  selectedChapters?: string[];
  assessmentContext?: string;
};

export const OUTPUT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "RecallLabQuizPackage",
  description: "Standard JSON format accepted by Recall Lab for study quizzes and active recall.",
  type: "object",
  required: ["questions"],
  properties: {
    title: {
      type: "string",
      description: "Concise, descriptive title for the study set.",
    },
    summary: {
      type: "string",
      description: "Optional high-yield conceptual summary of the study material.",
    },
    questions: {
      type: "array",
      description: "List of multiple-choice practice questions.",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        required: [
          "id",
          "question",
          "options",
          "correct_answer",
          "topic_reference",
          "explanation",
        ],
        properties: {
          id: {
            type: "string",
            description: "Unique question identifier (e.g. 'q1', 'q2', 'q3').",
          },
          question: {
            type: "string",
            description: "The question stem testing conceptual reasoning, application, or factual recall.",
          },
          options: {
            type: "object",
            description: "Exactly four distinct, plausible answer choices keyed A, B, C, and D.",
            required: ["A", "B", "C", "D"],
            properties: {
              A: { type: "string" },
              B: { type: "string" },
              C: { type: "string" },
              D: { type: "string" },
            },
            additionalProperties: false,
          },
          correct_answer: {
            type: "string",
            enum: ["A", "B", "C", "D"],
            description: "The single correct answer choice key.",
          },
          topic_reference: {
            type: "string",
            description: "Specific concept, topic, or section tested (e.g., 'Synchronous Speed', 'Calvin Cycle').",
          },
          explanation: {
            type: "string",
            description: "Instructive explanation describing why the correct choice is right and why the other options are wrong.",
          },
          source_reference: {
            type: ["string", "null"],
            description: "Specific chapter, page, or lecture citation (e.g., 'Chapter 2, Page 45'), or null if unreferenced.",
          },
          chapter: {
            type: "string",
            description: "Chapter name or major section header.",
          },
          difficulty: {
            type: "string",
            enum: ["easy", "medium", "hard"],
            description: "Assessed difficulty level.",
          },
          question_source: {
            type: "string",
            enum: ["extracted", "generated", "adapted"],
            description: "Origin of the question.",
          },
        },
        additionalProperties: false,
      },
    },
  },
};

export const OUTPUT_TEMPLATE = {
  title: "Cellular Bioenergetics & Respiration",
  summary:
    "Comprehensive active recall set covering oxidative phosphorylation, glycolysis, and the citric acid cycle based on provided study notes.",
  questions: [
    {
      id: "q1",
      question: "Which metabolic process produces the greatest net yield of ATP per molecule of glucose oxidized?",
      options: {
        A: "Oxidative phosphorylation via the electron transport chain",
        B: "Anaerobic glycolysis in the cytosol",
        C: "Substrate-level phosphorylation in the Krebs cycle",
        D: "Lactic acid fermentation",
      },
      correct_answer: "A",
      topic_reference: "Oxidative Phosphorylation",
      chapter: "Chapter 3: Cellular Respiration",
      difficulty: "medium",
      question_source: "generated",
      explanation:
        "Oxidative phosphorylation generates approximately 26–28 ATP per glucose, far exceeding the net 2 ATP produced by glycolysis or the 2 ATP from the Krebs cycle.",
      source_reference: "Chapter 3, Page 52",
    },
    {
      id: "q2",
      question: "What is the net gain of ATP directly generated during glycolysis of one glucose molecule?",
      options: {
        A: "2 ATP",
        B: "4 ATP",
        C: "32 ATP",
        D: "0 ATP",
      },
      correct_answer: "A",
      topic_reference: "Glycolysis",
      chapter: "Chapter 3: Cellular Respiration",
      difficulty: "easy",
      question_source: "generated",
      explanation:
        "Glycolysis invests 2 ATP and produces 4 ATP, resulting in a net yield of 2 ATP per glucose molecule.",
      source_reference: "Chapter 3, Page 48",
    },
  ],
};

export function makeDynamicAiPrompt(options: StudyPackageOptions): string {
  const fileNames = options.files.map((f) => f.name);
  const fileListText = fileNames.length
    ? fileNames.map((n, i) => `${i + 1}. \`references/${n}\``).join("\n")
    : "1. (Refer to files inside the references/ folder)";

  const focusText = options.focus?.trim()
    ? options.focus.trim()
    : "Comprehensive coverage across all provided chapters and sections";

  const diffText =
    options.difficulty && options.difficulty !== "mixed"
      ? options.difficulty
      : "Balanced mix of easy, medium, and hard conceptual questions";

  const chaptersText =
    options.selectedChapters && options.selectedChapters.length > 0
      ? `Specific Chapters to Focus On: ${options.selectedChapters.join(", ")}`
      : "Focus across all chapters in the supplied reference documents.";

  return `# Recall Lab — External AI Study Material Generation Prompt

You are serving as an expert academic curriculum specialist, cognitive science tutor, and rigorous exam author for Recall Lab.

Your goal is to inspect the supplied reference documents in the \`references/\` directory and generate a high-yield, defensible practice quiz formatted **strictly as valid JSON** matching \`OUTPUT_SCHEMA.json\`.

---

## 1. Study Configuration & User Preferences

- **Requested Number of Questions**: exactly **${options.questionCount}**
- **Study Focus / Topics**: ${focusText}
- **Target Difficulty**: ${diffText}
- **Chapter Scope**: ${chaptersText}
${options.assessmentContext ? `\n- **Past Assessment Context**:\n${options.assessmentContext}\n` : ""}
---

## 2. Supplied Reference Documents

Please read and synthesize content from the following files located in the \`references/\` directory:
${fileListText}

---

## 3. Strict Quality & Educational Rules

1. **Grounded in Reference Materials**:
   - Treat the files in \`references/\` as your single source of truth.
   - Never fabricate formulas, scientific claims, dates, or concepts not supported by these documents.
   - If multiple documents are provided, balance questions across them and retain their distinct section titles.

2. **Defensible Multiple-Choice Construction**:
   - Each question must test conceptual understanding, calculation, causal relationships, or principle application (never merely superficial keyword matching).
   - Each question must provide **exactly four distinct options** keyed \`"A"\`, \`"B"\`, \`"C"\`, and \`"D"\`.
   - Distractors (incorrect options) must be realistic, plausible misconceptions rather than absurd answers.
   - Exactly one option must be the \`"correct_answer"\` (\`"A"\`, \`"B"\`, \`"C"\`, or \`"D"\`). The correct choice should vary naturally across questions.

3. **Instructive Explanations**:
   - The \`"explanation"\` must thoroughly explain **why** the correct option is right AND clarify what misconception makes the alternate options incorrect.

4. **Source & Chapter References**:
   - Include specific page numbers or chapter titles in \`"source_reference"\` (e.g. \`"Chapter 2, Page 35"\`) whenever identifiable from the text.
   - Set the \`"chapter"\` field to the relevant chapter or major heading.

5. **Notation & Technical Integrity**:
   - Preserve scientific notation, formulas, chemical equations, and exact terminology as presented in the reference material.

6. **No Repetition**:
   - Ensure every question stem is unique. Distribute questions evenly across the topics rather than clustering on the introductory page.

---

## 4. Output Format Requirements (CRITICAL)

- You must return **ONLY** a single, valid JSON object matching the schema in \`OUTPUT_SCHEMA.json\`.
- **DO NOT** wrap your output in Markdown code blocks (do not use \`\`\`json or \`\`\`).
- **DO NOT** include greetings, preamble, notes, or concluding conversational remarks.
- Begin your response with \`{\` and end it with \`}\`.
- Ensure all string quotes and special characters are properly escaped.

Refer to \`OUTPUT_TEMPLATE.json\` for a working structural example.
`;
}

export function makeStudyInstructions(options: StudyPackageOptions): string {
  const fileNames = options.files.map((f) => f.name);
  const now = new Date().toISOString();

  return `# Study Session Instructions & Metadata

- **Generated by**: Recall Lab (External AI Package)
- **Timestamp**: ${now}
- **Target Question Count**: ${options.questionCount}
- **Study Focus**: ${options.focus?.trim() || "Comprehensive coverage"}
- **Difficulty**: ${options.difficulty || "mixed"}
${options.selectedChapters?.length ? `- **Selected Chapters**: ${options.selectedChapters.join(", ")}\n` : ""}
## Reference Documents Included
${fileNames.map((n, i) => `${i + 1}. \`${n}\``).join("\n")}

## How to Use This Package with an External AI (ChatGPT, Claude, Gemini, DeepSeek, etc.):

1. **Upload the Files**: Upload the files inside \`references/\` to your preferred AI model.
2. **Copy the Prompt**: Copy the entire text in \`AI_PROMPT.md\` and send it to the AI.
3. **Copy the AI's Output**: The AI will return a JSON object containing your study questions and explanations.
4. **Import into Recall Lab**: Return to Recall Lab, click **"Import AI Results"**, and paste the JSON (or upload it).
5. **Start Your Quiz**: Recall Lab will validate the questions, score your attempt, and track your active recall!
`;
}

/**
 * Builds the complete downloadable ZIP package containing:
 * - references/ (original uploaded files)
 * - instructions/study_instructions.md
 * - AI_PROMPT.md
 * - OUTPUT_SCHEMA.json
 * - OUTPUT_TEMPLATE.json
 */
export async function buildStudyPackage(options: StudyPackageOptions): Promise<{
  zipBlob: Blob;
  zipBytes: Uint8Array;
  filename: string;
  aiPromptText: string;
  instructionsText: string;
  outputSchemaText: string;
  outputTemplateText: string;
}> {
  const entries: ZipEntry[] = [];
  const textEncoder = new TextEncoder();

  // 1. Add reference files into references/
  const seenNames = new Map<string, number>();
  for (const fileItem of options.files) {
    let cleanName = fileItem.name || "reference.txt";
    const lower = cleanName.toLowerCase();
    const count = seenNames.get(lower) ?? 0;
    seenNames.set(lower, count + 1);

    if (count > 0) {
      const dotIndex = cleanName.lastIndexOf(".");
      if (dotIndex > 0) {
        cleanName = `${cleanName.slice(0, dotIndex)}_${count}${cleanName.slice(dotIndex)}`;
      } else {
        cleanName = `${cleanName}_${count}`;
      }
    }

    let fileBytes: Uint8Array;
    if (fileItem.content) {
      fileBytes =
        typeof fileItem.content === "string"
          ? textEncoder.encode(fileItem.content)
          : fileItem.content;
    } else if (fileItem.file) {
      const buffer = await fileItem.file.arrayBuffer();
      fileBytes = new Uint8Array(buffer);
    } else {
      fileBytes = new Uint8Array(0);
    }

    entries.push({
      name: `references/${cleanName}`,
      data: fileBytes,
    });
  }

  // 2. Generate instruction markdown
  const instructionsText = makeStudyInstructions(options);
  entries.push({
    name: "instructions/study_instructions.md",
    data: textEncoder.encode(instructionsText),
  });

  // 3. Generate dynamic AI prompt
  const aiPromptText = makeDynamicAiPrompt(options);
  entries.push({
    name: "AI_PROMPT.md",
    data: textEncoder.encode(aiPromptText),
  });

  // 4. Add OUTPUT_SCHEMA.json
  const outputSchemaText = JSON.stringify(OUTPUT_SCHEMA, null, 2);
  entries.push({
    name: "OUTPUT_SCHEMA.json",
    data: textEncoder.encode(outputSchemaText),
  });

  // 5. Add OUTPUT_TEMPLATE.json
  const outputTemplateText = JSON.stringify(OUTPUT_TEMPLATE, null, 2);
  entries.push({
    name: "OUTPUT_TEMPLATE.json",
    data: textEncoder.encode(outputTemplateText),
  });

  // Generate ZIP archive
  const zipBytes = createZipArchive(entries);
  const zipBlob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });

  const primaryName = options.files[0]?.name
    ? options.files[0].name.replace(/\.[^/.]+$/, "")
    : "Study_Material";
  const safeBase = primaryName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 30) || "Study_Material";
  const filename = `RecallLab_${safeBase}_Package.zip`;

  return {
    zipBlob,
    zipBytes,
    filename,
    aiPromptText,
    instructionsText,
    outputSchemaText,
    outputTemplateText,
  };
}
