/**
 * Git-install build hook. `dsh plugin add github:you/dsh-at-file` fetches
 * sources, not artifacts; pnpm runs this `prepare` script after linking so the
 * published entry points exist. Self-contained by design: it invokes the
 * package's own tsdown config, never a sibling monorepo checkout.
 */
import { execSync } from 'node:child_process'

try {
  execSync('pnpm build', { stdio: 'inherit', cwd: new URL('.', import.meta.url).pathname })
} catch (error) {
  console.error('[dsh-at-file] prepare build failed:', error)
  process.exit(1)
}
