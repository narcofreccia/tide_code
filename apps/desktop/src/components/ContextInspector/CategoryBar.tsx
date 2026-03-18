import { useState } from "react";
import type { CategoryBreakdown } from "../../stores/contextStore";

const CATEGORY_COLORS: Record<string, string> = {
  "System Prompt": "#7aa2f7",
  "Conversation": "#9ece6a",
  "Tool Results": "#ff9e64",
  "Tool Definitions": "#bb9af7",
};

const DEFAULT_COLOR = "#565f89";

interface CategoryBarProps {
  categories: CategoryBreakdown[];
  budgetTokens: number;
}

export function CategoryBar({ categories, budgetTokens }: CategoryBarProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (categories.length === 0) {
    return (
      <div style={s.empty}>No breakdown data yet. Send a message first.</div>
    );
  }

  const totalUsed = categories.reduce((sum, c) => sum + c.tokens, 0);

  return (
    <div style={s.container}>
      <div style={s.bar}>
        {categories.map((cat, i) => {
          const widthPct = budgetTokens > 0 ? (cat.tokens / budgetTokens) * 100 : 0;
          if (widthPct < 0.5) return null;
          const color = CATEGORY_COLORS[cat.category] || DEFAULT_COLOR;
          return (
            <div
              key={cat.category}
              style={{
                ...s.segment,
                width: `${widthPct}%`,
                backgroundColor: color,
                opacity: hoveredIdx === null || hoveredIdx === i ? 1 : 0.4,
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          );
        })}
      </div>

      {hoveredIdx !== null && categories[hoveredIdx] && (
        <div style={s.tooltip}>
          <span style={{ color: CATEGORY_COLORS[categories[hoveredIdx].category] || DEFAULT_COLOR, fontWeight: 600 }}>
            {categories[hoveredIdx].category}
          </span>
          <span>{categories[hoveredIdx].tokens.toLocaleString()} tokens</span>
          <span>({Math.round(categories[hoveredIdx].percentage * 100)}%)</span>
        </div>
      )}

      <div style={s.legend}>
        {categories.map((cat) => {
          const color = CATEGORY_COLORS[cat.category] || DEFAULT_COLOR;
          return (
            <div key={cat.category} style={s.legendItem}>
              <span style={{ ...s.legendDot, backgroundColor: color }} />
              <span style={s.legendLabel}>{cat.category}</span>
              <span style={s.legendValue}>{(cat.tokens / 1000).toFixed(1)}K</span>
            </div>
          );
        })}
      </div>

      <div style={s.totalRow}>
        <span style={s.totalLabel}>Total</span>
        <span style={s.totalValue}>
          {(totalUsed / 1000).toFixed(1)}K / {(budgetTokens / 1000).toFixed(0)}K tokens
        </span>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  bar: {
    display: "flex",
    height: 12,
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 1,
  },
  segment: {
    height: "100%",
    transition: "opacity 0.15s ease, width 0.3s ease",
    cursor: "pointer",
    minWidth: 4,
  },
  tooltip: {
    display: "flex",
    gap: 6,
    fontSize: "var(--font-size-xs)",
    color: "var(--text-primary)",
    padding: "2px 0",
  },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 12px",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--font-size-xs)",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  legendLabel: {
    color: "var(--text-secondary)",
  },
  legendValue: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontWeight: 500,
  },
  totalRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "var(--font-size-xs)",
    padding: "4px 0 0",
    borderTop: "1px solid var(--border)",
  },
  totalLabel: {
    color: "var(--text-secondary)",
    fontWeight: 600,
  },
  totalValue: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
  },
  empty: {
    padding: 16,
    textAlign: "center" as const,
    color: "var(--text-secondary)",
    fontSize: "var(--font-size-xs)",
    fontStyle: "italic",
  },
};
