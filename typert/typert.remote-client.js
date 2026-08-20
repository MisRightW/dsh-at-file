/* Hand-authored twin of a @deepseek-ai/dsh-typert-generator artifact.
   dsh-at-file ships outside the harness monorepo, so the wire contract is
   authored directly against the frozen InvocationDescriptor shape rather than
   generated. Do not edit the shape; only add descriptors for new @Remote
   methods and mirror them in the .d.ts twin. */
import { z } from 'zod'

const _dsh_at_file_atFile_list_sessionId$schema = z.intersection(z.string(), z.unknown())
const _dsh_at_file_entry$schema = z.object({
  path: z.string().readonly(),
  size: z.number().readonly().optional(),
})
const _dsh_at_file_atFile_list_result$schema = z.object({
  files: z.array(_dsh_at_file_entry$schema).readonly(),
})

export const TYPERT_REMOTE = {
  package: 'dsh-at-file',
  descriptors: [
    {
      id: 'dsh-at-file#atFile/list',
      service: 'atFile',
      namespace: 'atFile',
      method: 'list',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'sessionId',
          wire: 'sessionId',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-at-file#atFile/list:sessionId',
            schema: _dsh_at_file_atFile_list_sessionId$schema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-at-file#atFile/list:result',
        schema: _dsh_at_file_atFile_list_result$schema,
      },
    },
  ],
}

export default TYPERT_REMOTE
