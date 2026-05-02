# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # Start local dev server (localhost:5173)
npm run build            # Build React Router app
npm run release          # Full production build: clean + build + bundle both Lambdas
npm run release:streaming # Build only the streaming Lambda bundle
npm run typecheck        # TypeScript type check (no emit)
npm run cdk:build        # Compile CDK TypeScript → dist/cdk-out
npm run cdk:deploy:streaming # Deploy only the streaming Lambda stack
```

No automated tests — validation is via `typecheck` and CI.

## Architecture

AI-powered personal website with two AWS Lambda functions sharing one codebase:

**Web App Lambda** — SSR + API routes via React Router 7 + Express
- Handles all web requests, serves HTML
- `/api/jwt-token` issues short-lived HS256 JWTs (secret from Secrets Manager)
- Redirects `/assets/*` to CloudFront

**Streaming Lambda** — LLM streaming only
- Validates incoming JWT, then streams Claude Haiku responses via custom SSE protocol
- Uses `@anthropic-ai/sdk` `messages.stream()` directly (not Vercel AI SDK)
- Executes up to 5 tool-use steps
- Client-side tools (no `execute` on server): `toggleTheme`, `checkTheme`, `showResume`
- MCP tools come from `mcp-ask-archil` server (`MCP_SERVER_URL`): `get-resume`, `get-architecture`, plus others; degrades gracefully if unavailable
- MCP Apps (`get-resume`, `get-architecture`) return a `resourceUri`; browser fetches HTML bundle via MCP Proxy Lambda → sandboxed iframe via `AppBridge` in `McpToolUI`

**MCP Proxy Lambda** — serves MCP UI resources (iframe HTML bundles) to the browser

**Client Flow:**
1. Page loads → fetches JWT from `/api/jwt-token` (auto-refreshes when <5 min remain)
2. Chat messages → POST to Streaming Lambda with `Authorization: Bearer {token}`
3. Tool calls arrive in stream → client-side handlers execute them (theme, resume)
4. Conversation persisted in `localStorage`

**Key source paths:**
- `src/app/features/welcome/` — main chat UI
- `src/app/lib/agent/` — system prompt, tools, hooks
- `src/app/lib/knowledge/` — resume markdown
- `src/app/server/streaming/streaming-handler.ts` — Streaming Lambda handler
- `src/app/server/auth/` — JWT service & verifier
- `src/app/server/mcp/` — MCP client
- `src/app/routes/api/jwt-token.ts` — JWT endpoint
- `deployment/` — Lambda entry shims
- `cdk/` — AWS CDK infrastructure (6 stacks: Secrets, OIDC, Subdomain, LLMStream, McpProxy, WebApp)

**Build output:**
- `dist/lambda-pkg/web-app-handler.js` — web app Lambda bundle
- `dist/streaming-lambda/streaming-handler.js` — streaming Lambda bundle

**Path alias:** `~/*` → `src/app/*`
