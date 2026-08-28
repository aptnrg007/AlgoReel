import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Shared by sandbox.test.ts and sandboxGraph.test.ts, which both need to
// let a generated-algorithm cache directory (generated/, generated-graph/)
// fill up with test-produced files and then put it back exactly as it
// was. The previous approach in both files reset to a *hardcoded* empty
// manifest instead of the directory's real prior content — silently
// correct only as long as the directory actually held nothing but that
// baseline. It doesn't: both directories carry real, permanently
// committed generated algorithms (generated/cocktailsort.ts,
// generated-graph/dfs.ts), and the hardcoded reset deleted them and
// blanked their manifests on every single test run, indistinguishable
// from a passing test suite. Found live: three consecutive `npm test`
// runs each silently wiped both files from disk (recovered via `git
// checkout` since neither had been committed in the corrupted state).
//
// Snapshotting the directory's actual on-disk content at import time —
// before any test in the file has run — and restoring exactly that
// afterward fixes this generally: correct whether the directory holds
// zero, one, or many committed generated files, with no hardcoded
// assumption about what "clean" looks like.
//
// This still isn't enough on its own for real correctness under
// concurrency: sandbox.test.ts, sandboxGraph.test.ts, sandboxTree.test.ts,
// and ensureAlgorithm.test.ts each snapshot/restore their own directory
// (generated/, generated-graph/, generated-tree/) independently, but
// `node --test`'s default file-level concurrency runs those four files as
// separate, genuinely concurrent processes — so one file's before()/
// after() can restoreDir() the *shared physical directory* out from under
// another file's test mid-flight, deleting a file it just wrote and
// hasn't imported yet. Latent from the start, but narrow enough (near-
// zero delay between write and import) to almost never actually lose the
// race — found live, 100% reproducible, once sandbox.ts's real
// typeCheckGeneratedFile validator added ~300-700ms between those two
// steps. Fixed at the root, not by trying to make every individual
// snapshot/restore call atomic across processes: package.json's `test`
// script now passes `--test-concurrency=1`, so no two test files ever run
// at the same wall-clock time, and no two processes can race on the same
// directory. Confirmed live: the same failure reproduced 100% of runs at
// default concurrency and 0% of runs (multiple) at concurrency 1.
export function snapshotDir(dir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      snapshot.set(f, readFileSync(join(dir, f), "utf8"));
    }
  }
  return snapshot;
}

// Makes `dir` match `snapshot` exactly: deletes any file the tests added
// that wasn't originally there, (re)writes every file that was —
// undoing any in-place edit a test made to a pre-existing file (e.g.
// manifest.ts). Idempotent, so the same function serves as both the
// pre-test baseline reset and the post-test cleanup.
export function restoreDir(dir: string, snapshot: Map<string, string>): void {
  mkdirSync(dir, { recursive: true });
  const current = existsSync(dir) ? readdirSync(dir) : [];
  for (const f of current) {
    if (!snapshot.has(f)) rmSync(join(dir, f));
  }
  for (const [f, content] of snapshot) {
    writeFileSync(join(dir, f), content);
  }
}
