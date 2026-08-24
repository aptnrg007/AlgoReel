import type { AlgorithmResult, Operation } from "./types";

export interface CheckBalancedParensInput {
  expression: string;
}

const OPEN: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Pure, deterministic — same boundary as reverseLinkedList.ts/bfs.ts/
 * inorderTraversal.ts (PLAN.md §2). Phase 2's second proof case for the
 * generic structure engine: a stack is a "column"-layout structure with
 * no links at all, no different in kind from a tree's "levels" or a
 * graph's "circle" — this file adds zero new Operation variants and the
 * renderer needs zero changes to support it.
 *
 * Unlike reverseLinkedList/bfs/inorderTraversal, a stack's *node set*
 * itself changes over time (push adds one, pop removes one) rather than
 * just its states/links — so instead of one "struct" declaring every
 * node up front, this re-emits "struct" with the current stack contents
 * every time it changes. That's a legitimate use of the same mechanism,
 * not a new one: "struct" is defined as "these are the currently-existing
 * nodes and how they're laid out," and applyOperation already replaces
 * structNodes wholesale on every "struct" op — nothing about that
 * requires it to fire only once.
 */
export function checkBalancedParens({ expression }: CheckBalancedParensInput): AlgorithmResult {
  const chars = [...expression];
  const operations: Operation[] = [];
  const stack: { id: string; value: string }[] = [];
  let idCounter = 0;
  let balanced = true;

  for (const ch of chars) {
    if ("([{".includes(ch)) {
      const node = { id: `n${idCounter++}`, value: ch };
      stack.push(node);
      operations.push({ type: "struct", layout: "column", nodes: [...stack] });
      // "focus" is the step boundary (src/spec/beats.ts) — one primary
      // step per character processed.
      operations.push({ type: "nodeState", nodes: [node.id], state: "focus" });
    } else if (")]}".includes(ch)) {
      const top = stack[stack.length - 1];
      if (!top || top.value !== OPEN[ch]) {
        balanced = false;
        if (top) operations.push({ type: "nodeState", nodes: [top.id], state: "dead" });
        break;
      }
      operations.push({ type: "nodeState", nodes: [top.id], state: "focus" });
      stack.pop();
      // A pop that empties the stack completely is left showing that last
      // matched node (marked "done" instead of removed) rather than
      // re-declaring "struct" with zero nodes — a screen with genuinely
      // nothing on it reads as a broken render to a viewer, not as "look,
      // it's empty," and checkRender.ts's blank-checkpoint check agrees.
      // Every earlier pop still removes its node immediately; only the
      // very last one lingers.
      if (stack.length > 0) {
        operations.push({ type: "struct", layout: "column", nodes: [...stack] });
      } else {
        operations.push({ type: "nodeState", nodes: [top.id], state: "done" });
      }
    }
  }
  if (stack.length > 0) balanced = false;

  operations.push({ type: "done", result: balanced ? "balanced" : "unbalanced" });

  const summary = balanced
    ? `The expression "${expression}" is balanced — every opening bracket was pushed and popped in the ` +
      `right order, leaving the stack empty at the end.`
    : `The expression "${expression}" is NOT balanced — a closing bracket didn't match what was on top ` +
      `of the stack, or brackets were left unclosed.`;

  return { operations, summary };
}
