// Mechanically derives spec.emphasis from real narration text instead of
// asking a model to pick words and hoping validate.ts's substring check is
// satisfied. That check only verifies a word appears *somewhere* in the
// text case-insensitively — but Caption.tsx's actual renderer
// (remotion/template/Caption.tsx's splitEmphasis) builds an unanchored,
// case-insensitive regex from spec.emphasis and highlights every match,
// including inside a longer word: an emphasis word "sort" matches the
// "sort" inside "sorted" and renders as two differently-colored halves of
// one word. Confirmed by reading splitEmphasis directly — validate.ts's
// check would pass that "sort"/"sorted" combination cleanly.
//
// So a real emphasis candidate must be a genuine standalone word (found
// with \b boundaries) that is never a substring of any *other* distinct
// word used anywhere in the narration — the second half of that rule is
// what "sort" fails once "sorted" is also present, even though "sort"
// itself appears as its own word elsewhere too.
const STOPWORDS = new Set([
  "this",
  "that",
  "then",
  "than",
  "with",
  "from",
  "into",
  "over",
  "under",
  "once",
  "while",
  "when",
  "each",
  "every",
  "just",
  "here",
  "there",
  "what",
  "which",
  "will",
  "have",
  "does",
  "step",
  "steps",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

// Picks up to maxWords distinct emphasis-worthy words, in first-appearance
// order across the given texts (hook first, then op beats, then outro —
// whatever order the caller passes them in), each at least minLength
// characters, never a substring of any other distinct word appearing
// anywhere in the combined text.
export function deriveEmphasis(texts: string[], opts?: { minLength?: number; maxWords?: number }): string[] {
  const minLength = opts?.minLength ?? 4;
  const maxWords = opts?.maxWords ?? 4;

  const allWords = new Set<string>();
  const firstAppearance: string[] = [];
  for (const text of texts) {
    for (const word of tokenize(text)) {
      if (!allWords.has(word)) {
        allWords.add(word);
        firstAppearance.push(word);
      }
    }
  }

  const wordList = [...allWords];
  function isSubstringOfAnotherWord(word: string): boolean {
    return wordList.some((other) => other !== word && other.includes(word));
  }

  const chosen: string[] = [];
  for (const word of firstAppearance) {
    if (chosen.length >= maxWords) break;
    if (word.length < minLength) continue;
    if (STOPWORDS.has(word)) continue;
    if (isSubstringOfAnotherWord(word)) continue;
    chosen.push(word);
  }
  return chosen;
}
