import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Runtime, Architecture } from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { EnvironmentConfig } from "../config/environments.js";
import { SecretsStack } from "./secrets-stack.js";

interface McpProxyStackProps extends cdk.StackProps {
  envConfig: EnvironmentConfig;
  secretsStack: SecretsStack;
}

export class McpProxyStack extends cdk.Stack {
  public readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: McpProxyStackProps) {
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
    const clientAccessRoleArn = cdk.Fn.importValue(
      `mcp-server-client-access-role-arn-${envConfig.stage}`,
    );

    // Lambda function for MCP proxy
    const mcpProxyFunction = new lambda.Function(
      this,
      "mcp-proxy-function",
      {
        functionName: `ask-archil-io-${envConfig.stage}-mcp-proxy-function`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../../../dist/mcp-proxy-lambda"),
        ),
        handler: "mcp-proxy-handler.handler",
        runtime: Runtime.NODEJS_24_X,
        memorySize: 512,
        timeout: cdk.Duration.seconds(30),
        architecture: Architecture.X86_64,
        environment: {
          NODE_ENV: "production",
          JWT_SECRET_ARN: secretsStack.jwtSecretArn,
          MCP_SERVER_URL: cdk.Fn.join("", [mcpServerFunctionUrl, "mcp"]),
          CLIENT_ACCESS_ROLE_ARN: clientAccessRoleArn,
        },
        logRetention: envConfig.logRetentionDays,
      },
    );

    // Grant permission to invoke MCP server Lambda Function URL
    mcpProxyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunctionUrl"],
        resources: [mcpServerFunctionArn],
      }),
    );

    // Grant permission to assume the MCP server client access role
    mcpProxyFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [clientAccessRoleArn],
      }),
    );

    // Grant Lambda function read access to JWT secret
    secretsStack.jwtSecret.grantRead(mcpProxyFunction);

    // Add Function URL (buffered — MCP responses are JSON, not streams)
    this.functionUrl = mcpProxyFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.BUFFERED,
      cors: {
        allowedOrigins: ["https://ask.archil.io", "http://localhost:5173"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["Content-Type", "Authorization"],
        allowCredentials: true,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, "mcp-proxy-function-url", {
      description: "Lambda Function URL for MCP proxy",
      value: this.functionUrl.url,
      exportName: `mcp-proxy-function-url-${envConfig.stage}`,
    });

    new cdk.CfnOutput(this, "mcp-proxy-function-arn", {
      description: "MCP Proxy Lambda Function ARN",
      value: mcpProxyFunction.functionArn,
    });
  }
}
