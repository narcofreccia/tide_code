import React, { useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { openFileByPath, openFileAtLine } from "../../lib/fileHelpers";

// Lazily-loaded Mermaid renderer (keeps the heavy lib out of the main bundle). Parses
// once per code change; on any error falls back to the raw code block.
const MermaidDiagram = React.memo(function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = React.useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const { svg } = await mermaid.render(`tide-mmd-${id}`, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [code, id]);

  if (failed) return <pre style={s.pre}><code>{code}</code></pre>;
  if (!svg) return <div style={{ ...s.pre, opacity: 0.6 }}>Rendering diagram…</div>;
  return <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }} dangerouslySetInnerHTML={{ __html: svg }} />;
});

const FILE_EXTENSIONS = /\.(tsx?|jsx?|rs|json|md|css|html|py|go|toml|yaml|yml|sh|sql|lock|cfg|ini|env|xml|svg)$/;
/**
 * Parse a code reference in backticks. Accepts a bare path (`src/app.ts`) or a path with
 * a line / line-range suffix (`sidecar.rs:254`, `src/app.ts:10-20`). Returns null if the
 * text doesn't look like a workspace file reference.
 */
function parseFileRef(text: string): { path: string; line?: number } | null {
  const m = text.match(/^(.+?):(\d+)(?:-\d+)?$/);
  const pathPart = m ? m[1] : text;
  const line = m ? parseInt(m[2], 10) : undefined;
  if (FILE_EXTENSIONS.test(pathPart) || /^(src|apps|\.\.?)\//i.test(pathPart)) {
    return { path: pathPart, line };
  }
  return null;
}

function FileLink({ children, path, line }: { children: React.ReactNode; path: string; line?: number }) {
  const [hovered, setHovered] = useState(false);
  const handleClick = useCallback(() => {
    if (line) openFileAtLine(path, line);
    else openFileByPath(path);
  }, [path, line]);
  return (
    <code
      style={{ ...s.inlineCode, ...s.fileLink, ...(hovered ? s.fileLinkHover : {}) }}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={line ? `Open ${path} at line ${line}` : `Open ${path}`}
    >
      {children}
    </code>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      style={s.copyBtn}
      onClick={handleCopy}
      title="Copy code"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Hoisted to module scope so ReactMarkdown doesn't see a new reference every render
const markdownComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      const codeText = String(children).replace(/\n$/, "");
      if (className === "language-mermaid") {
        return <MermaidDiagram code={codeText} />;
      }
      return (
        <div style={s.codeBlock}>
          <div style={s.codeHeader}>
            <span>{className?.replace("language-", "") || "code"}</span>
            <CopyButton text={codeText} />
          </div>
          <pre style={s.pre}>
            <code {...props}>{children}</code>
          </pre>
        </div>
      );
    }
    const text = String(children).trim();
    const ref = parseFileRef(text);
    if (ref) {
      return <FileLink path={ref.path} line={ref.line}>{children}</FileLink>;
    }
    return <code style={s.inlineCode} {...props}>{children}</code>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  p({ children }) {
    return <p style={s.paragraph}>{children}</p>;
  },
  h1({ children }) {
    return <h1 style={{ ...s.heading, fontSize: 22, lineHeight: 1.25 }}>{children}</h1>;
  },
  h2({ children }) {
    return <h2 style={{ ...s.heading, fontSize: 17, lineHeight: 1.3 }}>{children}</h2>;
  },
  h3({ children }) {
    return <h3 style={{ ...s.heading, fontSize: 14, lineHeight: 1.35 }}>{children}</h3>;
  },
  ul({ children }) {
    return <ul style={s.list}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={s.list}>{children}</ol>;
  },
  li({ children }) {
    return <li style={s.listItem}>{children}</li>;
  },
  a({ href, children }) {
    return (
      <a style={s.link} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return <blockquote style={s.blockquote}>{children}</blockquote>;
  },
  hr() {
    return <hr style={s.hr} />;
  },
  strong({ children }) {
    return <strong style={s.strong}>{children}</strong>;
  },
};

interface MessageRendererProps {
  content: string;
}

export const MessageRenderer = React.memo(function MessageRenderer({ content }: MessageRendererProps) {
  return (
    <div style={s.container}>
      <ReactMarkdown components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-size-sm)",
    lineHeight: 1.6,
    color: "var(--text-primary)",
    wordBreak: "break-word",
  },
  paragraph: {
    margin: "0 0 8px 0",
  },
  heading: {
    margin: "16px 0 8px 0",
    color: "var(--text-bright)",
    fontWeight: 600,
  },
  codeBlock: {
    margin: "8px 0",
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
    border: "1px solid var(--border)",
  },
  codeHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 12px",
    fontSize: "var(--font-size-xs)",
    fontFamily: "var(--font-mono)",
    color: "var(--text-secondary)",
    background: "var(--bg-tertiary)",
    borderBottom: "1px solid var(--border)",
  },
  copyBtn: {
    padding: "1px 8px",
    fontSize: "var(--font-size-xs)",
    fontFamily: "var(--font-ui)",
    color: "var(--text-secondary)",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    lineHeight: 1.5,
  },
  pre: {
    margin: 0,
    padding: 12,
    fontFamily: "var(--font-mono)",
    fontSize: "var(--font-size-xs)",
    lineHeight: 1.5,
    background: "var(--bg-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  },
  inlineCode: {
    padding: "1px 4px",
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    color: "var(--accent)",
    background: "var(--bg-tertiary)",
    borderRadius: 3,
  },
  list: {
    margin: "4px 0 8px 0",
    paddingLeft: 20,
  },
  listItem: {
    margin: "2px 0",
  },
  link: {
    color: "var(--accent)",
    textDecoration: "none",
  },
  blockquote: {
    margin: "8px 0",
    paddingLeft: 12,
    borderLeft: "3px solid var(--border)",
    color: "var(--text-secondary)",
  },
  hr: {
    border: "none",
    borderTop: "1px solid var(--border)",
    margin: "12px 0",
  },
  strong: {
    color: "var(--text-bright)",
    fontWeight: 600,
  },
  fileLink: {
    cursor: "pointer",
    textDecoration: "underline",
    textDecorationColor: "var(--accent)",
    textDecorationThickness: 1,
    textUnderlineOffset: 2,
  },
  fileLinkHover: {
    background: "rgba(96, 165, 250, 0.2)",
  },
};
