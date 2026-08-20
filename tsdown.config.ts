import { defineConfig } from 'tsdown'

/**
 * One build emits both halves: the Node host plugin (index/invariant) and the
 * browser client plugin (client). The typert host/remote artifacts under
 * `typert/` are committed static contracts, not rebuilt here.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/client/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  outDir: 'lib',
  clean: true,
  fixedExtension: false,
  dts: true,
})
