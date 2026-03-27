import { createAnthropic } from "@ai-sdk/anthropic";
import { streamText, convertToModelMessages, stepCountIs, ToolSet } from "ai";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { verifyAuthHeader } from "../auth/jwt-verifier.js";
import { AgentUIMessage } from "~/lib/message-schema";
import { buildSystemPrompt } from "~/lib/agent/system-prompt.js";
import { allTools } from "~/lib/agent/tools/index.js";
import { getMcpTools, closeMcpClient } from "../mcp/mcp-client.js";

const MODEL = "claude-haiku-4-5-20251001";

// Secrets Manager client for JWT secret retrieval
const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "us-east-1",
});

/**
 * Fetch JWT signing secret from AWS Secrets Manager
 */
async function fetchJWTSecret(): Promise<string> {
  try {
    const secretArn = process.env.JWT_SECRET_ARN;
    if (!secretArn) {
      throw new Error("JWT_SECRET_ARN environment variable is not set");
    }

    const command = new GetSecretValueCommand({
      SecretId: secretArn,
    });
    const response = await secretsClient.send(command);

    if (response.SecretString) {
      const secretJson = JSON.parse(response.SecretString);
      return secretJson.secret;
    }

    throw new Error("Secret does not have a SecretString");
  } catch (error) {
    console.error("Failed to fetch JWT secret:", error);
    throw error;
  }
}

// Lambda streaming types
interface StreamingEvent {
  body?: string;
  headers?: Record<string, string>;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
}

interface ResponseStream extends NodeJS.WritableStream {
  setContentType(contentType: string): void;
}

interface HttpResponseStreamMetadata {
  statusCode: number;
  headers: Record<string, string>;
}

// AWS Lambda streaming response helper
declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: StreamingEvent,
      responseStream: ResponseStream,
      context: unknown,
    ) => Promise<void>,
  ) => (event: StreamingEvent, context: unknown) => Promise<void>;
  HttpResponseStream: {
    from: (
      responseStream: ResponseStream,
      metadata: HttpResponseStreamMetadata,
    ) => ResponseStream;
  };
};

export const handler = awslambda.streamifyResponse(
  async (
    event: StreamingEvent,
    responseStream: ResponseStream,
    _context: unknown,
  ) => {
    // Handle CORS preflight - headers are managed by Lambda Function URL CORS config
    if (event.requestContext?.http?.method === "OPTIONS") {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {},
      });
      responseStream.end();
      return;
    }

    try {
      // Verify JWT token from Authorization header
      const jwtSecret = await fetchJWTSecret();
      const verificationResult = verifyAuthHeader(
        event.headers || {},
        jwtSecret,
      );

      if (!verificationResult) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 401,
          headers: {
            "Content-Type": "application/json",
          },
        });
        responseStream.write(
          JSON.stringify({ error: "Missing Authorization header" }),
        );
        responseStream.end();
        return;
      }

      if (!verificationResult.valid) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 401,
          headers: {
            "Content-Type": "application/json",
          },
        });
        responseStream.write(
          JSON.stringify({
            error: verificationResult.error || "Unauthorized",
          }),
        );
        responseStream.end();
        return;
      }

      // Parse request body
      const body = event.body ? JSON.parse(event.body) : {};
      const { messages: inputMessages } = body as {
        messages?: AgentUIMessage[];
      };

      if (!inputMessages || !Array.isArray(inputMessages)) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 400,
          headers: {
            "Content-Type": "application/json",
          },
        });
        responseStream.write(
          JSON.stringify({ error: "messages array is required" }),
        );
        responseStream.end();
        return;
      }

      // Check for API key
      if (!process.env.ANTHROPIC_API_KEY) {
        responseStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 500,
          headers: {
            "Content-Type": "application/json",
          },
        });
        responseStream.write(
          JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured" }),
        );
        responseStream.end();
        return;
      }

      // Set up streaming response - CORS headers are managed by Lambda Function URL config
      // Use SSE format for AI SDK v6 UI Message Stream Protocol
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      });

      // Create Anthropic provider using AI SDK
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      // Convert UI messages to model messages
      const modelMessages = await convertToModelMessages(inputMessages);

      // Get MCP tools (with graceful degradation if server unavailable)
      const { tools: mcpTools, client: mcpClient } = await getMcpTools();

      // Combine client-side tools with MCP tools
      const combinedTools: ToolSet = {
        ...allTools,
        ...mcpTools,
      };

      console.log("Available tools:", Object.keys(combinedTools));

      // Use streamText with automatic tool execution via stopWhen
      const result = streamText({
        model: anthropic(MODEL),
        system: buildSystemPrompt(),
        messages: modelMessages,
        tools: combinedTools,
        stopWhen: stepCountIs(5), // Allow up to 5 tool execution loops
      });

      // Stream the response using AI SDK UI Message Stream Protocol
      const uiStream = result.toUIMessageStream();

      for await (const chunk of uiStream) {
        // Use SSE format: "data: <json>\n\n"
        responseStream.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      // Close MCP client connection
      await closeMcpClient(mcpClient);

      responseStream.end();
    } catch (error) {
      console.error("Streaming error:", error);

      const errorMessage =
        error instanceof Error ? error.message : "An unexpected error occurred";

      // Try to send error if stream hasn't ended
      try {
        responseStream.write(JSON.stringify({ error: errorMessage }));
        responseStream.end();
      } catch {
        // Stream may already be closed
      }
    }
  },
);
