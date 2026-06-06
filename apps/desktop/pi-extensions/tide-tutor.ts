import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ───────────────────────────────────────────────────

interface LessonTarget {
  path: string;
  startLine?: number;
  endLine?: number;
  symbolId?: string;
}

interface LessonRef {
  id: string;
  title: string;
  summary: string;
  targets?: LessonTarget[];
  prerequisites?: string[];
}

interface Chapter {
  id: string;
  title: string;
  summary: string;
  lessons: LessonRef[];
}

interface Curriculum {
  title: string;
  techStack: string[];
  chapters: Chapter[];
  /** BCP-47-ish language the course is authored in (e.g. "en", "it"). */
  language: string;
  generatedAt: string;
}

// ── Path helpers ────────────────────────────────────────────

function tutorDir(root: string): string {
  return path.join(root, ".tide", "tutor");
}
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function curriculumPath(root: string): string {
  return path.join(tutorDir(root), "curriculum.json");
}
function lessonPath(root: string, lessonId: string): string {
  return path.join(tutorDir(root), "lessons", `${sanitizeId(lessonId)}.md`);
}
function quizPath(root: string, lessonId: string): string {
  return path.join(tutorDir(root), "lessons", `${sanitizeId(lessonId)}.quiz.json`);
}
function eventsDir(root: string): string {
  return path.join(tutorDir(root), "events");
}

/** Keep lesson ids safe as path segments. */
function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
}

function writeAtomic(target: string, content: string): void {
  ensureDir(path.dirname(target));
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, target);
}

/**
 * Emit a tutor event by dropping a JSON file in .tide/tutor/events/. The Rust
 * watcher forwards each new file to the frontend as a `tutor_event`. This keeps the
 * extension decoupled from the UI (same idea as the experts mailbox).
 */
function emitEvent(root: string, event: Record<string, unknown>): void {
  const dir = eventsDir(root);
  ensureDir(dir);
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  writeAtomic(path.join(dir, `${id}.json`), JSON.stringify(event, null, 2));
}

// ── Extension ───────────────────────────────────────────────

export default function tideTutor(pi: ExtensionAPI) {
  // tide_tutor_progress — report a short status line while analyzing/authoring so the
  // Learn panel shows live progress instead of a blank "Analyzing…".
  pi.registerTool({
    name: "tide_tutor_progress",
    label: "Tutor Progress",
    description:
      "Report a brief progress step (e.g. 'Mapping the file tree', 'Exploring the state stores'). " +
      "Call this between analysis/authoring phases so the learner sees what you're doing.",
    promptSnippet: "Report a tutor progress step",
    parameters: Type.Object({
      step: Type.String({ description: "A short present-tense status line" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      emitEvent(ctx.cwd, { kind: "phase", phase: "analyzing", message: params.step });
      return { content: [{ type: "text" as const, text: "ok" }], details: null };
    },
  });

  // tide_tutor_build_curriculum — the agent does the deep analysis (using the
  // tide_index_* and tide_dispatch tools) and calls this with the finished, ordered
  // curriculum. We validate + persist it and signal the UI. (Same "tool persists the
  // artifact the agent produced" shape as tide_plan_create.)
  pi.registerTool({
    name: "tide_tutor_build_curriculum",
    label: "Build Curriculum",
    description:
      "Persist the codebase learning curriculum you have designed. Call this AFTER analyzing the " +
      "codebase (use tide_index_repo_outline / tide_index_file_tree / tide_dispatch first). " +
      "Chapters and lessons MUST be ordered first-concepts-first (high-level overview and tech stack " +
      "before subsystem deep-dives). Each lesson should name the concrete files/symbols it teaches.",
    promptSnippet: "Persist the ordered codebase learning curriculum",
    parameters: Type.Object({
      title: Type.String({ description: "Course title, e.g. 'Understanding the Tide IDE'" }),
      language: Type.Optional(Type.String({ description: "Language code the course is authored in (e.g. 'en', 'it'). Use the requested language." })),
      techStack: Type.Array(Type.String(), { description: "Key technologies/frameworks detected" }),
      chapters: Type.Array(
        Type.Object({
          id: Type.String({ description: "Stable kebab-case id, e.g. 'overview'" }),
          title: Type.String(),
          summary: Type.String({ description: "1-2 sentences on what this chapter covers" }),
          lessons: Type.Array(
            Type.Object({
              id: Type.String({ description: "Stable kebab-case id, unique across the course" }),
              title: Type.String(),
              summary: Type.String({ description: "1-2 sentences on what this lesson teaches" }),
              targets: Type.Optional(
                Type.Array(
                  Type.Object({
                    path: Type.String({ description: "Workspace-relative file path this lesson centers on" }),
                    startLine: Type.Optional(Type.Number()),
                    endLine: Type.Optional(Type.Number()),
                    symbolId: Type.Optional(Type.String({ description: "Index symbol id if known" })),
                  }),
                ),
              ),
              prerequisites: Type.Optional(Type.Array(Type.String({ description: "Lesson ids to learn first" }))),
            }),
          ),
        }),
        { description: "Ordered chapters, first-concepts-first" },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      const curriculum: Curriculum = {
        title: params.title,
        language: params.language || "en",
        techStack: params.techStack,
        chapters: params.chapters as Chapter[],
        generatedAt: new Date().toISOString(),
      };
      writeAtomic(curriculumPath(root), JSON.stringify(curriculum, null, 2));
      emitEvent(root, { kind: "curriculum_ready" });

      const lessonCount = curriculum.chapters.reduce((n, c) => n + c.lessons.length, 0);
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved curriculum "${curriculum.title}" — ${curriculum.chapters.length} chapters, ${lessonCount} lessons.`,
          },
        ],
        details: { chapters: curriculum.chapters.length, lessons: lessonCount },
      };
    },
  });

  // tide_tutor_author_lesson — the agent authors the full lesson markdown (concept-first,
  // with real `path:start-end` code references and inline snippets pulled via
  // tide_index_get_symbol) and calls this to persist + reveal it.
  pi.registerTool({
    name: "tide_tutor_author_lesson",
    label: "Author Lesson",
    description:
      "Persist a fully-authored lesson as markdown. The lesson must teach concept-first (the why/how/what), " +
      "embed REAL code snippets (fetched via tide_index_get_symbol or by reading the file), and reference " +
      "concrete locations as `path:startLine-endLine` in backticks so the user can click to the exact line. " +
      "If the lesson's code shows a weak/questionable choice and critique is enabled, include a section titled " +
      "'## Critique & Improvements'.",
    promptSnippet: "Persist an authored codebase lesson (markdown)",
    parameters: Type.Object({
      lessonId: Type.String({ description: "The lesson id from the curriculum" }),
      markdown: Type.String({ description: "The full lesson content in GitHub-flavored markdown" }),
      quiz: Type.Optional(
        Type.Array(
          Type.Object({
            question: Type.String(),
            options: Type.Array(Type.String(), { description: "2-4 answer choices" }),
            answerIndex: Type.Number({ description: "0-based index of the correct option" }),
            explanation: Type.Optional(Type.String({ description: "Why that answer is correct" })),
          }),
          { description: "2-3 multiple-choice questions checking understanding of this lesson" },
        ),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      writeAtomic(lessonPath(root, params.lessonId), params.markdown);
      if (params.quiz && params.quiz.length > 0) {
        writeAtomic(quizPath(root, params.lessonId), JSON.stringify(params.quiz, null, 2));
      }
      emitEvent(root, { kind: "lesson_ready", lessonId: params.lessonId });
      return {
        content: [{ type: "text" as const, text: `Authored lesson "${params.lessonId}".` }],
        details: { lessonId: params.lessonId, quiz: params.quiz?.length ?? 0 },
      };
    },
  });

  // tide_tutor_answer — answer a user's question in the Learn panel chat. The agent
  // produces the answer (with code refs) and calls this so it lands in the tutor chat
  // rather than the main agent chat.
  pi.registerTool({
    name: "tide_tutor_answer",
    label: "Tutor Answer",
    description:
      "Deliver your answer to the user's question about the codebase. Include `path:line` references in " +
      "backticks where helpful. Always call this to respond — it routes the answer to the Learn panel chat.",
    promptSnippet: "Answer a learner's question in the Learn panel",
    parameters: Type.Object({
      lessonId: Type.Optional(Type.String({ description: "Current lesson id, if any" })),
      question: Type.String({ description: "The user's question, verbatim" }),
      answer: Type.String({ description: "Your full answer in markdown" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const root = ctx.cwd;
      emitEvent(root, {
        kind: "answer",
        lessonId: params.lessonId ?? null,
        question: params.question,
        answer: params.answer,
      });
      return {
        content: [{ type: "text" as const, text: "Answer delivered to the Learn panel." }],
        details: null,
      };
    },
  });
}
