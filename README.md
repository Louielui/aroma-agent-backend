# Aroma M1 — Talk to Aroma (backend)

Single JavaScript service. No Docker, no native modules, no build step.

## Run
```bash
npm install
npm start          # http://127.0.0.1:8081
```
First run uses LLM_PROVIDER=mock (no API key needed) so you can see the whole loop work.

## Switch to real Claude
Set two env vars (never commit them):
```bash
# Git Bash / macOS / Linux:
export ANTHROPIC_API_KEY=sk-ant-...      # your key
export LLM_PROVIDER=claude
npm start
```
On Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-..."; $env:LLM_PROVIDER="claude"; npm start`

## Endpoints
- POST /api/v1/intake            { message }  -> { understanding, decision, tasks, blocked }
- GET  /api/v1/decisions | /tasks | /events | /llm-usage/summary
- GET  /health

Red-line messages (banking/TD/CRA/SIN/passwords/secrets) are NEVER sent to any external model.
Data persists to ./data/aroma-truth.json.
