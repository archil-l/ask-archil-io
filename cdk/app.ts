#!/usr/bin/env node
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { WebAppStack } from "./lib/web-app-stack.js";
import { GitHubOidcStack } from "./lib/github-oidc-stack.js";
import { SubdomainStack } from "./lib/subdomain-stack.js";
import { LLMStreamStack } from "./lib/llm-stream-stack.js";
import { McpProxyStack } from "./lib/mcp-proxy-stack.js";
import { SecretsStack } from "./lib/secrets-stack.js";
import { getEnvironmentConfig, Stage } from "./config/environments.js";

const GITHUB_ORG = "archil-l";
const GITHUB_REPO = "ask-archil-io";

const app = new cdk.App();

// Get environment-specific configuration
const envConfig = getEnvironmentConfig(Stage.prod);

console.log(
  `Deploying to ${envConfig.stage} environment (Account: ${envConfig.accountId}, Region: ${envConfig.region})`,
);

// Secrets Stack - manages JWT signing secret
const secretsStack = new SecretsStack(
  app,
  `ask-archil-io-secrets-${envConfig.stage}`,
  {
    envConfig,
    env: {
      account: envConfig.accountId,
      region: envConfig.region,
    },
  },
);

// OIDC Stack - for GitHub Actions authentication
new GitHubOidcStack(app, `ask-archil-io-github-oidc-${envConfig.stage}`, {
  envConfig,
  githubOrg: GITHUB_ORG,
  githubRepo: GITHUB_REPO,
  env: {
    account: envConfig.accountId,
    region: envConfig.region,
  },
});

// Subdomain Stack - creates hosted zone and ACM certificate for custom domain
// Optionally updates NS delegation in parent account via custom resource
const subdomainStack = new SubdomainStack(
  app,
  `ask-archil-io-subdomain-${envConfig.stage}`,
  {
    domainName: envConfig.domainName || "",
    parentHostedZoneId: envConfig.parentHostedZoneId,
    parentDelegationRoleArn: envConfig.parentDelegationRoleArn,
    env: {
      account: envConfig.accountId,
      region: envConfig.region,
    },
  },
);

// LLM Streaming Stack - separate Lambda with Function URL for streaming responses
const llmStreamStack = new LLMStreamStack(
  app,
  `ask-archil-io-llm-stream-${envConfig.stage}`,
  {
    envConfig,
    secretsStack,
    env: {
      account: envConfig.accountId,
      region: envConfig.region,
    },
  },
);

// Ensure secrets stack is created before LLM stream stack
llmStreamStack.addDependency(secretsStack);

// MCP Proxy Stack - dedicated Lambda for client-side MCP access
// Uses the subdomain stack's wildcard cert to serve at proxy.<domainName>
const mcpProxyStack = new McpProxyStack(
  app,
  `ask-archil-io-mcp-proxy-${envConfig.stage}`,
  {
    envConfig,
    secretsStack,
    subdomainStack,
    env: {
      account: envConfig.accountId,
      region: envConfig.region,
    },
  },
);

// Ensure secrets and subdomain stacks are created before MCP proxy stack
mcpProxyStack.addDependency(secretsStack);
mcpProxyStack.addDependency(subdomainStack);

// Application Stack - the actual web app
const webAppStack = new WebAppStack(app, `ask-archil-io-${envConfig.stage}`, {
  envConfig,
  subdomainStack,
  secretsStack,
  llmStreamStack,
  mcpProxyStack,
  env: {
    account: envConfig.accountId,
    region: envConfig.region,
  },
});

// Ensure subdomain stack is created before web app stack
webAppStack.addDependency(subdomainStack);
webAppStack.addDependency(secretsStack);
webAppStack.addDependency(llmStreamStack);
webAppStack.addDependency(mcpProxyStack);
