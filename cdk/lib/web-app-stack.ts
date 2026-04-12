import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { SubdomainStack } from "./subdomain-stack.js";
import { SecretsStack } from "./secrets-stack.js";
import { LLMStreamStack } from "./llm-stream-stack.js";
import { McpProxyStack } from "./mcp-proxy-stack.js";

interface WebAppStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  subdomainStack?: SubdomainStack;
  secretsStack: SecretsStack;
  llmStreamStack: LLMStreamStack;
  mcpProxyStack: McpProxyStack;
}

export class WebAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebAppStackProps) {
    super(scope, id, props);

    const { envConfig, secretsStack, llmStreamStack, mcpProxyStack } = props;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    // Environment-specific configuration from envConfig
    const lambdaMemory = envConfig.lambdaMemory;
    const logRetentionDays = envConfig.logRetentionDays;

    // S3 bucket for static assets
    const assetsBucket = new s3.Bucket(this, "remix-assets-bucket", {
      bucketName: `ask-archil-io-${envConfig.stage}-remix-assets-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true, // Enable versioning for rollback capability
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
    });

    // Add lifecycle policy to clean up old versions
    assetsBucket.addLifecycleRule({
      noncurrentVersionExpiration: cdk.Duration.days(7),
    });

    // CloudFront distribution for the S3 bucket with environment-specific caching
    const htmlCacheTtl = cdk.Duration.minutes(envConfig.htmlCacheTtlMinutes);
    const assetCacheTtl = cdk.Duration.days(envConfig.assetsCacheTtlDays);

    // Use SubdomainStack's hosted zone and certificate if provided
    let hostedZone: route53.IHostedZone | undefined;
    let certificate: acm.Certificate | undefined;

    if (props.subdomainStack) {
      hostedZone = props.subdomainStack.hostedZone;
      certificate = props.subdomainStack.certificate;
    } else if (
      envConfig.domainName &&
      envConfig.parentHostedZoneId &&
      envConfig.parentDelegationRoleArn
    ) {
      // Create SubdomainStack with parent account delegation
      const subdomainStack = new SubdomainStack(
        this,
        `subdomain-stack-${envConfig.stage}`,
        {
          domainName: envConfig.domainName,
          parentHostedZoneId: envConfig.parentHostedZoneId,
          parentDelegationRoleArn: envConfig.parentDelegationRoleArn,
          env: this.node.root.node.tryGetContext("stackEnv"),
        },
      );
      hostedZone = subdomainStack.hostedZone;
      certificate = subdomainStack.certificate;
    }

    const distribution = new cloudfront.Distribution(
      this,
      "remix-assets-distribution",
      {
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: new cloudfront.CachePolicy(this, "html-cache-policy", {
            defaultTtl: htmlCacheTtl,
            maxTtl: htmlCacheTtl,
            minTtl: cdk.Duration.seconds(0),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
            headerBehavior: cloudfront.CacheHeaderBehavior.none(),
            cookieBehavior: cloudfront.CacheCookieBehavior.none(),
            enableAcceptEncodingGzip: true,
            enableAcceptEncodingBrotli: true,
          }),
        },
        additionalBehaviors: {
          "/assets/*": {
            origin:
              origins.S3BucketOrigin.withOriginAccessControl(assetsBucket),
            viewerProtocolPolicy:
              cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: new cloudfront.CachePolicy(
              this,
              "assets-cache-policy",
              {
                defaultTtl: assetCacheTtl,
                maxTtl: assetCacheTtl,
                minTtl: cdk.Duration.seconds(0),
                queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
                headerBehavior: cloudfront.CacheHeaderBehavior.none(),
                cookieBehavior: cloudfront.CacheCookieBehavior.none(),
                enableAcceptEncodingGzip: true,
                enableAcceptEncodingBrotli: true,
              },
            ),
          },
        },
        defaultRootObject: undefined,
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: cdk.Duration.minutes(5),
          },
        ],
      },
    );

    // Lambda function using custom code asset
    const remixFunction = new lambda.Function(this, "web-app-function", {
      functionName: `ask-archil-io-${envConfig.stage}-web-app-function`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../dist/lambda-pkg"),
      ),
      handler: "web-app-handler.handler",
      runtime: Runtime.NODEJS_24_X,
      memorySize: lambdaMemory,
      timeout: cdk.Duration.seconds(30),
      architecture: Architecture.X86_64,
      environment: {
        ASSETS_BUCKET: assetsBucket.bucketName,
        CLOUDFRONT_URL: `https://${distribution.distributionDomainName}`,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || "",
        TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || "",
        JWT_SECRET_ARN: secretsStack.jwtSecretArn,
        JWT_EXPIRY_HOURS: "1",
        LLM_STREAM_URL: llmStreamStack.functionUrl.url,
        MCP_PROXY_URL: mcpProxyStack.functionUrl.url,
      },
      logRetention: logRetentionDays,
    });

    // Grant Lambda function read access to S3 bucket
    assetsBucket.grantRead(remixFunction);

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(remixFunction);

    // Deploy static assets to S3 bucket
    new s3deploy.BucketDeployment(this, "remix-assets-deployment", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "../../../public")),
        s3deploy.Source.asset(path.join(__dirname, "../../../dist/client"), {
          exclude: ["**/*.html"], // HTML files are handled by Lambda
        }),
      ],
      destinationBucket: assetsBucket,
      distribution, // Invalidate CloudFront cache on deployment
      distributionPaths: ["/*"],
    });

    // HTTP API Gateway (v2) - no automatic /prod/ path
    const httpApi = new apigatewayv2.HttpApi(this, "remix-http-api", {
      description: "HTTP API for Remix app",
      createDefaultStage: false,
    });

    // Lambda integration
    const lambdaIntegration = new integrations.HttpLambdaIntegration(
      "remix-integration",
      remixFunction,
    );

    // Add route for all paths
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Add root path route
    httpApi.addRoutes({
      path: "/",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: lambdaIntegration,
    });

    // Create stage without path prefix
    const stage = new apigatewayv2.HttpStage(this, "remix-stage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
    });

    // Create API Gateway custom domain name if domain is configured
    if (envConfig.domainName && certificate && hostedZone) {
      const apiDomain = new apigatewayv2.DomainName(this, "api-domain", {
        domainName: envConfig.domainName,
        certificate: certificate,
      });

      // Map the custom domain to the HTTP API and stage
      new apigatewayv2.ApiMapping(this, "api-mapping", {
        api: httpApi,
        domainName: apiDomain,
        stage: stage,
      });

      // Create Route 53 A record for custom domain pointing to API Gateway
      new route53.ARecord(this, "api-alias-record", {
        zone: hostedZone,
        recordName: envConfig.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGatewayv2DomainProperties(
            apiDomain.regionalDomainName,
            apiDomain.regionalHostedZoneId,
          ),
        ),
      });
    }

    // Outputs
    new cdk.CfnOutput(this, "remix-function-api", {
      description: "HTTP API endpoint URL for Remix function",
      value: httpApi.apiEndpoint,
    });

    new cdk.CfnOutput(this, "remix-function-arn", {
      description: "Remix Lambda Function ARN",
      value: remixFunction.functionArn,
    });

    new cdk.CfnOutput(this, "remix-cloudfront-url", {
      description: "CloudFront distribution URL for static assets",
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}
