/**
 * File-reference vocabulary of dsh-at-file: the index row the Remote carries
 * and the durable source of an injected file message. Types only — no runtime
 * code.
 */

/**
 * One workspace file row of the `@` reference index. Paths are
 * workspace-relative with '/' separators, exactly as the user writes them
 * after '@'.
 */
export interface AtFileEntry {
  /** Workspace-relative path using '/' separators. */
  readonly path: string
  /** Byte size of the regular file, when the backend reports it. */
  readonly size?: number
}

/**
 * Durable source of one injected file-reference user message: the user's
 * '@' token and how many bytes of it reached the model (bounded by the
 * plugin's `maxBytes`). Recorded on the `user/message` event so the model
 * input is reconstructable from the session log.
 */
export interface AtFileReferenceSource {
  readonly kind: 'at-file'
  /** The user-written '@' token path (workspace-relative, '/' separators). */
  readonly path: string
  /** UTF-8 bytes of the injected content. */
  readonly bytes: number
}

/** The wire value of the `atFile.list` Remote: the index rows. */
export interface AtFileListResult {
  readonly files: readonly AtFileEntry[]
}
