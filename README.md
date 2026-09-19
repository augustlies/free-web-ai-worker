# Agent Web AI — 主 Agent 的免费文本子任务执行层

让 Codex / Cline / dsh 等主 Agent 把**只产生文本结果的小任务**外包给网页版免费 AI，
拿回纯文本后继续执行原任务。主模型因此省下 Token、API 费用和上下文空间。

```
主 Agent → ask_web_ai(prompt) → 真实 Chrome → 网页版 AI → 纯文本答案 → 主 Agent 继续
```

**当前状态：MVP 已跑通。** 在 Windows + Chrome 153 上实测完成
`Agent → Skill → 浏览器 → Duck.ai / Qwen → 提问 → 获取回答 → 返回 JSON` 全链路。

---

## 1. 先调研，再决定复用（本项目实际做法）

开发前按要求先搜索了 GitHub 上的成熟项目，结论如下：

| 项目 | 许可证 | 与本项目的关系 | 我们的处理 |
|---|---|---|---|
| [ToaruPen/Cavendish](https://github.com/ToaruPen/Cavendish) | ISC | Playwright + CDP 驱动系统 Chrome、持久 profile、选择器漂移检测、`doctor` 诊断 | **借鉴架构**（CDP + 持久 profile + 选择器集中管理），未直接依赖：它专为 ChatGPT 付费版设计 |
| [ljie-PI/web-chat](https://github.com/ljie-PI/web-chat) | MIT | OpenClaw skill：Playwright 连接已启动 Chrome，向 Gemini/ChatGPT 提问并提取回答 | **借鉴思路**（复用用户已登录的 Chrome、稳定轮询），未直接依赖：仅支持 2 家、无 Provider 抽象 |
| [mrshibly/PhantomAPI](https://github.com/mrshibly/PhantomAPI) | MIT | 把 ChatGPT 网页版包装成 OpenAI 兼容 API | 参考其响应等待逻辑；本项目定位不同（子任务委派而非 API 代理） |
| [STAR-173/LLMSession-Docker](https://github.com/STAR-173/LLMSession-Docker) | MIT | Docker 内驱动网页 LLM 会话 | 未采用：容器 + 无头模式在多数站点会触发人机验证 |

**结论**：没有现成项目同时满足「多 Provider 抽象 + Skill 形态 + 复用用户真实登录态 + 不绕过风控」，
因此在借鉴上述实现的基础上自建本仓库，把工作量集中在**上层接口、Provider 抽象与错误契约**上。

依赖方面只使用 `playwright-core`（MIT）—— 直接驱动系统已安装的 Chrome，不额外下载浏览器内核。

---

## 2. 快速开始

### 环境要求

- Windows / macOS / Linux
- Node.js ≥ 20（实测 24.12）
- Google Chrome 或 Microsoft Edge（本机会自动探测常见安装路径）

```bash
npm install          # 只装 playwright-core，不下载浏览器
npm test             # 10 个单元测试，不需要浏览器
```

### 第一次运行（跑通链路）

```bash
# 1) 看环境
node bin/ask-web-ai.js status

# 2) 零登录 Provider，直接问
node bin/ask-web-ai.js ask "请用三句话解释什么是板块构造。" --json

# 3) 用测试脚本验证
npm run test:e2e
```

第一次运行会**自动启动一个专用 Chrome 窗口**（profile 存在 `~/.agent-web-ai/chrome-profile`，
与你的日常 Chrome 完全隔离，不影响你原来的登录状态）。

### 需要人工操作的步骤（仅一次）

使用 Gemini / DeepSeek / ChatGPT / Grok 这类需要账号的站点时：

```bash
node bin/ask-web-ai.js login --provider gemini   # 弹出专用 Chrome 窗口
# → 你在那个窗口里正常登录（账号密码/扫码都由你本人操作）
# → 登录完成后回到终端按 Enter
node bin/ask-web-ai.js ask "测试" -p gemini --json
```

登录状态保存在专用 profile 中，**之后每次调用都会复用，不需要重复登录**。

**如果出现人机验证（CAPTCHA）**：工具会返回 `captcha_required`。请打开那个 Chrome
窗口手动完成验证，再重新执行同一条命令。本项目**不会、也不会尝试**自动破解验证码。

**如果出现 `access_blocked`**：说明该站点判定当前网络异常（例如 Google 的
`google.com/sorry` 页面）。工具不会绕过它，请稍后重试或换一个 Provider。

---

## 3. 接入方式

### 方式 A：CLI（任何 Agent 都能用）

```bash
# stdout 是纯 JSON，可直接 parse；日志全部走 stderr
node bin/ask-web-ai.js ask "<prompt>" --provider duckai --timeout 120 --json

# 长文本不吃 shell 转义
node bin/ask-web-ai.js ask --file ./subtask.txt -p duckai --json
cat notes.md | node bin/ask-web-ai.js ask --stdin -p duckai --json
```

### 方式 B：MCP（Cline / dsh / Claude Desktop 等）

在 MCP 客户端里配置：

```json
{
  "mcpServers": {
    "agent-web-ai": {
      "command": "node",
      "args": ["D:/AI Playground/WebAITool/src/mcp-server.js"]
    }
  }
}
```

提供一个工具：`ask_web_ai({ prompt, provider?, timeout_ms? })`。

### 方式 C：Codex Skill

把 `skills/agent-web-ai/` 拷到你的 skills 目录（或直接把本仓库当作 skill 目录），
主 Agent 会在遇到「纯文本小任务」时自动使用它。

### 方式 D：作为 Node 模块

```js
import { askWebAI } from './src/core/ask.js';

const r = await askWebAI({ prompt: '把这段总结成三句话：…', provider: 'duckai' });
if (r.status === 'success') console.log(r.answer);
```

---

## 4. 返回契约

成功：

```json
{
  "status": "success",
  "provider": "duckai",
  "answer": "板块构造是指……",
  "meta": { "url": "https://duck.ai/", "chars": 94, "elapsedMs": 9763, "truncated": false }
}
```

失败（**永远不抛裸异常，永远给结构化 JSON**）：

```json
{
  "status": "error",
  "provider": "deepseek",
  "error": "DeepSeek is not signed in. …",
  "code": "login_required",
  "details": { "url": "https://chat.deepseek.com/sign_in" },
  "meta": { "artifacts": ".../artifacts/2026-09-19T10-06-35-deepseek" }
}
```

| code | 含义 | 处理方式 |
|---|---|---|
| `invalid_input` | prompt 为空 / 参数非法 | 修正调用 |
| `unknown_provider` | provider 名不存在 | 用 `providers` 命令查看 |
| `provider_disabled` | 配置里被禁用 | 修改 `config/local.json` |
| `login_required` | 站点未登录 | 跑一次 `login --provider X` |
| `captcha_required` | 出现人机验证 | **人工**在弹出的窗口完成验证后重试 |
| `access_blocked` | 网络被站点限流/风控 | 稍后重试或换 Provider |
| `selectors_stale` | 页面改版，选择器失效 | 看截图，更新 `src/providers/*.js` 的选择器 |
| `timeout` | 超时未得到稳定回答 | 加大 `--timeout`，看产物截图 |
| `browser_unavailable` | Chrome/CDP 起不来 | 跑 `status`；首次启动较慢 |
| `extraction_failed` | 有回答但提取为空 | 看截图；通常是要新增选择器 |
| `internal_error` | 其他 | 看 stderr 日志 |

---

## 5. 支持的 Provider（可插拔）

| provider | 登录 | 实测状态 |
|---|---|---|
| `duckai` | 不需要 | ✅ 端到端通过（约 9–10s） |
| `qwen` | 不需要（游客模式可用） | ✅ 端到端通过（约 35s，含页面加载） |
| `gemini` | 需要 | ⚠️ 本机网络被 Google 判定异常流量，已正确返回 `access_blocked`；选择器已按真实 DOM 校准 |
| `deepseek` | 需要 | ⚠️ 未登录，已正确返回 `login_required` |
| `chatgpt` | 需要 | 选择器参考 Cavendish 基线；未在本机实测（需付费账号） |
| `grok` | 需要 | 结构已接入；未实证 |

新增一个 Provider：

1. 新建 `src/providers/<id>.js`，继承 `WebAIProvider`，实现
   `isLoggedIn` / `findInput` / `submit`(可选) / `extractAnswer`(可选)；
2. 在 `config/default.json` 的 `providers.<id>` 加配置；
3. 在 `src/providers/index.js` 注册。

其余（超时、稳定性轮询、错误契约、日志、失败截图）全部继承，无需重写。

---

## 6. 故障排查「如何查看失败原因」

任何失败都会自动在 profile 目录下留证据：

```
~/.agent-web-ai/chrome-profile/artifacts/<时间>-<provider>/
├── screenshot.png    失败瞬间的页面截图
├── page.html         完整 HTML（用于更新选择器）
└── summary.json      页面文本、URL、错误码、捕获时间
```

路径会直接出现在返回 JSON 的 `meta.artifacts` 字段里。

其他命令：

```bash
node bin/ask-web-ai.js status      # Chrome 路径 / CDP 连接 / profile / 默认 provider
node bin/ask-web-ai.js providers   # 列出 provider 与登录要求
node bin/ask-web-ai.js ask "x" -p duckai --dry-run   # 只校验配置，不开浏览器
```

日志级别：`--log-level debug` 能看到每一步选择器匹配情况。

---

## 7. 配置

`config/default.json` 是默认值，机器专属改动放 `config/local.json`（已 gitignore）：

```bash
cp config/local.json.example config/local.json
```

可用环境变量覆盖：`AWA_PROVIDER`、`AWA_TIMEOUT_MS`、`AWA_HEADLESS`、
`AWA_BROWSER_PORT`、`AWA_CHROME_PATH`、`AWA_PROFILE_DIR`、`AWA_LOG_LEVEL`。

---

## 8. 设计原则

1. **不绕过任何安全机制。** 不破解接口、不破解验证码、不伪造登录、不规避限流。
   遇到人工环节就以 `login_required` / `captcha_required` 返回，交给人。
2. **用真实浏览器 + 真实登录态。** 专用 Chrome profile 通过 CDP 复用，
   不干扰用户日常浏览器。
3. **主 Agent 只看到两个东西**：`ask_web_ai(prompt, provider)` 和一个结构化结果。
4. **失败可诊断。** 每个错误都有稳定 code；每次失败都有截图和 HTML。
5. **不过度设计。** 无数据库、无服务端、无队列；一个 Node 进程按需启动/复用 Chrome。

---

## 9. 已知限制

- **UI 选择器会随网站改版失效**。这才是这套方案最大的维护成本。
  已通过「多选择器回退 + 失败截图 + `selectors_stale` 错误码」降低影响。
- **无头模式在多个站点会触发风控**。因此默认使用有头窗口（`headless: false`）。
  这意味着运行时会有一个 Chrome 窗口在前台或后台运行。
- **回答提取依赖「内容稳定」判断**，极长回答可能触达超时；
  可用 `--timeout` 调整。
- **Gemini 在本机网络被 Google 限流**，需要网络环境变化或等待解除才能实测。
- **ChatGPT / Grok 未在本机实测**（需要相应付费账号）。
- **并发**：多次调用会各开一个标签页，但共用同一个 profile；
  不建议超过 2–3 个并发。
- **不保证回答正确性**。网页 AI 会幻觉，安全关键结果必须由主 Agent 或人复核。

---

## 10. 下一阶段（尚未实现）

- **Task Router**：主 Agent 之前加一层判断，自动区分「复杂任务→主模型」与
  「简单文本任务→Web AI」，并按任务类型选 Provider、按成本/速度排序。
- **结果缓存**：相同 prompt 指纹命中缓存，直接返回，省一次浏览器往返。
- **批量接口**：`askWebAIBatch([{prompt}, …])` 复用一次会话，减少标签页开销。
- **Provider 健康检查**：启动时快速探测各站点可用性，自动挑可用的那个。
- **选择器自检**：定时跑 `doctor`，选择器失效时提前告警（参考 Cavendish 的 `report`）。
- **更多 Provider**：Kimi、Z.ai、Copilot 等已确认可访问，可按同一接口接入。
- **文件型子任务**：把长文本自动分块后分批委派。

---

## 11. 项目结构

```
bin/ask-web-ai.js          CLI 入口
src/core/ask.js            唯一对外入口 askWebAI()（返回结构化结果，不抛裸异常）
src/core/browser.js        Chrome 启动 / CDP 复用 / profile 管理
src/core/provider.js       Provider 基类：超时、稳定性轮询、通用提取
src/core/config.js         配置加载（default → local → env → 参数）
src/core/errors.js         错误类型与稳定错误码
src/core/logger.js         日志（全部走 stderr，stdout 留给 JSON）
src/core/artifacts.js      失败取证：截图 / HTML / 摘要
src/providers/*.js         各 Web AI 的站点适配（可插拔）
src/mcp-server.js          无依赖 MCP stdio 服务
skills/agent-web-ai/       给 Codex / Cline 等使用的 Skill 定义
scripts/probe-*.mjs        开发期选择器探测工具
tests/unit.test.js         10 个离线单元测试
tests/e2e.live.js          真实链路测试
```

## 12. 许可证

本仓库代码：MIT。使用的第三方项目许可见第 1 节表格
（Cavendish: ISC，web-chat / PhantomAPI / LLMSession-Docker: MIT，playwright-core: Apache-2.0）。

