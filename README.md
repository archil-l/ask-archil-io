# Codebase Overview

AI-powered personal website for Archil Lelashvili. Visitors interact with a Claude-powered chat assistant that can answer questions, show the resume, and toggle the site theme.

---

## Tech Stack

| Layer          | Technology                                           |
| -------------- | ---------------------------------------------------- |
| Frontend       | React 19, React Router 7, Tailwind CSS 4, Radix UI   |
| AI             | Anthropic Claude Haiku 4.5 via `@ai-sdk/anthropic`   |
| Backend        | AWS Lambda (Node 24), serverless-http                |
| Infrastructure | AWS CDK (TypeScript), CloudFront, API Gateway v2, S3 |
| Auth           | JWT (HS256) + AWS Secrets Manager                    |
| CAPTCHA        | Cloudflare Turnstile                                 |
| CI/CD          | GitHub Actions + AWS OIDC (no stored credentials)    |
| Animation      | Motion (Framer Motion successor)                     |
| Streaming      | AI SDK UI Message Stream Protocol over SSE           |

---

## Repository Structure

```
archil-io-v2/
├── src/app/                    # Application source
│   ├── routes/                 # React Router routes
│   ├── features/welcome/       # Chat UI feature
│   ├── lib/
│   │   ├── agent/              # AI agent system
│   │   ├── knowledge/          # Docs & resume
│   │   ├── message-schema.ts   # TypeScript message types
│   │   ├── session.ts          # localStorage utilities
│   │   └── utils.ts            # cn() helper
│   ├── server/
│   │   ├── auth/               # JWT service & verifier
│   │   └── streaming/          # Lambda handler
│   ├── contexts/               # React contexts
│   ├── components/             # Shared UI components
│   └── css/                    # Global styles
├── cdk/                        # AWS CDK infrastructure
│   ├── app.ts                  # CDK entry point (5 stacks)
│   ├── config/environments.ts  # Prod config & domain settings
│   └── lib/
│       ├── secrets-stack.ts
│       ├── github-oidc-stack.ts
│       ├── subdomain-stack.ts
│       ├── llm-stream-stack.ts
│       └── web-app-stack.ts
├── deployment/                 # Lambda entry shims
├── .github/workflows/          # CI/CD pipeline
├── esbuild.config.js           # Lambda bundler
├── vite.config.ts              # Frontend bundler
└── react-router.config.ts      # Router config
```

---

## Application Flow

```
Browser
  │
  ▼
Route: "/"  (_index.tsx)
  │  Server loader fetches LLM_STREAM_URL env var
  ▼
Welcome component  (features/welcome/welcome.tsx)
  │  useWelcomeSession → loads conversation from localStorage
  ▼
ConversationProvider  (contexts/conversation-context.tsx)
  │  Fetches JWT from /api/jwt-token
  │  Initializes useAgentChat with tool handlers
  ▼
User sends message
  │  Turnstile CAPTCHA token attached to first message
  ▼
useAgentChat → DefaultChatTransport
  │  POST to LLM_STREAM_URL with Authorization: Bearer {jwt}
  ▼
Streaming Lambda (streaming-handler.ts)
  │  Validates JWT
  │  Calls streamText() → Claude Haiku 4.5
  │  Converts to UI Message Stream (SSE)
  ▼
Client receives streamed chunks
  │  Tool calls dispatched to client-side handlers
  ▼
UI updates in real-time
```

---

## Routes

| Route            | File                      | Purpose                                                         |
| ---------------- | ------------------------- | --------------------------------------------------------------- |
| `/`              | `routes/_index.tsx`       | Home page — loads streaming endpoint from server                |
| `/api/jwt-token` | `routes/api/jwt-token.ts` | Returns a signed JWT for authenticating to the streaming Lambda |

---

## AI Agent System

### Architecture

```
src/app/lib/agent/
├── system-prompt.ts            # Claude instructions
├── tools/
│   ├── client-side-tools.ts    # Tool definitions (Zod schemas, no execute fn)
│   ├── index.ts                # Tool registry exported to Lambda
│   ├── toggle-theme/           # Toggle light/dark mode
│   ├── check-theme/            # Read current theme
│   ├── show-resume/            # Display resume in UI
│   └── web-preview/            # (disabled)
└── hooks/
    ├── use-agent-chat.ts           # Wraps @ai-sdk/react useChat
    ├── use-client-tool-handlers.ts # Aggregates all client tool handlers
    └── index.ts
```

### Client-Side Tools Pattern

Tools that run on the client (no server `execute` function) follow this pattern:

1. **Tool definition** in `client-side-tools.ts` — Zod `inputSchema` + `outputSchema`, no `execute`
2. **Handler** in `tools/{name}/handler.ts` — receives `toolCallId`, calls `addToolOutput()`
3. **UI component** in `tools/{name}/{name}-tool-ui.tsx` — renders visual feedback
4. **Registration** in `use-client-tool-handlers.ts` — added to the handlers map

**Handler signature:**

```typescript
(toolCallId: string, addToolOutput: AddToolOutputFn) => Promise<void>;
```

**Handler must call `addToolOutput()`** — without it the model gets `AI_MissingToolResultsError` on the next turn.

### Available Tools

| Tool          | Input | Output                                 | Purpose                |
| ------------- | ----- | -------------------------------------- | ---------------------- |
| `toggleTheme` | `{}`  | `{ toggled, previousTheme, newTheme }` | Toggle light/dark      |
| `checkTheme`  | `{}`  | `{ currentTheme }`                     | Read current theme     |
| `showResume`  | `{}`  | `{ displayed }`                        | Display resume preview |

### System Prompt

- Agent presents itself as Archil's AI assistant
- Keeps responses concise
- Uses tools proactively (theme, resume)
- Offers to help contact Archil
- Never reveals internal tool names

---

## Streaming Lambda

**File**: `src/app/server/streaming/streaming-handler.ts`
**Model**: `claude-haiku-4-5-20251001`
**Max tool loops**: 5 (`stopWhen: stepCountIs(5)`)

**Request flow:**

1. POST receives `{ messages: AgentUIMessage[] }`
2. JWT extracted from `Authorization: Bearer {token}`
3. JWT secret fetched from Secrets Manager
4. `streamText()` called with system prompt, messages, all tools
5. Response piped as SSE (`x-vercel-ai-ui-message-stream: v1` protocol)

**Error codes:**

- `401` — missing or invalid JWT
- `400` — malformed message body
- `500` — missing API key or unexpected error

---

## Authentication

### JWT Flow

```
Client → GET /api/jwt-token → JWTService
  JWTService → Secrets Manager (JWT_SECRET_ARN) → 32-byte secret
  Returns: { token, expiresIn, expiresAt }
  Token auto-refreshes when < 5 minutes remain

Client → POST LLM_STREAM_URL
  Header: Authorization: Bearer {token}
  Lambda → jwt-verifier.ts → validates signature + expiry
```

**JWT payload:**

```json
{ "iss": "archil-io-v2", "sub": "app", "iat": ..., "exp": ... }
```

**Algorithm**: HS256
**Default expiry**: 1 hour (configurable via `JWT_EXPIRY_HOURS` env var)

---

## Infrastructure (AWS CDK)

**Entry**: `cdk/app.ts`
**Environment**: `cdk/config/environments.ts`
**Domain**: `agent.archil.io`
**AWS Account**: `260448775808` / `us-east-1`

### Stacks (deployed in order)

#### 1. SecretsStack

- Creates AWS Secrets Manager secret with auto-generated 32-byte JWT signing key
- ARN exported for other stacks

#### 2. GitHubOIDCStack

- OpenID Connect provider for GitHub Actions
- IAM role: `archil-io-v2-github-actions-role-prod`
- Trusted repo: `archil-l/archil-io-v2`
- Permissions: PowerUserAccess + CloudFormation

#### 3. SubdomainStack

- Route 53 hosted zone for `agent.archil.io`
- ACM certificate (DNS validation)
- Custom Lambda resource to delegate NS records to parent zone

#### 4. LlmStreamStack

- Lambda function: `archil-io-v2-prod-llm-stream-function`
- Code: `dist/streaming-lambda/streaming-handler.js`
- Runtime: Node 24.x, 1024 MB RAM, 5 min timeout
- Invoke mode: `RESPONSE_STREAM` (streaming)
- Function URL with CORS for `https://agent.archil.io` + `http://localhost:5173`
- Auth type: NONE (JWT validated in handler)

#### 5. WebAppStack

- **S3 bucket**: Static assets (`/assets/*`) — 30-day cache
- **CloudFront distribution**: CDN with OAC to S3
  - HTML cache: 60 minutes
  - Assets cache: 30 days
  - Gzip + Brotli compression
  - 403 → 404.html error page
- **Lambda** (web app): `archil-io-v2-prod-web-app-function`
  - Code: `dist/lambda-pkg/web-app-handler.js`
  - Timeout: 30s, 1024 MB
  - Handles SSR + API routes via `serverless-http`
- **HTTP API Gateway v2**: Routes `/` and `/{proxy+}` → web app Lambda
- **Route 53 A record**: `agent.archil.io` → API Gateway alias

---

## CI/CD Pipeline

**File**: `.github/workflows/ci-and-deploy.yml`

### Jobs

#### 1. `build`

- Node 24 setup
- `npm ci`
- ESLint (non-blocking)
- TypeScript type check
- `npm run release` (build + esbuild bundle)
- Verifies Lambda artifact exists
- Uploads artifacts (1 day retention)

#### 2. `ci-summary`

- Depends on `build`
- Reports overall CI pass/fail

#### 3. `deploy` (main branch only, skips PRs)

- AWS OIDC login — no stored credentials
- Downloads build artifacts
- `npm run cdk:build` — compiles CDK TypeScript
- `npm run cdk:deploy:main` — deploys `archil-io-v2-prod` stack
- Posts deployment summary with CloudFront URL

**GitHub Secrets required:**

- `AWS_ACCOUNT_ID`
- `AWS_REGION`
- `ANTHROPIC_API_KEY`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

---

## Build System

### Frontend (Vite)

- Plugins: `@react-router/dev`, `@tailwindcss/vite`
- `TURNSTILE_SITE_KEY` injected at build time via `define`
- Output: `dist/` (React Router build)

### Lambda Bundling (esbuild)

Two bundles produced by `esbuild.config.js`:

| Bundle    | Entry                     | Output                                       | Purpose          |
| --------- | ------------------------- | -------------------------------------------- | ---------------- |
| Web App   | `deployment/server.js`    | `dist/lambda-pkg/web-app-handler.js`         | SSR + API routes |
| Streaming | `deployment/streaming.js` | `dist/streaming-lambda/streaming-handler.js` | AI streaming     |

Both: Node 24, CommonJS, minified, `@aws-sdk/*` externalized.

**Full release command:**

```bash
npm run release
# = rm -rf dist && npm run build && node esbuild.config.js
```

---

## State & Session Management

**File**: `src/app/lib/session.ts`

| Key                      | Value                           |
| ------------------------ | ------------------------------- |
| `archil-io-session-id`   | UUID (created once per visitor) |
| `archil-io-conversation` | JSON array of `AgentUIMessage`  |

- Conversation persists across page refreshes
- Cleared via "Clear conversation" button in header
- `useWelcomeSession` hook loads history on mount

---

## Welcome Feature

**Location**: `src/app/features/welcome/`

### Components

| Component                      | Purpose                                           |
| ------------------------------ | ------------------------------------------------- |
| `welcome.tsx`                  | Root — ConversationProvider wrapper               |
| `welcome-header.tsx`           | Icon buttons (theme toggle, clear, etc.)          |
| `conversation-area.tsx`        | Scrollable message list                           |
| `input-area.tsx`               | Text input + Turnstile CAPTCHA + submit           |
| `suggestion-bar.tsx`           | 3 predefined prompts (hidden after first message) |
| `scroll-to-bottom-button.tsx`  | Appears when user scrolls up                      |
| `ui-message-part-renderer.tsx` | Routes message parts to renderers                 |
| `welcome-loader.tsx`           | Spinner during hydration                          |

### Predefined Prompts

1. "Tell me about Archil's experience" — Briefcase / blue
2. "How is this page built?" — Code / green
3. "I want to contact Archil" — Mail / purple

### Message Rendering (`ui-message-part-renderer.tsx`)

- `text` parts → Streamdown (streaming markdown renderer)
- `tool-invocation` parts → tool-specific UI components
- Streaming indicator shown while loading

---

## Environment Variables

| Variable               | Where set               | Purpose                          |
| ---------------------- | ----------------------- | -------------------------------- |
| `ANTHROPIC_API_KEY`    | Lambda env              | Claude API access                |
| `TURNSTILE_SITE_KEY`   | Build-time + Lambda env | CAPTCHA public key               |
| `TURNSTILE_SECRET_KEY` | Lambda env              | CAPTCHA validation               |
| `LLM_STREAM_URL`       | Lambda env              | URL of streaming Lambda function |
| `JWT_SECRET_ARN`       | Lambda env              | Secrets Manager ARN for JWT key  |
| `JWT_EXPIRY_HOURS`     | Lambda env              | JWT lifetime (default: 1)        |
| `ASSETS_BUCKET`        | Lambda env              | S3 bucket name for assets        |
| `CLOUDFRONT_URL`       | Lambda env              | CloudFront domain                |

---

## Security

1. **JWT**: All streaming requests require a valid short-lived JWT; secret lives in Secrets Manager
2. **CAPTCHA**: Cloudflare Turnstile validates real users before streaming
3. **CORS**: Streaming Lambda only accepts requests from `agent.archil.io` and `localhost:5173`
4. **OIDC**: GitHub Actions authenticates via OIDC — no long-lived AWS credentials stored
5. **SSR bot detection**: Server entry (`entry.server.tsx`) uses `isbot` to detect crawlers and renders differently
6. **Secrets**: All API keys injected at deploy time, never committed

---

## Key File Reference

| Purpose                | File                                                           |
| ---------------------- | -------------------------------------------------------------- |
| Claude system prompt   | `src/app/lib/agent/system-prompt.ts`                           |
| Tool definitions       | `src/app/lib/agent/tools/client-side-tools.ts`                 |
| Tool registry (server) | `src/app/lib/agent/tools/index.ts`                             |
| Client tool handlers   | `src/app/lib/agent/hooks/use-client-tool-handlers.ts`          |
| Chat hook              | `src/app/lib/agent/hooks/use-agent-chat.ts`                    |
| Conversation context   | `src/app/contexts/conversation-context.tsx`                    |
| Streaming Lambda       | `src/app/server/streaming/streaming-handler.ts`                |
| JWT service            | `src/app/server/auth/jwt-service.ts`                           |
| JWT verifier           | `src/app/server/auth/jwt-verifier.ts`                          |
| CDK entry              | `cdk/app.ts`                                                   |
| CDK config             | `cdk/config/environments.ts`                                   |
| Streaming Lambda stack | `cdk/lib/llm-stream-stack.ts`                                  |
| Web app stack          | `cdk/lib/web-app-stack.ts`                                     |
| CI/CD workflow         | `.github/workflows/ci-and-deploy.yml`                          |
| Resume (knowledge)     | `src/app/lib/knowledge/resume-archil-lelashvili-02-18-2026.md` |
