/* Hand-authored twin of a @deepseek-ai/dsh-typert-generator artifact. The
   host face type: the typert-loader imports this manifest and registers the
   `atFile` namespace with the Typert gateway when the bundle loads. The
   contribution type is inlined (not imported) so this declaration needs no
   package beyond the bundle itself. */
import type { z } from 'zod'

export interface TypertHostInvocation {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly {
    readonly name: string
    readonly wire: string
    readonly source: 'json' | 'lookup'
    readonly codec: { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: z.ZodType }
  }[]
  readonly cancellation?: { readonly parameter: 'signal' }
  readonly result: { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: z.ZodType }
}

export declare const TYPERT: {
  readonly package: string
  readonly face: 'host'
  readonly schemas: readonly unknown[]
  readonly model: { readonly services: readonly unknown[]; readonly events: readonly unknown[]; readonly objects: readonly unknown[] }
  readonly invocations: readonly TypertHostInvocation[]
}
export default TYPERT
