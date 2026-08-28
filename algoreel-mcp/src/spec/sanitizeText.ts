// Strips markdown decoration a local model reliably adds to narration text
// even when a prompt doesn't ask for it — confirmed live: qwen3:8b's
// narration-draft answers came back with **bold**, and Caption.tsx renders
// plain text with no markdown interpretation, so an unstripped answer would
// show literal asterisks in the video. Deliberately narrow: only strips the
// wrapper characters, never touches the words between them, and only
// targets markdown-style wrappers (not e.g. apostrophes or real
// parentheses, which are normal narration punctuation).
export function sanitizeNarrationText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/(?<!\w)\*(\S(?:.*?\S)?)\*(?!\w)/g, "$1") // *italic*, not multiplication like 2*3
    .replace(/`([^`]+)`/g, "$1") // `code`
    .trim();
}
