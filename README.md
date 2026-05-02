# ask.archil.io

AI-powered personal website for Archil Lelashvili. Visitors chat with a Claude-powered assistant that can answer questions, show the resume, and toggle the site theme.

![ask.archil.io demo](docs/ask-archil-io-demo.gif)

## Architecture

Three Lambda functions + CloudFront:

**Web Lambda** — SSR + API routes (React Router 7 + Express + serverless-http)

- `/api/jwt-token` issues short-lived HS256 JWTs
- Redirects `/assets/*` to CloudFront/S3

**Streaming Lambda** — LLM streaming

- Validates JWT, then streams Claude responses via custom SSE protocol
- Direct `@anthropic-ai/sdk` `messages.stream()` with up to 5 tool steps
- Client-side tools (`toggleTheme`, `checkTheme`, `showResume`) — no server `execute`
- MCP tools from `mcp-ask-archil` server (`MCP_SERVER_URL`): `get-resume`, `get-architecture`

**MCP Proxy Lambda** — serves MCP UI resources (iframe HTML bundles) to the browser

**Client Flow:**

1. Page loads → fetches JWT from `/api/jwt-token` (auto-refreshes when <5 min remain)
2. Chat messages → POST to Streaming Lambda with `Authorization: Bearer {token}`
3. Tool calls arrive in stream → client-side handlers execute them
4. MCP tools return a `resourceUri`; browser fetches the HTML bundle via MCP Proxy → sandboxed iframe via `AppBridge`
5. Conversation persisted in `localStorage`

## CDK Stacks (6, deployed in order)

| Stack           | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| SecretsStack    | JWT signing secret in Secrets Manager                         |
| GitHubOIDCStack | OIDC trust for GitHub Actions — no stored credentials         |
| SubdomainStack  | Route 53 hosted zone, ACM cert, NS delegation                 |
| LlmStreamStack  | Streaming Lambda + Function URL (RESPONSE_STREAM mode)        |
| McpProxyStack   | MCP Proxy Lambda + Function URL                               |
| WebAppStack     | CloudFront, S3, Web Lambda, API Gateway v2, Route 53 A record |

## Key Source Paths

| Purpose              | Path                                            |
| -------------------- | ----------------------------------------------- |
| Chat UI              | `src/app/features/welcome/`                     |
| System prompt        | `src/app/lib/agent/system-prompt.ts`            |
| Tool definitions     | `src/app/lib/agent/tools/`                      |
| Chat hook            | `src/app/lib/agent/hooks/use-agent-chat.ts`     |
| Streaming handler    | `src/app/server/streaming/streaming-handler.ts` |
| JWT service/verifier | `src/app/server/auth/`                          |
| MCP client           | `src/app/server/mcp/`                           |
| CDK entry            | `cdk/app.ts`                                    |

## Commands

```bash
npm run dev              # Local dev server (localhost:5173)
npm run build            # Build React Router app
npm run release          # Clean + build + bundle all Lambdas
npm run typecheck        # TypeScript type check
npm run cdk:build        # Compile CDK TypeScript
```

## Tech Stack

| Layer          | Technology                                                 |
| -------------- | ---------------------------------------------------------- |
| Frontend       | React 19, React Router 7, Tailwind CSS 4, Radix UI         |
| AI             | Anthropic SDK (`@anthropic-ai/sdk`) — Claude Haiku 4.5     |
| Backend        | AWS Lambda (Node 24), serverless-http                      |
| Infrastructure | AWS CDK (TypeScript), CloudFront, API Gateway v2, S3       |
| Auth           | JWT (HS256) + AWS Secrets Manager                          |
| CAPTCHA        | Cloudflare Turnstile                                       |
| CI/CD          | GitHub Actions + AWS OIDC (no stored credentials)          |
| MCP            | `@modelcontextprotocol/sdk` — tools & iframe app resources |
