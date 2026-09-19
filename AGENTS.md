# AGENTS.md — working notes for coding agents

This repo is a **skill**, not a service. Its job: let a main agent outsource
simple text-only subtasks to a free web AI chat through a real Edge/Chrome browser.

## Invariants (do not break)

1. `askWebAI()` **never throws for expected failures** — it returns
   `{ status: 'error', provider, error, code, details, meta }`.
2. **stdout is reserved for JSON.** Every log must go through `src/core/logger.js`
   (stderr). A stray `console.log` breaks every consumer.
3. **Never bypass a gate.** No CAPTCHA solving, no Cloudflare evasion, no login
   forgery, no rate-limit evasion, no stealth/anti-detection tricks. Detect and
   report instead (`login_required`, `captcha_required`, `access_blocked`).
4. Site-specific knowledge lives **only** in `src/providers/<id>.js`
   (selectors + behaviour). Shared flow lives in `src/core/provider.js`.
5. Every provider must declare `INPUT`, `ANSWER`, `SEND_BUTTON`, `STOP_BUTTON`
   selector lists in `static selectors`. Prefer 3+ fallbacks.

## Adding a provider

1. `src/providers/<id>.js` — extend `WebAIProvider`, export default.
2. `config/default.json` → `providers.<id>` with `url`, `displayName`, `enabled`.
3. `src/providers/index.js` — register the class.
4. `node bin/ask-web-ai.js ask "test" -p <id> --json` — must return success
   (or a *precise* structured error).

## Debugging a provider

```bash
node scripts/probe-dom.mjs      "https://<site>/" .tmp/probe.json
node scripts/probe-real.mjs     "https://<site>/" "prompt" "<input sel>" --headed
node bin/ask-web-ai.js ask "x" -p <id> --log-level debug
```

Failures always leave a screenshot + HTML under
`~/.agent-web-ai/profiles/<browser>/artifacts/<ts>-<provider>/`.

## Testing

- `npm test` — offline unit tests (must stay green).
- `npm run test:e2e` — live call to a real site.

Do not add heavy dependencies. `playwright-core` is the only runtime dependency
on purpose: it drives the Edge/Chrome the user already has.
