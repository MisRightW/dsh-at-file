/**
 * Structural faces of the input-trigger pipeline (frozen cross-package
 * contract, mirrored locally so this bundle imports no browser-runtime
 * package). Values are supplied by the host's `ctx.inputTriggers` service; the
 * shapes here are the subset dsh-at-file consumes.
 */

/** Trigger character a source binds to. */
export type TriggerChar = '/' | '@'

/** Where the trigger token sits in the draft: leading or inline. */
export type TriggerPosition = 'leading' | 'inline'

/** Which of the pick paths produced a pick. */
export type PickVia = 'menu' | 'space' | 'enter'

/** The provider-facing projection of one client session. */
export interface ClientSessionContext {
  readonly sessionId: string
}

/** One menu candidate. Pure display data — zero behavior declaration. */
export interface InputTriggerCandidate {
  readonly name: string
  readonly description?: string
  readonly icon?: string
  readonly hint?: string
}

/** Pick-moment snapshot of the trigger token span. CAS: stale draftRev ⇒ the whole action no-ops. */
export interface TokenSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Settled result of a pick. */
export type PickOutcome =
  | { readonly claim: unknown }
  | { readonly insert: unknown }
  | { readonly text: string }
  | 'handled'
  | undefined

/** Candidate request passed to a source; the signal is superseded on query change / menu close. */
export interface CandidateRequest {
  readonly query: string
  readonly position: TriggerPosition
  readonly signal: AbortSignal
}

/** Everything a source receives on pick. */
export interface InputTriggerPick {
  readonly candidate: InputTriggerCandidate
  readonly session: ClientSessionContext
  readonly position: TriggerPosition
  readonly via: PickVia
  readonly span: TokenSpan
}

/** One trigger source, structurally compatible with the harness contract. */
export interface InputTriggerSource {
  readonly trigger: TriggerChar
  readonly name: string
  readonly order?: number
  candidates(session: ClientSessionContext, req: CandidateRequest): Promise<readonly InputTriggerCandidate[]>
  onPick(pick: InputTriggerPick): PickOutcome
  matchSpace?(session: ClientSessionContext, token: string): PickOutcome
  matchEnter?(session: ClientSessionContext, line: string, signal: AbortSignal): Promise<PickOutcome>
  warm?(session: ClientSessionContext): void
  lexicon?(session: ClientSessionContext): readonly string[] | undefined
  subscribeLexicon?(session: ClientSessionContext, listener: () => void): () => void
  readonly codec?: unknown
}

/** The `ctx.inputTriggers` service face this plugin registers a source on. */
export interface InputTriggerService {
  registerSource(source: InputTriggerSource): () => void
}
