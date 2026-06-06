import { useRef, useCallback, useState, useEffect } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useRegionTags } from "./useRegionTags";
import { useTutorStore } from "../../stores/tutorStore";
import { useWorkspaceStore } from "../../stores/workspace";

interface MonacoEditorProps {
  content: string;
  language: string;
  path: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  /** When set, reveal + briefly highlight this 1-based line (e.g. from a lesson code ref). */
  revealLine?: number;
}

// Injected once: the transient highlight applied when jumping to a line.
if (typeof document !== "undefined" && !document.getElementById("tide-reveal-line-kf")) {
  const style = document.createElement("style");
  style.id = "tide-reveal-line-kf";
  style.textContent =
    ".tide-reveal-line{background:rgba(122,162,247,0.18);transition:background 1.5s ease-out;}";
  document.head.appendChild(style);
}

export function MonacoEditor({
  content,
  language,
  path,
  readOnly = false,
  onChange,
  revealLine,
}: MonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState<editor.IStandaloneCodeEditor | null>(null);
  const isExternalUpdate = useRef(false);
  const decorationsRef = useRef<string[]>([]);
  // The editor instance persists across files, so read the current path from a ref.
  const pathRef = useRef(path);
  pathRef.current = path;
  useRegionTags(editorReady, path);

  // Reveal + transiently highlight a target line when one is requested.
  useEffect(() => {
    const ed = editorReady;
    if (!ed || !revealLine || revealLine < 1) return;
    ed.revealLineInCenter(revealLine);
    ed.setPosition({ lineNumber: revealLine, column: 1 });
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [
      {
        range: { startLineNumber: revealLine, startColumn: 1, endLineNumber: revealLine, endColumn: 1 },
        options: { isWholeLine: true, className: "tide-reveal-line" },
      },
    ]);
    const t = setTimeout(() => {
      decorationsRef.current = ed.deltaDecorations(decorationsRef.current, []);
    }, 1800);
    return () => clearTimeout(t);
  }, [editorReady, revealLine, path]);

  // Sync editor content when file is reloaded from disk (e.g. after agent changes)
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const model = ed.getModel();
    if (!model) return;
    const currentValue = model.getValue();
    if (currentValue !== content) {
      isExternalUpdate.current = true;
      model.setValue(content);
      isExternalUpdate.current = false;
    }
  }, [content]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    setEditorReady(editor);

    // Tokyo Night theme
    monaco.editor.defineTheme("tide-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "565f89", fontStyle: "italic" },
        { token: "keyword", foreground: "9d7cd8" },
        { token: "keyword.control", foreground: "bb9af7" },
        { token: "string", foreground: "9ece6a" },
        { token: "string.escape", foreground: "89ddff" },
        { token: "number", foreground: "ff9e64" },
        { token: "type", foreground: "2ac3de" },
        { token: "type.identifier", foreground: "2ac3de" },
        { token: "function", foreground: "7aa2f7" },
        { token: "variable", foreground: "c0caf5" },
        { token: "variable.predefined", foreground: "7dcfff" },
        { token: "constant", foreground: "ff9e64" },
        { token: "operator", foreground: "89ddff" },
        { token: "delimiter", foreground: "9abdf5" },
        { token: "tag", foreground: "f7768e" },
        { token: "attribute.name", foreground: "bb9af7" },
        { token: "attribute.value", foreground: "9ece6a" },
        { token: "regexp", foreground: "b4f9f8" },
        { token: "annotation", foreground: "e0af68" },
        { token: "meta", foreground: "565f89" },
      ],
      colors: {
        "editor.background": "#13141c",
        "editor.foreground": "#a9b1d6",
        "editorLineNumber.foreground": "#2e3148",
        "editorLineNumber.activeForeground": "#565f89",
        "editor.selectionBackground": "#283050",
        "editor.lineHighlightBackground": "#181924",
        "editorCursor.foreground": "#c0caf5",
        "editor.findMatchBackground": "#3d59a1aa",
        "editor.findMatchHighlightBackground": "#3d59a155",
        "editorBracketMatch.background": "#13141c00",
        "editorBracketMatch.border": "#3b4261",
        "editorIndentGuide.background": "#232433",
        "editorIndentGuide.activeBackground": "#2e3148",
        "editorWidget.background": "#181924",
        "editorSuggestWidget.background": "#181924",
        "editorSuggestWidget.border": "#23243300",
        "editorSuggestWidget.selectedBackground": "#1e1f2e",
        "scrollbarSlider.background": "#2e314860",
        "scrollbarSlider.hoverBackground": "#3b426190",
      },
    });
    monaco.editor.setTheme("tide-dark");

    // Right-click → "Ask the tutor about this": send the selection to the Learn panel.
    editor.addAction({
      id: "tide.tutor.explainSelection",
      label: "Ask the tutor about this",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: (ed) => {
        const sel = ed.getSelection();
        const model = ed.getModel();
        if (!sel || !model) return;
        const code = model.getValueInRange(sel);
        if (!code.trim()) return;
        const full = pathRef.current;
        const root = useWorkspaceStore.getState().rootPath;
        const rel = root && full.startsWith(root) ? full.slice(root.length).replace(/^\//, "") : full;
        void useTutorStore.getState().explainSelection(rel, sel.startLineNumber, sel.endLineNumber, code);
      },
    });

    editor.focus();
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      // Skip onChange when content was set externally (e.g. agent file reload)
      if (isExternalUpdate.current) return;
      if (value !== undefined && onChange) {
        onChange(value);
      }
    },
    [onChange],
  );

  return (
    <Editor
      height="100%"
      language={language}
      value={content}
      path={path}
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "var(--font-mono)",
        lineNumbers: "on",
        renderLineHighlight: "line",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "off",
        padding: { top: 8 },
        glyphMargin: true,
      }}
    />
  );
}
