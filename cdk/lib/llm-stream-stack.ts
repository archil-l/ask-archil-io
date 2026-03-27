import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { SecretsStack } from "./secrets-stack.js";

interface LLMStreamStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  secretsStack: SecretsStack;
}

export class LLMStreamStack extends cdk.Stack {
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: LLMStreamStackProps) {
    super(scope, id, props);

    const { envConfig, secretsStack } = props;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    // Import MCP server details from the mcp-ask-archil stack
    const mcpServerFunctionArn = cdk.Fn.importValue(
      `mcp-server-function-arn-${envConfig.stage}`,
    );
    const mcpServerFunctionUrl = cdk.Fn.importValue(
      `mcp-server-function-url-${envConfig.stage}`,
    );

    // Lambda function for LLM streaming
    const streamingFunction = new lambda.Function(this, "llm-stream-function", {
      functionName: `ask-archil-io-${envConfig.stage}-llm-stream-function`,
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../../dist/streaming-lambda"),
      ),
      handler: "streaming-handler.handler",
      runtime: Runtime.NODEJS_24_X,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5), // Longer timeout for streaming responses
      architecture: Architecture.X86_64,
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
        NODE_ENV: "production",
        JWT_SECRET_ARN: secretsStack.jwtSecretArn,
        // MCP Server configuration
        MCP_SERVER_URL: cdk.Fn.join("", [mcpServerFunctionUrl, "mcp"]),
      },
      logRetention: envConfig.logRetentionDays,
    });

    // Grant permission to invoke MCP server Lambda Function URL
    streamingFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunctionUrl"],
        resources: [mcpServerFunctionArn],
      }),
    );

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(streamingFunction);

    // Add Function URL with streaming enabled
    this.functionUrl = streamingFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ["https://ask.archil.io", "http://localhost:5173"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["Content-Type", "Authorization"],
        allowCredentials: true,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, "llm-stream-function-url", {
      description: "Lambda Function URL for LLM streaming",
      value: this.functionUrl.url,
    });

    new cdk.CfnOutput(this, "llm-stream-function-arn", {
      description: "LLM Streaming Lambda Function ARN",
      value: streamingFunction.functionArn,
    });
  }
}
