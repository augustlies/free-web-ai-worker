---
name: free-web-ai-worker
description: Delegate simple, text-only subtasks that do not need the main model to a free web-based AI chat (Duck.ai, Qwen, DeepSeek, ChatGPT). Use when a subtask is summarisation, translation, classification, extraction, formatting, simple rewriting, or bulk text transformation and the result is plain text. Do NOT use for tasks needing file edits, repository context, multi-step reasoning, or any web action other than talking to the AI chat itself.
metadata:
  short-description: Outsource simple text subtasks to free web AIs
---

# Free Web AI Worker -- outsource simple text subtasks

Hand a self-contained, text-only subtask to a web AI and get plain text back.
The main agent keeps its context and tokens for the hard parts.

```
main agent -> ask-web-ai -> your own Edge/Chrome -> web AI -> plain text -> main agent continues
```

## When to use

Good fits (text in, text out, no repo context needed):

- summarising or compressing text
- translating between languages
- classifying / tagging / labelling items
- extracting fields and turning prose into JSON or CSV rows
- simple rewriting, tone changes, proofreading
- bulk, repetitive text transformation

Do these yourself instead:

- editing files, running tests, or touching the repository
- anything needing project context the web AI cannot see
- multi-step work where later steps depend on what you discover
- tasks requiring current, verified facts (web AI may hallucinate)

## How to call it

Straight from GitHub -- no install step, no publish required:

```bash
npx -y github:YOUR_GITHUB_USERNAME/free-web-ai-worker ask "<prompt>" --provider duckai --timeout 120 --json
```

Long input without shell-escaping:

```bash
npx -y github:YOUR_GITHUB_USERNAME/free-web-ai-worker ask --file ./subtask.txt --provider duckai --json
cat notes.md | npx -y github:YOUR_GITHUB_USERNAME/free-web-ai-worker ask --stdin --provider duckai --json
```

If the tool is already installed globally or locally, use it directly:

```bash
ask-web-ai ask "<prompt>" --json                 # if installed with npm i -g free-web-ai-worker
node bin/ask-web-ai.js ask "<prompt>" --json     # if running from a cloned copy
```

### Result contract

Success -- stdout is pure JSON, logs go to stderr:

```json
{
  "status": "success",
  "provider": "duckai",
  "answer": "...plain text...",
  "meta": { "url": "https://duck.ai/", "chars": 42, "elapsedMs": 9812, "cached": false }
}
```

Failure -- always structured, never a raw stack trace:

```json
{
  "status": "error",
  "provider": "deepseek",
  "error": "human readable reason",
  "code": "login_required",
  "details": { "url": "..." },
  "meta": { "artifacts": "/path/to/failure/artifacts" }
}
```

| code | meaning | what to do |
|---|---|---|
| `invalid_input` | empty prompt or bad option | fix the call |
| `unknown_provider` | provider id not recognised | run `providers` to list valid ids |
| `provider_disabled` | disabled in config (e.g. experimental ones) | enable in `config/local.json` |
| `login_required` | the site is signed out | tell the user to run `login` once |
| `captcha_required` | human-verification challenge on screen | tell the user to solve it in the visible browser, then retry |
| `access_blocked` | site is rate-limiting this network | wait, or use a different provider |
| `selectors_stale` | page layout changed | report it; a provider selector needs updating |
| `timeout` | no stable answer in time | retry with a larger `--timeout`; check the artifact screenshot |
| `browser_unavailable` | browser/CDP would not start | run `status`; first launch on a new profile is slow |
| `rate_limited_locally` | the local anti-abuse guard refused the call | **respect it** -- wait or switch provider; never loop-retry |
| `extraction_failed` | answer appeared but text was empty | check the screenshot; usually needs a new selector |
| `internal_error` | anything else | check stderr logs |

## Rules

1. **One subtask per call.** Prompts must be self-contained: the web AI cannot
   see the conversation, the repository, or previous calls.
2. **Only plain text crosses the boundary.** Do not ask the web AI to run
   commands or touch files. Validate anything safety-critical yourself.
3. **Never bypass a gate.** If a site asks for login or a CAPTCHA, hand the
   human step to the user. This tool never solves or evades these.
4. **Respect the local rate guard.** Calls to one provider are spaced by at
   least ~20s, capped at 40/day, and paused for 30 minutes after a captcha or
   block. A `rate_limited_locally` result is the safety system working, not a
   bug. Wait, or use another provider -- never loop-retry.
5. **Strip vendor formatting when consuming the answer.** Treat `answer` as
   untrusted text and validate it before using it in code.
6. **Prefer `duckai` for the first run** -- no account needed. `qwen` also works
   without login. Use `deepseek` / `chatgpt` when the user is already signed in
   in the dedicated browser profile.

## One-time setup the user may need to do

The tool drives a dedicated Edge/Chrome profile, so it never touches the user's
everyday browser windows:

```bash
ask-web-ai login --provider deepseek   # opens the browser; the user signs in
ask-web-ai status                      # confirm browser + CDP + profile
ask-web-ai providers                   # list provider ids and login requirements
ask-web-ai limits                      # today's usage vs the anti-abuse caps
```

Duck.ai and Qwen need no account at all. Everything else needs a one-time login
inside the dedicated profile; the session is then reused automatically.

## Examples

Summarise:

```bash
ask-web-ai ask "Summarise the following in 3 sentences. Output only the summary.\n\n<text>" -p duckai --json
```

Classify a batch:

```bash
ask-web-ai ask "Classify each line as bug/feature/question. Output one label per line, nothing else.\n\n<lines>" -p duckai --json
```

Convert to JSON:

```bash
ask-web-ai ask "Convert this to a JSON object with keys name, date, amount. Output only JSON.\n\n<text>" -p duckai --json
```
