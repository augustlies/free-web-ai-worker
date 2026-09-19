# Agent Web AI — 主 Agent 的免费文本子任务执行层

让 Codex / Cline / dsh 等主 Agent 把**只产生文本结果的小任务**外包给网页版免费 AI，
拿回纯文本后继续执行原任务。主模型因此省下 Token、API 费用和上下文空间。

```
主 Agent → ask_web_ai(prompt) → 你自己的 Edge 浏览器 → 网页版 AI → 纯文本答案 → 主 Agent 继续
```

**当前状态：MVP 已跑通，浏览器已切换为 Edge。**
在 Windows + Microsoft Edge 153 上实测完成
`Agent → Skill → Edge → Duck.ai / Qwen → 提问 → 获取回答 → 返回 JSON` 全链路，
单次问答约 **9–10 秒**。

> 浏览器偏好：**Microsoft Edge**（可在配置里换成 Chrome）。
> 已按需求**移除 Gemini**（`providers.gemini.enabled = false`）。

---

## 1. 先调研，再决定复用（本项目实际做法）

开发前按要求先搜索了 GitHub 上的成熟项目，结论如下：

| 项目 | 许可证 | 与本项目的关系 | 我们的处理 |
|---|---|---|---|
| [ToaruPen/Cavendish](https://github.com/ToaruPen/Cavendish) | ISC | Playwright + CDP 驱动系统浏览器、持久 profile、选择器漂移检测 | **借鉴架构**（CDP + 持久 profile + 选择器集中管理），未直接依赖：它专为 ChatGPT 付费版设计 |
| [ljie-PI/web-chat](https://github.com/ljie-PI/web-chat) | MIT | OpenClaw skill：Playwright 连接已启动的浏览器，向网页 AI 提问并提取回答 | **借鉴思路**（复用用户已登录的浏览器、稳定轮询），未直接依赖：仅支持 2 家、无 Provider 抽象 |
| [mrshibly/PhantomAPI](https://github.com/mrshibly/PhantomAPI) | MIT | 把 ChatGPT 网页版包装成 OpenAI 兼容 API | 参考其响应等待逻辑；本项目定位不同（子任务委派而非 API 代理） |
| [STAR-173/LLMSession-Docker](https://github.com/STAR-173/LLMSession-Docker) | MIT | Docker 内驱动网页 LLM 会话 | 未采用：容器 + 无头模式在多数站点会触发人机验证 |

**结论**：没有现成项目同时满足「多 Provider 抽象 + Skill 形态 + 复用真实登录态 + 不绕过风控」，
因此在借鉴上述实现的基础上自建本仓库，把工作量集中在**上层接口、Provider 抽象与错误契约**上。

依赖方面只使用 `playwright-core`（MIT）—— 直接驱动你已安装的 Edge，不额外下载浏览器内核。

---

## 2. 快速开始

### 环境要求

- Node.js ≥ 20（实测 24.12）
- **Microsoft Edge**（本机已检测到）；也支持 Google Chrome

```bash
npm install          # 只装 playwright-core，不下载浏览器
npm test             # 10 个单元测试，不需要浏览器
```

### 第一次运行（跑通链路）

```bash
# 1) 看环境（会告诉你是用 Edge 还是 Chrome）
node bin/ask-web-ai.js browser

# 2) 零登录的 AI，直接问
node bin/ask-web-ai.js ask "请用三句话解释什么是板块构造。"

# 3) 用测试脚本验证
npm run test:e2e
```

第一次运行会**自动打开一个专用的 Edge 窗口**（独立账号档案，存在
`~/.agent-web-ai/profiles/edge`，和你平时用的 Edge 完全隔离，不影响你原来的浏览记录和登录状态）。

### 需要人工操作的步骤（仅一次）

Duck.ai 和 Qwen **不需要登录**，可以直接用。使用 DeepSeek / ChatGPT / Grok 时：

```bash
node bin/ask-web-ai.js login --provider deepseek   # 弹出专用 Edge 窗口
# → 你在那个窗口里正常登录（账号密码/扫码都由你本人操作）
# → 登录完成后回到终端按 Enter
node bin/ask-web-ai.js ask "测试" -p deepseek
```

登录状态保存在专用档案里，**之后每次调用都会自动复用，不需要重复登录**。

**如果出现人机验证（CAPTCHA）**：工具会返回 `captcha_required`，
请在那个 Edge 窗口里手动完成验证，再重新执行同一条命令。
本项目**不会、也不会尝试**自动破解验证码。

**如果出现 `access_blocked`**：说明该网站判定当前网络异常。
工具不会绕过它，请稍后重试或换个 AI。

---

## 3. 常用命令（人话版）

```bash
node bin/ask-web-ai.js browser                 # 我现在用的是哪个浏览器？
node bin/ask-web-ai.js browser --use edge      # 切换到 Edge
node bin/ask-web-ai.js browser --use chrome    # 切换到 Chrome
node bin/ask-web-ai.js browser --stop          # 关掉工具开的那个浏览器窗口

node bin/ask-web-ai.js providers               # 有哪些 AI 可以用？
node bin/ask-web-ai.js status                  # 整体状态

node bin/ask-web-ai.js ask "问题"                          # 问一句（默认 Duck.ai）
node bin/ask-web-ai.js ask "问题" -p qwen                  # 换 Qwen
node bin/ask-web-ai.js ask "问题" --text                   # 直接看答案，不要 JSON
node bin/ask-web-ai.js ask "问题" --log-level debug        # 出问题时看详细过程
```

---

## 4. 接入方式

### 方式 A：CLI（任何 Agent 都能用）

```bash
# stdout 是纯 JSON，可直接 parse；日志全部走 stderr
node bin/ask-web-ai.js ask "<prompt>" --json

# 长文本不吃 shell 转义
node bin/ask-web-ai.js ask --file ./subtask.txt --json
cat notes.md | node bin/ask-web-ai.js ask --stdin --json
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

把 `skills/agent-web-ai/` 拷到你的 skills 目录（或直接把本仓库当作 skill 目录）。

### 方式 D：作为 Node 模块

```js
import { askWebAI } from './src/core/ask.js';

const r = await askWebAI({ prompt: '把这段总结成三句话：…', provider: 'duckai' });
if (r.status === 'success') console.log(r.answer);
```

---

## 5. 返回契约

成功：

```json
{
  "status": "success",
  "provider": "duckai",
  "answer": "板块构造是指……",
  "meta": { "url": "https://duck.ai/", "chars": 81, "elapsedMs": 9490, "truncated": false }
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
  "meta": { "artifacts": ".../artifacts/2026-09-19T12-01-37-duckai" }
}
```

| code | 含义 | 处理方式 |
|---|---|---|
| `invalid_input` | prompt 为空 / 参数非法 | 修正调用 |
| `unknown_provider` | provider 名不存在 | 用 `providers` 命令查看 |
| `provider_disabled` | 配置里被禁用（如 Gemini） | 修改 `config/local.json` |
| `login_required` | 网站未登录 | 跑一次 `login --provider X` |
| `captcha_required` | 出现人机验证 | **人工**在弹出的窗口完成验证后重试 |
| `access_blocked` | 网络被网站限流/风控 | 稍后重试或换 AI |
| `selectors_stale` | 网站改版，选择器失效 | 看截图，更新 `src/providers/*.js` |
| `timeout` | 超时未得到稳定回答 | 加大 `--timeout`，看产物截图 |
| `browser_unavailable` | 浏览器起不来 | 跑 `browser`；首次启动较慢 |
| `extraction_failed` | 有回答但提取为空 | 看截图；通常是要新增选择器 |
| `internal_error` | 其他 | 看 stderr 日志 |

---

## 6. 支持的 Web AI

| provider | 需要登录？ | 实测状态 |
|---|---|---|
| `duckai` | 不需要 | ✅ **默认**，Edge 上端到端通过，约 9–10 秒 |
| `qwen` | 不需要（游客模式） | ✅ Edge 上端到端通过，约 34 秒（含页面加载） |
| `deepseek` | 需要 | ⚠️ 未登录，已能正确返回 `login_required` |
| `chatgpt` | 需要 | 选择器参考 Cavendish 基线；未在本机实测（需付费账号） |
| `grok` | 需要 | 结构已接入；未实证 |
| ~~`gemini`~~ | — | ❌ **已禁用** |

新增一个 Web AI：

1. 新建 `src/providers/<id>.js`，继承 `WebAIProvider`；
2. 在 `config/default.json` 的 `providers.<id>` 加配置；
3. 在 `src/providers/index.js` 注册。

其余（超时、稳定性轮询、错误契约、日志、失败截图）全部继承，无需重写。

---

## 7. 故障排查「如何查看失败原因」

任何失败都会自动留证据：

```
~/.agent-web-ai/profiles/edge/artifacts/<时间>-<provider>/
├── screenshot.png    失败瞬间的页面截图
├── page.html         完整 HTML（用于更新选择器）
└── summary.json      页面文本、URL、错误码、捕获时间
```

路径会直接出现在返回 JSON 的 `meta.artifacts` 字段里。

---

## 8. 配置

`config/default.json` 是默认值，机器专属改动放 `config/local.json`（已 gitignore）：

```bash
cp config/local.json.example config/local.json
```

关键项：

- `browser.preferred`：`edge`（默认）或 `chrome`
- `browser.headless`：保持 `false`
- `defaults.provider`：默认 AI
- `defaults.timeoutMs`：超时毫秒数
- `providers.<id>.enabled`：开关某个 AI

环境变量覆盖：`AWA_PROVIDER`、`AWA_TIMEOUT_MS`、`AWA_BROWSER_PORT`、
`AWA_CHROME_PATH`、`AWA_PROFILE_DIR`、`AWA_LOG_LEVEL`。

---

## 9. 设计原则

1. **不绕过任何安全机制。** 不破解接口、不破解验证码、不伪造登录、不规避限流。
   遇到人工环节就以 `login_required` / `captcha_required` 返回，交给人。
2. **用你自己的浏览器 + 你自己的登录态。** 专用 Edge 档案通过 CDP 复用，
   不干扰你日常的 Edge 窗口。
3. **主 Agent 只看到两个东西**：`ask_web_ai(prompt, provider)` 和一个结构化结果。
4. **失败可诊断。** 每个错误都有稳定 code；每次失败都有截图和 HTML。
5. **不过度设计。** 无数据库、无服务端、无队列。

---

## 10. 已知限制

- **网站改版会导致选择器失效**。已通过「多选择器回退 + 失败截图 + `selectors_stale` 错误码」降低影响。
- **默认使用可见窗口**（不用无头模式），因为无头模式在多个网站会触发风控。
  运行时会有一个 Edge 窗口在后台。
- **回答提取依赖「内容稳定」判断**，极长回答可能触达超时；可用 `--timeout` 调整。
- **ChatGPT / Grok 未在本机实测**（需要相应账号）。
- **并发**：多次调用各开一个标签页，共用同一档案；不建议超过 2–3 个并发。
- **不保证回答正确性**。网页 AI 会幻觉，重要结果必须复核。

---

## 11. 下一阶段（尚未实现）

- **Task Router**：自动区分「复杂任务→主模型」与「简单文本任务→Web AI」。
- **结果缓存**：相同 prompt 命中缓存，省一次浏览器往返。
- **批量接口**：一次会话里连续处理多条，减少标签页开销。
- **Provider 健康检查**：启动时探测各网站可用性，自动挑可用的那个。
- **选择器自检**：定时跑 `doctor`，提前发现改版失效。
- **更多 Provider**：Kimi、Z.ai、Copilot 等。

---

## 12. 项目结构

```
bin/ask-web-ai.js          CLI 入口
src/core/ask.js            唯一对外入口 askWebAI()
src/core/browser.js        Edge/Chrome 探测、启动、CDP 复用、切换、关闭
src/core/provider.js       Provider 基类：超时、轮询、键盘输入、通用提取
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

## 13. 许可证

本仓库代码：MIT。使用的第三方项目许可见第 1 节表格
（Cavendish: ISC，web-chat / PhantomAPI / LLMSession-Docker: MIT，playwright-core: Apache-2.0）。
