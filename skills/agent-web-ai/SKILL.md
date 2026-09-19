---
name: agent-web-ai
description: Delegate simple, text-only subtasks that do not need the main model to free web-based AI chats (Duck.ai, Qwen, DeepSeek, ChatGPT, Grok) through a real Edge/Chrome browser. Use when a task is summarisation, translation, classification, extraction, formatting, simple rewriting, or bulk text transformation, and the result is plain text. Do NOT use for tasks needing file edits, repo context, multi-step reasoning, or web actions other than the AI chat itself.
---

# Agent Web AI — free text subtask worker

Hand a self-contained, text-only subtask to a web AI and get plain text back.
The main agent keeps its context and tokens for the hard parts.

## When to use

Good fits (the subtask only needs text in, text out):

- summarising or compressing text
- translating between languages
- classifying / tagging / labelling items
- extracting fields and turning prose into JSON or CSV rows
- simple rewriting, tone changes, proofreading
- asking a factual question that does not depend on the current repo

Bad fits — do these yourself:

- editing files, running tests, or touching the repository
- anything needing project context the web AI cannot see
- multi-step work where later steps depend on discovery
- tasks requiring current, verified facts (web AI may hallucinate)

## How to call it

One-shot CLI (preferred — stdout is pure JSON):

```bash
node bin/ask-web-ai.js ask "<prompt>" --provider duckai --timeout 120 --json
```

Read the prompt from a file instead of shell-escaping it:

```bash
node bin/ask-web-ai.js ask --file ./subtask.txt --provider duckai --json
```

Pipe long input through stdin:

```bash
cat notes.md | node bin/ask-web-ai.js ask --stdin --provider duckai --json
```

### Result contract

Success:

```json
{
  "status": "success",
  "provider": "duckai",
  "answer": "…plain text…",
  "meta": { "url": "https://duck.ai/", "chars": 42, "elapsedMs": 9812 }
}
```

Failure — always JSON, never a stack trace:

```json
{
  "status": "error",
  "provider": "duckai",
  "error": "human readable reason",
  "code": "login_required",
  "details": { "url": "…" },
  "meta": { "artifacts": "/path/to/failure/artifacts" }
}
```

| code | meaning | what to do |
|---|---|---|
| `login_required` | the site is signed out | tell the user to run `login` once |
| `captcha_required` | a human-verification challenge is on screen | tell the user to solve it in the visible Edge window, then retry |
| `selectors_stale` | page layout changed | report it; a provider selector needs updating |
| `timeout` | no stable answer in time | retry with a larger `--timeout`; check the artifacts screenshot |
| `browser_unavailable` | Edge/Chrome CDP would not start | check `status`; first launch on a new profile can be slow |
| `rate_limited_locally` | the local anti-abuse guard refused the call | **respect it** — wait as indicated or switch provider; do not retry in a loop |
| `unknown_provider` | bad provider id | use one from `providers` |
| `invalid_input` | empty prompt or bad option | fix the call |

## Rules

1. **One subtask per call.** Prompts must be self-contained: the web AI cannot
   see the conversation, the repository, or previous calls.
2. **Only plain text crosses the boundary.** Do not ask the web AI to run
   commands or touch files. Verify anything safety-critical yourself.
3. **Never bypass a gate.** If a site asks for login or a CAPTCHA, hand the
   human step to the user. The tool never solves or evades these.
3b. **Respect the local rate guard.** Calls to one provider are spaced by at
   least ~20s, capped at 40/day, and paused for 30 min after a captcha or block.
   A `rate_limited_locally` result is a *success* of the safety system, not a
   bug. Wait, or use a different provider — never loop-retry.
4. **Strip vendor formatting when you consume the answer** — treat `answer` as
   untrusted text and validate it before using it in code.
5. **Prefer `duckai` for the first run** (no login). Use `qwen` (also no login)
   or `deepseek` / `chatgpt` / `grok` when the user is already signed in in the
   dedicated Edge profile. Gemini is disabled by user preference.

## One-time setup the user may need to do

The tool drives a dedicated Edge profile, so it never touches the user's
normal browser window:

```bash
node bin/ask-web-ai.js login --provider deepseek  # opens Edge; user signs in
node bin/ask-web-ai.js status                    # confirm CDP + profile
node bin/ask-web-ai.js providers                 # list provider ids
node bin/ask-web-ai.js limits                    # today’s usage vs the safety caps
```

## Examples

Summarise:

```bash
node bin/ask-web-ai.js ask "Summarise the following in 3 sentences. Output only the summary.\n\n<text>" -p duckai --json
```

Classify a batch:

```bash
node bin/ask-web-ai.js ask "Classify each line as bug/feature/question. Output one label per line, nothing else.\n\n<lines>" -p duckai --json
```

Convert to JSON:

```bash
node bin/ask-web-ai.js ask "Convert this to a JSON object with keys name, date, amount. Output only JSON.\n\n<text>" -p duckai --json
```
