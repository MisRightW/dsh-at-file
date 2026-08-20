# dsh-at-file

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `@` 工作区文件引用插件：在 Web 编辑器中输入 `@` 选择工作区文件，发送提示词时其内容会被注入模型上下文——无需复制粘贴，也无需额外的工具往返。

English: [README.md](README.md)。

## 安装

```sh
dsh plugin --profile web add github:MisRightW/dsh-at-file
# 或直接使用 git URL
dsh plugin --profile web add https://github.com/MisRightW/dsh-at-file.git
# 或从已发布的 npm 包安装
dsh plugin --profile web add dsh-at-file
```

首次从 GitHub 安装会运行包的 `prepare` 构建；pnpm 会要求你允许一次（把 pnpm 打印的包 key 复制到 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下）。机制详见 [官方插件指南](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md)。

## 使用

1. 在 Web GUI 打开会话并选择工作区目录。
2. 在输入框输入 `@` —— 出现「Files」分组列出工作区文件（在宿主本地化该标题前显示为 `file`）。
3. 按 basename（`@main`）、路径前缀（`@src/m`）或子串过滤；方向键 + Enter 选择。
4. 发送提示词。每个命名可读常规文件的 `@path` token 都会在宿主侧展开为追加到模型请求的 `<at-file path="…">` 内容块；不可解析或超限的 token 保持普通文本。

`@path` 字面量保留在提示词中，注入消息以 `at-file` source 记入会话日志，因此模型输入可从日志重建。

## 工作原理

| 半部 | 包入口 | 职责 |
|---|---|---|
| 宿主 | `dsh-at-file`（默认） | `AtFileService`（`ctx.atFile`）通过 `atFile` Remote 命名空间暴露 `atFile.list`（以会话 id 寻址）与有界工作区索引；`agent/pre-step` 监听器把 `@path` token 展开为注入的文件内容 |
| 浏览器 | `dsh-at-file/client` | 挂载 `atFile` 命名空间（`ctx.remote.$mount`）并注册 `@` 触发源，通过它列出候选 |

Remote 线缆契约是手写的 `typert/` 产物对（冻结的 `InvocationDescriptor` 形状，与宿主 typert 生成器的输出一致）；`package.json` 的 `dsh.bundle` manifest 与 `cordis.patch.yml` 使本包成为即插即用的 profile bundle。

## 配置

宿主半部读取经过校验的 `Config`（可从 profile 的 `cordis.patch.yml` 覆盖）：

| 键 | 默认 | 含义 |
|---|---|---|
| `maxFiles` | 1000 | 每次 list 的最大索引行数 |
| `maxDepth` | 8 | 遍历的最大目录深度 |
| `maxBytes` | 65536 | 单文件注入上限；更大的文件不入索引 |
| `maxReferences` | 8 | 每步最多展开的引用数 |
| `skipDirectories` | `.git, node_modules, dist, build, out, coverage, __pycache__, .venv` | 永不索引的目录 basename（不区分大小写） |

## 与仓库内版本的区别

主仓库带有一份[仓库内实现](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/at-file)，它同时改动两个核心 client 包。本独立插件无法：

- **为 pick 的路径渲染草稿 chip** —— 共享 chip 装饰 token 语法位于宿主核心；pick 以纯文本呈现（引用仍然发出并展开）。
- **本地化菜单组标题** —— `slash.menu` 字典位于宿主核心；分组显示原始 source 名 `file`。

其余一切——候选、过滤、缓存、`@path` 展开、注入上限、日志——完全一致。

## 开发

```sh
pnpm install        # peer 依赖由 dsh 宿主提供；见 pnpm-workspace.yaml
pnpm build          # tsdown → lib/index.js（宿主）+ lib/client.js（浏览器）
pnpm test           # vitest：宿主 + 浏览器测试
pnpm typecheck
```

测试针对已发布的 `@deepseek-ai/*` rc 包运行，因此宿主发布带来的 API 漂移会先在这里暴露。

## License

MIT — 见 [LICENSE](LICENSE)。
