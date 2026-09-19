# Publishing checklist

The repository is prepared and the author identity is already filled in
(`augustlies <304962398+augustlies@users.noreply.github.com>`).
What remains is creating the GitHub repository and pushing.

## Status

- [x] Author identity filled into package.json, both READMEs, CHANGELOG and the skill
- [x] Development commits re-authored to `augustlies` (verified with `git log`)
- [x] 23 offline unit tests pass
- [x] Skill structure validates
- [x] `npm pack` contents contain no `config/local.json`, no `node_modules`, no tests
- [x] Clean install from the tarball verified: CLI runs, module imports, assets present
- [x] No credentials, real email addresses, phone numbers or machine-specific paths in any tracked file or in git history
- [x] Live end-to-end call verified (Duck.ai, ~10s)
- [ ] Create the GitHub repository
- [ ] Push
- [ ] Confirm CI is green

## 1. Create the repository on GitHub

1. Open https://github.com/new
2. Repository name: **free-web-ai-worker**
3. Visibility: **Public**
4. **Do not** initialise with README / .gitignore / license -- the project already has them
5. Click **Create repository**

## 2. Push

```bash
git remote add origin https://github.com/augustlies/free-web-ai-worker.git
git push -u origin main
```

A browser window will ask you to sign in to GitHub. That is normal -- it is
GitHub's own credential prompt, and your password is handled by GitHub, not by
this project.

## 3. Verify CI

Open the **Actions** tab of the new repository. The workflow runs offline tests
on ubuntu + windows across Node 20 and 22, plus a skill-structure check.
All four matrix jobs should go green within a minute or two.

## 4. Polish the repository page

- **About** (top right): description =
  `Delegate simple text subtasks from your AI coding agent to free web AIs through a real browser.`
- **Topics**: `ai-agent`, `agent-skill`, `mcp`, `playwright`, `browser-automation`,
  `chatgpt`, `deepseek`, `qwen`, `codex`, `cline`
- Confirm the screenshot renders in the README

## 5. Cut a release (optional)

```bash
git tag -a v0.1.0 -m "v0.1.0 - first public release"
git push origin v0.1.0
```

Then create a Release from that tag and paste the `0.1.0` section of
`CHANGELOG.md`.

## 6. Publishing to npm (later, when you are ready)

npm is **not** published yet. When you want to:

```bash
npm login          # create a free account at https://www.npmjs.com/signup first
npm publish        # prepack runs the offline tests; refuses to publish on failure
```

Notes:
- Version numbers on npm are **permanent** -- `0.1.0` cannot be reused once taken.
- After publishing, the `npx github:` commands in the READMEs can be simplified
  to `npx free-web-ai-worker ...`.

## Security note

Never paste passwords or API tokens into a chat or into any file in this
repository. This tool never needs them: DeepSeek/ChatGPT logins happen by hand
inside the dedicated browser window, and git pushes authenticate through
GitHub's own credential prompt.
