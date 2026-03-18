import { useState } from "react";
import { DiffEditor, type BeforeMount } from "@monaco-editor/react";

interface DiffPreviewProps {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".rs": "rust",
  ".json": "json",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".py": "python",
  ".go": "go",
  ".sh": "shell",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return EXTENSION_LANGUAGES[ext] ?? "plaintext";
}

/** Simple diff using LCS to get accurate add/remove counts */
function countChanges(original: string, modified: string) {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const n = origLines.length;
  const m = modLines.length;

  // Optimize: if identical, skip
  if (original === modified) return { additions: 0, deletions: 0 };

  // Build LCS length table (space-optimized: only 2 rows)
  let prev = new Array(m + 1).fill(0);
  let curr = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === modLines[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcsLen = prev[m];
  return {
    additions: m - lcsLen,
    deletions: n - lcsLen,
  };
}

const handleBeforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("tide-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "565f89", fontStyle: "italic" },
      { token: "keyword", foreground: "bb9af7" },
      { token: "string", foreground: "9ece6a" },
      { token: "number", foreground: "ff9e64" },
      { token: "type", foreground: "2ac3de" },
      { token: "function", foreground: "7aa2f7" },
      { token: "variable", foreground: "c0caf5" },
    ],
    colors: {
      "editor.background": "#13141c",
      "editor.foreground": "#a9b1d6",
      "editor.lineHighlightBackground": "#1e1f2e",
      "editorLineNumber.foreground": "#3b4261",
      "editorLineNumber.activeForeground": "#737aa2",
      "diffEditor.insertedTextBackground": "#9ece6a1f",
      "diffEditor.removedTextBackground": "#f7768e1f",
      "diffEditor.insertedLineBackground": "#9ece6a12",
      "diffEditor.removedLineBackground": "#f7768e12",
      "editorGutter.addedBackground": "#9ece6a",
      "editorGutter.modifiedBackground": "#e0af68",
      "editorGutter.deletedBackground": "#f7768e",
    },
  });
};

export function DiffPreview({ filePath, originalContent, modifiedContent }: DiffPreviewProps) {
  const language = detectLanguage(filePath);
  const { additions, deletions } = countChanges(originalContent, modifiedContent);
  const [sideBySide, setSideBySide] = useState(false);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.filePath}>{filePath}</span>
        <button
          style={s.toggleBtn}
          onClick={() => setSideBySide(!sideBySide)}
          title={sideBySide ? "Switch to inline view" : "Switch to side-by-side view"}
        >
          {sideBySide ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <span style={s.additions}>+{additions}</span>
        <span style={s.deletions}>-{deletions}</span>
      </div>
      <div style={s.editor}>
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language={language}
          theme="tide-dark"
          beforeMount={handleBeforeMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            renderSideBySide: sideBySide,
            wordWrap: "off",
          }}
          height="100%"
        />
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 200,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    fontSize: "var(--font-size-sm)",
    background: "var(--bg-tertiary)",
    borderBottom: "1px solid var(--border)",
  },
  filePath: {
    flex: 1,
    fontFamily: "var(--font-mono)",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  toggleBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    padding: 0,
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
  },
  additions: {
    color: "var(--success)",
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    flexShrink: 0,
  },
  deletions: {
    color: "var(--error)",
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    flexShrink: 0,
  },
  editor: {
    flex: 1,
    overflow: "hidden",
  },
};
