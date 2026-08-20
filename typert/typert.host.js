/* Hand-authored twin of a @deepseek-ai/dsh-typert-generator artifact (see
   typert.remote-client.js). The host face declares the same invocation so the
   typert-loader mounts the `atFile` namespace when this bundle is loaded. */
import { z } from 'zod'

const _dsh_at_file_atFile_list_sessionId$schema = z.intersection(z.string(), z.unknown())
const _dsh_at_file_entry$schema = z.object({
  path: z.string().readonly(),
  size: z.number().readonly().optional(),
})
const _dsh_at_file_atFile_list_result$schema = z.object({
  files: z.array(_dsh_at_file_entry$schema).readonly(),
})

export const TYPERT = {
  package: 'dsh-at-file',
  face: 'host',
  schemas: [],
  model: {
    services: [],
    events: [],
    objects: [],
  },
  invocations: [
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

export default TYPERT
