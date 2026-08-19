export interface NarrationBeat {
  beat: "intro" | "outro" | `op:${number}`;
  text: string;
}

export interface StorySpec {
  version: 1;
  topic: string;
  algorithm: "binarySearch";
  input: { array: number[]; target: number };
  targetDurationSec: number;
  hook: string;
  narration: NarrationBeat[];
  emphasis: string[];
  complexity: { time: string; space: string };
  youtube: { title: string; description: string; tags: string[] };
}
