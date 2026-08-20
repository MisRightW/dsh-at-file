/* Hand-authored twin of a @deepseek-ai/dsh-typert-generator artifact. The
   client-side type face: merging the `atFile` namespace into the Remote map
   types `ctx.remote.atFile.list(...)` for this plugin's consumers. */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AtFileListResult } from '../lib/types/types.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$dsh_at_file {
    list: (sessionId: SessionId, signal?: AbortSignal) => Promise<RemoteResult<AtFileListResult>>
  }
  interface TypertRemoteMap {
    'atFile/list': (sessionId: SessionId, signal?: AbortSignal) => Promise<RemoteResult<AtFileListResult>>
  }
  interface TypertRemoteNamespaceMap {
    'atFile': TypertRemoteNamespace$dsh_at_file
  }
  interface TypertRemoteScopeMap {}
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
