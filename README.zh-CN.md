# free-web-ai-worker

**让你的 AI 编程 Agent 把简单的文本子任务外包给网页版免费 AI。**

主模型把上下文和 Token 留给真正困难的部分。那些枯燥的文本活 —— 总结、翻译、
分类、提取、改写 —— 交给网页版免费 AI 去干，只把纯文本答案收回来。

```
主 Agent -> ask_web_ai(prompt) -> 你自己的 Edge/Chrome -> 网页 AI -> 纯文本 -> 主 Agent 继续
```

不需要 API Key，不按 Token 计费，也不额外下载浏览器内核 —— 它直接驱动你已经装好的
Edge 或 Chrome，通过**独立隔离的档案**复用你自己的登录状态。

[English README](README.md)

![通过 free-web-ai-worker 向 Duck.ai 提问](docs/screenshot-answer.png)

---

## 为什么不直接用官方 API？

因为 Agent 的大部分工作不配用顶级模型。

| | 主模型自己干 | 交给本工具 |
|---|---|---|
| 单次成本 | 真金白银，按 Token 计费 | 免费（复用你已有的网页版访问权） |
| 对上下文的影响 | 占用主 Agent 的上下文窗口 | 零占用 —— 只有最终文本回传 |
| 适合 | 推理、写代码、多步任务 | 总结 / 翻译 / 分类 / 提取 |

**把贵的模型用在真正需要它的地方。**

---

## 和其它同类项目的区别

市面上已经有能自动化网页 AI 的工具。下面是诚实的对比 —— 按你的需求选合适的那一个。

| | **free-web-ai-worker** | [Cavendish](https://github.com/ToaruPen/Cavendish) | [web-chat](https://github.com/ljie-PI/web-chat) | [PhantomAPI](https://github.com/mrshibly/PhantomAPI) |
|---|---|---|---|---|
| **定位** | 让 Agent 把**子任务**外包出去 | 用命令行驱动 ChatGPT Pro | Skill 里问 Gemini/ChatGPT | 把 ChatGPT 包装成 OpenAI 兼容 API |
| **支持站点** | 5 家（可插拔） | 1 家（ChatGPT，硬编码） | 2 家 | 1 家 |
| **Provider 抽象** | 有 —— 加一个站点只改一个文件 | 无 | 无 | 无 |
| **接口形态** | CLI + MCP + Skill + Node 模块 | CLI | Skill | HTTP API |
| **防封号保护** | 有 —— 间隔/冷却/配额/熔断/缓存 | 无 | 无 | 无 |
| **长任务 / 附件** | 无 | 有 | 无 | 无 |
| **许可证** | MIT | ISC | MIT | MIT |

**如果你需要**深度研究、文件附件、ChatGPT Pro 特性 —— 用 Cavendish。
**如果你需要**给 n8n 提供 OpenAI 兼容端点 —— 用 PhantomAPI。
**如果你想要**让 Agent 把小的文本任务交给手边可用的免费网页 AI，同时不希望账号被风控盯上
—— 那就是本项目。

---

## 安装

需要 **Node.js >= 20**，以及 **Microsoft Edge 或 Google Chrome**。

```bash
# 直接从 GitHub 运行 —— 无需安装，也无需先发布到 npm
npx -y github:augustlies/free-web-ai-worker ask "回答 OK" --json

# 或者克隆到本地运行
git clone https://github.com/augustlies/free-web-ai-worker.git
cd free-web-ai-worker
npm install
node bin/ask-web-ai.js ask "回答 OK" --json
```

> npm 包名 `free-web-ai-worker` 与发布配置已就绪，但**尚未发布**。
> 请先用上面的 `npx github:` 形式，或从克隆的副本运行。

### 60 秒冒烟测试

```bash
node bin/ask-web-ai.js browser          # 会用哪个浏览器？
node bin/ask-web-ai.js providers        # 有哪些网页 AI 可用
node bin/ask-web-ai.js ask "请用三句话解释什么是板块构造。" --json
```

首次运行会打开一个**专用的** Edge/Chrome 窗口，使用独立档案
（`~/.agent-web-ai/profiles/<browser>`）。你日常浏览器的窗口、历史和登录状态完全不受影响。

`duckai` 和 `qwen` 不需要账号。其余需要登录的，做一次即可：

```bash
node bin/ask-web-ai.js login --provider deepseek   # 在弹出窗口里正常登录
node bin/ask-web-ai.js ask "测试" -p deepseek --json
```

登录状态保存在专用档案里，之后自动复用。

---

## 接入你的 Agent

### 1. CLI（任何能执行命令的 Agent 都能用）

```bash
ask-web-ai ask "<prompt>" --json                      # stdout 是纯 JSON
ask-web-ai ask --file ./subtask.txt --json            # 长文本避免转义问题
cat notes.md | ask-web-ai ask --stdin --json          # 管道输入
```

日志全部走 **stderr**，因此 `stdout` 可以直接 `JSON.parse`。

### 2. MCP（Cline、dsh、Claude Desktop 等）

```json
{
  "mcpServers": {
    "free-web-ai-worker": {
      "command": "node",
      "args": ["<仓库路径>/src/mcp-server.js"]
    }
  }
}
```

暴露一个工具：`ask_web_ai({ prompt, provider?, timeout_ms? })`。

### 3. Codex / Agent Skill

把 `skills/free-web-ai-worker/` 拷进你的 skills 目录，或让 Agent 指向本仓库。
Skill 内部使用 `npx github:` 形式，因此该文件夹可以**单独使用**，不依赖本地克隆。

### 4. Node 模块

```js
import { askWebAI } from 'free-web-ai-worker';

const result = await askWebAI({ prompt: '把这段总结成三句话：……', provider: 'duckai' });
if (result.status === 'success') console.log(result.answer);
```

---

## 支持的网页 AI

| Provider | 是否需要登录 | 状态 |
|---|---|---|
| `duckai` | 不需要 | **已验证** —— 端到端通过，约 9-10 秒 |
| `qwen` | 不需要（游客模式） | **已验证** —— 端到端通过，约 34 秒 |
| `deepseek` | 需要 | **已验证** —— 已登录档案下端到端通过 |
| `chatgpt` | 需要 | 仅有选择器，未用付费账号验证 |
| `grok` | 需要 | 实验性 —— 选择器未验证 |
| `gemini` | 需要 | 实验性 —— 选择器未验证，默认禁用 |

新增一个 Provider 只需一个文件：在 `src/providers/<id>.js` 继承 `WebAIProvider`，
在 `config/default.json` 里加配置，再在 `src/providers/index.js` 注册。
超时、回答轮询、错误契约、日志、失败取证全部自动继承。

实验性 Provider **默认禁用**。想试的话：

```json
// config/local.json
{ "providers": { "gemini": { "enabled": true } } }
```

---

## 防封号保护

本工具是通过你自己已登录的浏览器与网站对话的。这是一种"特权"，
这层保护的存在就是为了不让它看起来像滥用。

| 保护层 | 默认值 | 作用 |
|---|---|---|
| 最小间隔 | **20 秒**（+0-8 秒抖动） | 同一站点的两次调用绝不背靠背发生 |
| 批量冷却 | 每 **8** 次 → 休息 **3 分钟** | 打断长时间连续节奏 |
| 每日上限 | **40** 次/每站点 | 24 小时滚动上限 |
| 熔断 | **30 分钟** | 出现验证码或访问被封时自动触发 |
| 答案缓存 | 1 小时 | 相同问题绝不会再次到达网站 |

等待回答期间的页面轮询也刻意做得**更慢且不规律**（基础间隔的 1.2-2.4 倍）以降低请求量。

这是**减少请求量**，不是伪装躲避检测。本工具不破解验证码、不伪造登录、
不试图绕过任何限流。网站要求人工介入时，它会把这一步交还给你。

```bash
ask-web-ai limits      # 今日用量 vs 各项上限
ask-web-ai cache       # 缓存状态；--clear 清空
```

真有大批量需求，请改用对应厂商的官方 API —— 本工具是为"偶尔委托"设计的，
不是为吞吐量设计的。

---

## 返回契约

成功：

```json
{
  "status": "success",
  "provider": "duckai",
  "answer": "板块构造是指……",
  "meta": { "url": "https://duck.ai/", "chars": 95, "elapsedMs": 9276, "cached": false }
}
```

失败 —— 永远是结构化输出，永远带稳定的 `code`：

```json
{
  "status": "error",
  "provider": "deepseek",
  "error": "DeepSeek is not signed in. ...",
  "code": "login_required",
  "details": { "url": "https://chat.deepseek.com/sign_in" },
  "meta": { "artifacts": "~/.agent-web-ai/profiles/edge/artifacts/..." }
}
```

| 错误码 | 含义 | 处理方式 |
|---|---|---|
| `invalid_input` | prompt 为空或参数非法 | 修正调用 |
| `unknown_provider` | provider 名不存在 | 用 `providers` 查看 |
| `provider_disabled` | 配置中已禁用 | 在 `config/local.json` 启用 |
| `login_required` | 站点未登录 | 执行一次 `login --provider <id>` |
| `captcha_required` | 出现人机验证 | 在可见窗口中自行完成，然后重试 |
| `access_blocked` | 网络被站点限流 | 稍后重试，或换 Provider |
| `selectors_stale` | 页面改版 | 看失败截图，更新选择器 |
| `timeout` | 超时未得到稳定回答 | 加大 `--timeout`，查看取证 |
| `browser_unavailable` | 浏览器/CDP 起不来 | 跑 `browser`；首次启动较慢 |
| `rate_limited_locally` | 本地保护拦下了调用 | 按提示等待或换 Provider；**不要循环重试** |
| `extraction_failed` | 有回答但提取为空 | 看截图 |
| `internal_error` | 其他 | 看 stderr 日志 |

---

## 命令一览

```bash
ask-web-ai ask "<prompt>"                 # 提问（管道输出时默认 JSON）
ask-web-ai ask "<prompt>" --text          # 人类可读输出
ask-web-ai ask "<prompt>" --no-cache      # 跳过缓存
ask-web-ai login --provider deepseek      # 在专用档案里做一次性登录
ask-web-ai browser                        # 当前使用的浏览器 / 已安装的浏览器
ask-web-ai browser --use chrome           # 切换浏览器
ask-web-ai browser --stop                 # 关闭本工具打开的窗口
ask-web-ai providers                      # 列出 Provider 及登录要求
ask-web-ai limits                         # 用量 vs 各项上限
ask-web-ai cache [--clear]                # 查看 / 清空答案缓存
ask-web-ai status                         # 浏览器 + 档案 + 默认配置
```

---

## 故障排查

每次失败都会留下证据：

```
~/.agent-web-ai/profiles/<browser>/artifacts/<时间戳>-<provider>/
  screenshot.png    失败瞬间的页面截图
  page.html         完整 HTML，用于更新选择器
  summary.json      页面文本、URL、错误码、捕获时间
```

路径会出现在返回的 `meta.artifacts` 中。常用参数：

```bash
ask-web-ai ask "x" -p duckai --log-level debug   # 查看选择器匹配细节
ask-web-ai ask "x" -p duckai --dry-run           # 只校验配置，不开浏览器
ask-web-ai ask "x" -p duckai --timeout 300       # 更长的回答预算
```

几种常见情况：

- **`login_required`** —— 执行一次登录命令即可，档案会记住。
- **`captcha_required`** —— 请你在可见窗口里手动完成。本工具不会也无法替你完成。
- **`access_blocked`** —— 站点判定你的网络可疑。等待或换 Provider。此限制**绝不绕过**。
- **`selectors_stale`** —— 站点改了 DOM。打开失败截图，更新对应 Provider 的选择器列表，重新运行。

---

## 配置

默认值在 `config/default.json`，机器专属覆盖写 `config/local.json`（已被 git 忽略）：

```bash
cp config/local.json.example config/local.json
```

主要项：`browser.preferred`（`edge` 或 `chrome`）、`defaults.provider`、
`defaults.timeoutMs`、`throttle.*`、`cache.*`、`providers.<id>.enabled`。

环境变量覆盖：`AWA_PROVIDER`、`AWA_TIMEOUT_MS`、`AWA_BROWSER_PORT`、
`AWA_CHROME_PATH`、`AWA_PROFILE_DIR`、`AWA_LOG_LEVEL`。

---

## 设计原则

1. **绝不绕过任何关口。** 不破解验证码、不伪造登录、不规避限流、不做反检测伪装。人工步骤交给人。
2. **用你自己的浏览器、你自己的访问权。** 专用档案 + CDP，与日常浏览完全隔离。
3. **跨越边界的只有两样东西：** 提示词，和结构化结果。
4. **失败必须可诊断。** 稳定的错误码 + 截图 + HTML。
5. **不过度设计。** 无数据库、无守护进程、无队列。

---

## 已知限制

- **网站改版会让选择器失效。** 已用多选择器回退、失败取证和 `selectors_stale` 缓解，但无法根除。
- **默认使用可见窗口。** 无头模式会在多个站点触发风控，因此驱动真实窗口。
- **保护机制会让批量任务变慢**（每天 40 次、间隔 20 秒），这是刻意的取舍。真需要吞吐量请用官方 API。
- **未验证：** ChatGPT 需要付费账号；Grok 与 Gemini 为实验性。
- **并发：** 每次调用开一个标签页，共用同一档案。建议不超过 2-3 个并发。
- **不保证答案正确。** 网页 AI 会幻觉，关键结论必须自己复核。

---

## 路线图

- Task Router：在主模型和网页 AI 之间自动分流
- 缓存改进与批量接口
- Provider 健康检查与选择器 `doctor`
- 更多 Provider（Kimi、Z.ai、Copilot）

---

## 项目结构

```
bin/ask-web-ai.js          CLI 入口
src/index.js               公开 API（askWebAI）
src/core/ask.js            唯一入口；返回结构化结果，从不抛裸异常
src/core/browser.js        Edge/Chrome 探测、启动、CDP 复用、切换
src/core/provider.js       Provider 基类：超时、轮询、键盘输入、通用提取
src/core/throttle.js       防封号保护：间隔、冷却、配额、熔断
src/core/cache.js          答案缓存
src/core/artifacts.js      失败取证：截图、HTML、摘要
src/providers/*.js         各站点适配（可插拔）
src/mcp-server.js          零依赖 MCP stdio 服务
skills/free-web-ai-worker/ Agent Skill 定义
scripts/probe-*.mjs        开发期选择器探测工具
tests/                     离线单元测试 + 真实链路测试
```

---

## 致谢与先例

本项目在开发时研究（但未复制）了若干优秀项目：

| 项目 | 许可证 | 借鉴内容 |
|---|---|---|
| [ToaruPen/Cavendish](https://github.com/ToaruPen/Cavendish) | ISC | CDP + 持久档案架构；ChatGPT 选择器基线 |
| [ljie-PI/web-chat](https://github.com/ljie-PI/web-chat) | MIT | 复用已运行的浏览器；回答稳定性轮询 |
| [mrshibly/PhantomAPI](https://github.com/mrshibly/PhantomAPI) | MIT | 响应等待策略参考 |
| [STAR-173/LLMSession-Docker](https://github.com/STAR-173/LLMSession-Docker) | MIT | 评估后未采用（容器 + 无头会触发风控） |

唯一运行时依赖：[`playwright-core`](https://github.com/microsoft/playwright)（Apache-2.0），
驱动你已经装好的浏览器，而不是再下载一个。

## 开发说明

本项目由一位非开发者借助 AI 大量协助（也就是所谓 "vibe coding"）完成。
产品构想、Provider 抽象、安全设计和每一项验收标准都由作者提出；
代码在 AI 协作下写成，README 中的每一项功能声明都经过实际运行验证。

如果你发现代码风格不够地道，原因就在这里。欢迎提 Issue、纠错和 PR。

---

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
