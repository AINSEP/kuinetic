# AGENTS

## HARD RULE: no tests unless the owner says so

Do not run tests on this machine unless the owner says to in that moment. That covers vitest, `npm test`, `npm run ci`, coverage and browser tests, in any scope, even one file, and by any agent, subagent or Codex run. Local runs have frozen the owner's computer during a client call. Writing test files is fine; running them is not. Put this rule in every brief.

`<AI_DEV_SHOP_ROOT>` means `AI-Dev-Shop/` (relative to this file).

On boot, read `AI-Dev-Shop/AGENTS.md` for full operating instructions — agent definitions, pipeline stages, routing rules, convergence policy, dispatch protocol, slash commands, and the Mandatory Startup sequence. If that file is missing or unreadable, state that explicitly and stop.
