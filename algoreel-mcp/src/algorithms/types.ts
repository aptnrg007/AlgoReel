export type Operation =
  | { type: "init"; array: number[] }
  | { type: "pointer"; name: string; index: number }
  | { type: "compare"; a: number; b: number; result: "lt" | "eq" | "gt" }
  | { type: "swap"; i: number; j: number }
  | { type: "highlight"; indices: number[]; style: "focus" | "found" | "dead" }
  | { type: "discard"; from: number; to: number }
  | { type: "visit"; node: string }
  | { type: "enqueue"; node: string }
  | { type: "dequeue"; node: string }
  | { type: "edge"; from: string; to: string; state: "active" | "used" }
  | { type: "done"; result?: number | string };

export interface AlgorithmResult {
  operations: Operation[];
  summary: string;
}
