// Turn lesson/answer markdown into something pleasant to hear: drop code, backticks,
// link/image syntax, and heading markers so the tutor speaks prose, not punctuation.

export function markdownToSpeech(md: string): string {
  return md
    // Remove fenced code blocks entirely (don't read code aloud).
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    // Inline code → just the inner text without backticks.
    .replace(/`([^`]+)`/g, "$1")
    // Images: drop.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links: keep the label, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Heading / blockquote / list markers at line starts.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    // Bold/italic emphasis markers.
    .replace(/(\*\*|__|\*|_)/g, "")
    // Collapse whitespace.
    .replace(/\n{2,}/g, ". ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
