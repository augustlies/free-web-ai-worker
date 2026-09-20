# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-20

### Added
- **Task Router** -- a deterministic, zero-cost heuristic that decides whether a
  task should be delegated to a web AI or kept by the main model. Exposed as the
  `route` CLI command, the `route_task` MCP tool and Node exports
  (`routeTask`, `classifyTask`, `routeTasks`). Scores delegable task shapes
  against hard blockers, rewards large payloads, and always reports its reasoning
  and a confidence level. Never makes a network call.

### Planned
- Batch API and improved result caching
- Provider health checks and a selector `doctor`
- Additional providers (Kimi, Z.ai, Copilot)

## [0.1.0] - 2026-09-19

First public release.

### Added
- `askWebAI()` single entry point returning a structured result; never throws on
  expected failures and always reports a stable error `code`.
- Pluggable provider architecture: `duckai`, `qwen`, `deepseek`, `chatgpt`,
  `grok`, `gemini` (the last two experimental and disabled by default).
- Browser engine that drives the user's own Edge or Chrome over CDP using a
  dedicated, isolated profile, so existing logins are reused safely.
- Anti-abuse guard: minimum interval, batch cooldown, daily quota, circuit
  breaker on captcha/access block, plus an answer cache. Conservative by default.
- Failure forensics: screenshot, page HTML and a summary written on every
  failure, with the path returned in `meta.artifacts`.
- Interfaces: CLI (`ask`, `login`, `browser`, `providers`, `limits`, `cache`,
  `status`, `version`), a dependency-free MCP stdio server exposing `ask_web_ai`,
  an agent skill, and a Node module export.
- 21 offline unit tests covering the core contract, the throttle guard and the
  cache.

### Verified
- End-to-end runs on Windows 11 with Microsoft Edge 153: Duck.ai (~9-10s),
  Qwen guest mode (~34s), DeepSeek with a signed-in profile (~41s).

### Known limitations
- Selectors must be maintained as sites redesign their DOM.
- Headless mode triggers bot checks on several sites, so a visible window is used.
- ChatGPT is unverified (requires a paid account); Grok and Gemini are
  experimental.
- The guard intentionally makes high-volume use slow; use an official API for bulk work.

[Unreleased]: https://github.com/augustlies/free-web-ai-worker/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/augustlies/free-web-ai-worker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/augustlies/free-web-ai-worker/releases/tag/v0.1.0
