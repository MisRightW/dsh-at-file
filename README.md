# dsh-at-file

`@` workspace file references for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): type `@` in the web composer, pick a file from the workspace, and its content is injected into the model context when you send the prompt — no copy-paste, no extra tool round trip.

中文说明见 [README.zh.md](README.zh.md)。

## Install

```sh
dsh plugin --profile web add github:<you>/dsh-at-file
# or, from a published npm package
dsh plugin --profile web add dsh-at-file
```

The first GitHub install runs the package's `prepare` build; pnpm asks you to allow it once (copy the exact package key pnpm prints into the profile's `pnpm-workspace.yaml` under `allowBuilds`). See the [harness plugin guide](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md) for the mechanics.

## Usage

1. Open a session in the web GUI and pick a workspace directory.
2. Type `@` in the composer — a **Files** group lists workspace files (the group title shows as `file` until the harness localizes it).
3. Filter by basename (`@main`), path prefix (`@src/m`), or substring; arrow keys + Enter pick.
4. Send the prompt. Every `@path` token naming a readable regular file expands host-side into an injected `<at-file path="…">` content block appended to the model request; unresolvable or oversized tokens stay plain prose.

The literal `@path` stays in the prompt, and the injected message is recorded on the session log with an `at-file` source, so the model input is reconstructable from the log.

## How it works

| Half | Package entry | Role |
|---|---|---|
| Host | `dsh-at-file` (default) | `AtFileService` (`ctx.atFile`) exposes the `atFile` Remote namespace (`atFile.list`, addressed by session id) over a bounded workspace index; the `agent/pre-step` listener expands `@path` tokens into injected file content |
| Browser | `dsh-at-file/client` | Mounts the `atFile` namespace (`ctx.remote.$mount`) and registers the `@` trigger source that lists candidates through it |

The Remote wire contract is the hand-authored `typert/` artifact pair (the frozen `InvocationDescriptor` shape, mirroring what the harness's typert generator emits); the `dsh.bundle` manifest in `package.json` plus `cordis.patch.yml` make the package a drop-in profile bundle.

## Configuration

The host half reads a validated `Config` (patchable from the profile's `cordis.patch.yml`):

| Key | Default | Meaning |
|---|---|---|
| `maxFiles` | 1000 | Maximum index rows per list call |
| `maxDepth` | 8 | Maximum directory depth walked |
| `maxBytes` | 65536 | Per-file injection cap; larger files are not indexed |
| `maxReferences` | 8 | Maximum references expanded per pre-step |
| `skipDirectories` | `.git, node_modules, dist, build, out, coverage, __pycache__, .venv` | Directory basenames never indexed (case-insensitive) |

## Differences from the in-tree version

The harness monorepo carries an [in-tree implementation](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/at-file) that also patches two core client packages. This standalone plugin cannot:

- **Render draft chips for picked paths** — the shared chip decoration token grammar lives in the harness core; picks render as plain text (the reference still ships and expands).
- **Localize the menu group title** — the `slash.menu` dictionary lives in the harness core; the group shows the raw source name `file`.

Everything else — candidates, filtering, caching, `@path` expansion, injection bounds, logging — is identical.

## Development

```sh
pnpm install        # peer deps come from the dsh host; see pnpm-workspace.yaml
pnpm build          # tsdown → lib/index.js (host) + lib/client.js (browser)
pnpm test           # vitest: host + client suites
pnpm typecheck
```

The tests run against the published `@deepseek-ai/*` rc packages, so an API drift in a harness release surfaces here first.

## License

MIT — see [LICENSE](LICENSE).
