/**
 * Per-Environment Configuration for CDK Deployments
 *
 * This file defines AWS account IDs, regions, and other environment-specific
 * settings for dev and prod environments.
 *
 * These are hardcoded values per environment. The stage is selected via
 * --context environment=dev or --context environment=prod when running CDK commands.
 */

export enum Stage {
  prod = "prod",
}

export interface EnvironmentConfig {
  /** Environment stage name (dev or prod) */
  stage: Stage;
  /** AWS Account ID */
  accountId: string;
  /** AWS Region */
  region: string;
  /** Lambda memory in MB */
  lambdaMemory: number;
  /** CloudWatch Logs retention in days */
  logRetentionDays: number;
  /** CloudFront HTML cache TTL in minutes */
  htmlCacheTtlMinutes: number;
  /** CloudFront assets cache TTL in days */
  assetsCacheTtlDays: number;
  /** Custom domain name */
  domainName?: string;
  /** Parent account Route 53 Hosted Zone ID (for NS delegation) */
  parentHostedZoneId?: string;
  /** IAM role ARN for cross-account NS delegation in parent account */
  parentDelegationRoleArn?: string;
}

const environments: Record<Stage, EnvironmentConfig> = {
  [Stage.prod]: {
    stage: Stage.prod,
    accountId: "260448775808",
    region: "us-east-1",
    lambdaMemory: 1024,
    logRetentionDays: 30,
    htmlCacheTtlMinutes: 60,
    assetsCacheTtlDays: 30,
    domainName: "ask.archil.io",
    parentHostedZoneId: "Z00681622F9CUFDPFSU6B",
    parentDelegationRoleArn:
      "arn:aws:iam::359373592118:role/ask-archil-io-dns-delegation-role",
  },
};

/**
 * Get environment configuration by stage
 * @param stage Stage name (prod)
 * @returns Environment configuration object
 * @throws Error if stage is invalid or not properly configured
 */
export function getEnvironmentConfig(stage: string): EnvironmentConfig {
  if (stage !== "prod") {
    throw new Error(`Invalid stage "${stage}". Must be "prod".`);
  }

  const config = environments[stage as Stage];

  if (!config) {
    throw new Error(`Production configuration not found for stage: ${stage}`);
  }

  return config;
}

/**
 * Get all environment configurations
 */
export function getAllEnvironments(): Record<Stage, EnvironmentConfig> {
  return environments;
}

export default getEnvironmentConfig;
