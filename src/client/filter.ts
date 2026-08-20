/**
 * Candidate filtering for the '@' file source (package-internal; the `./client`
 * surface exposes only the Loader exports). Same-package tests exercise it
 * directly through this module.
 */
import type { AtFileEntry } from '../types.ts'
import type { InputTriggerCandidate } from './trigger-contract.ts'

/** Menu row cap per keystroke — the menu is a picker, not a file manager. */
export const CANDIDATE_LIMIT = 50

/** Basename of a '/' separated workspace path. */
function basename(path: string): string {
  // split always yields at least one element, so at(-1) is never undefined.
  /* v8 ignore next 1 -- defensive fallback for a structurally impossible miss. */
  return path.split('/').at(-1) ?? path
}

/**
 * Filter the settled index by query, ranked in three buckets: basename-prefix
 * matches (shallow paths first), then path-prefix matches (directory
 * navigation, `src/m` → `src/main.ts`), then path-substring matches — capped
 * at the menu limit. Matching is case-insensitive; candidates keep their exact
 * paths. The description row is the containing directory, which disambiguates
 * same-basename files.
 * @param files - the settled session index.
 * @param query - the live query text.
 * @param limit - menu row cap.
 * @returns the ranked candidate rows.
 */
export function filterFiles(
  files: readonly AtFileEntry[],
  query: string,
  limit = CANDIDATE_LIMIT,
): InputTriggerCandidate[] {
  const needle = query.trim().toLowerCase()
  const basenameStarts: { row: InputTriggerCandidate; depth: number }[] = []
  const pathStarts: InputTriggerCandidate[] = []
  const contains: InputTriggerCandidate[] = []
  for (const file of files) {
    if (basenameStarts.length + pathStarts.length + contains.length >= limit) break
    const slash = file.path.lastIndexOf('/')
    const row: InputTriggerCandidate = slash === -1
      ? { name: file.path }
      : { name: file.path, description: file.path.slice(0, slash) }
    const lower = file.path.toLowerCase()
    if (needle.length === 0 || basename(file.path).toLowerCase().startsWith(needle)) {
      // Shallow paths first among basename matches: a root file outranks a
      // same-basename file two levels deep.
      basenameStarts.push({ row, depth: slash === -1 ? 0 : file.path.split('/').length - 1 })
    } else if (lower.startsWith(needle)) {
      pathStarts.push(row)
    } else if (lower.includes(needle)) {
      contains.push(row)
    }
  }
  basenameStarts.sort((a, b) => a.depth - b.depth)
  return [...basenameStarts.map(match => match.row), ...pathStarts, ...contains].slice(0, limit)
}
