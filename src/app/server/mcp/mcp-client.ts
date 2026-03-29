import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSignedFetcher } from "aws-sigv4-fetch";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type Anthropic from "@anthropic-ai/sdk";

// MCP Server configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const AWS_REGION = process.env.AWS_REGION;
const CLIENT_ACCESS_ROLE_ARN = process.env.CLIENT_ACCESS_ROLE_ARN;

/**
 * Gets temporary credentials by assuming the client access role
 */
async function getCredentials() {
  const stsClient = new STSClient({ region: AWS_REGION });

  try {
    const assumeRoleCommand = new AssumeRoleCommand({
      RoleArn: CLIENT_ACCESS_ROLE_ARN,
      RoleSessionName: "mcp-client-session",
      DurationSeconds: 900, // 15 minutes
    });

    const response = await stsClient.send(assumeRoleCommand);

    if (!response.Credentials) {
      throw new Error("Failed to get temporary credentials from STS");
    }

    return {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken,
    };
  } catch (error) {
    console.error("Failed to assume client access role:", error);
    throw error;
  }
}

export type McpToolsClient = {
  anthropicTools: Anthropic.Tool[];
  callTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

/**
 * Creates and connects an MCP client, returning Anthropic-compatible tools
 * and a callTool function for server-side tool execution.
 * Returns empty tools with graceful degradation if connection fails.
 */
export async function getMcpTools(): Promise<McpToolsClient> {
  if (!MCP_SERVER_URL) {
    console.log("MCP_SERVER_URL not set, skipping MCP tools");
    return {
      anthropicTools: [],
      callTool: async () => ({}),
      close: async () => {},
    };
  }

  try {
    const { accessKeyId, secretAccessKey, sessionToken } =
      await getCredentials();

    const signedFetch = createSignedFetcher({
      service: "lambda",
      region: AWS_REGION,
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken,
      },
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(MCP_SERVER_URL),
      { fetch: signedFetch },
    );

    const client = new Client({
      name: "ask-archil-mcp-client",
      version: "1.0.0",
    });
    await client.connect(transport);

    const { tools } = await client.listTools();
    console.log(
      "MCP tools loaded:",
      tools.map((t) => t.name),
    );

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Anthropic.Tool["input_schema"]) ?? {
        type: "object",
        properties: {},
      },
    }));

    // Build lookup: toolName → resourceUri from _meta
    const toolMetaMap = new Map<string, string>();
    for (const t of tools) {
      const resourceUri = (t._meta as any)?.ui?.resourceUri;
      if (typeof resourceUri === "string") {
        toolMetaMap.set(t.name, resourceUri);
      }
    }

    return {
      anthropicTools,
      callTool: async (name: string, input: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: input }) as {
          content: Array<Record<string, unknown>>;
          structuredContent?: unknown;
          isError?: boolean;
        };

        // If this tool has an associated UI resource, fetch the HTML and inject it
        const resourceUri = toolMetaMap.get(name);
        if (resourceUri) {
          try {
            const resourceResult = await client.readResource({ uri: resourceUri });
            const first = resourceResult.contents?.[0];
            if (first && "text" in first) {
              result.content.push({
                type: "resource",
                resource: { uri: resourceUri, mimeType: "text/html", text: first.text },
              } as any);
            }
          } catch (err) {
            console.error("Failed to read UI resource:", resourceUri, err);
          }
        }

        return result;
      },
      close: () => client.close(),
    };
  } catch (error) {
    console.error("Failed to connect to MCP server:", error);
    return {
      anthropicTools: [],
      callTool: async () => ({}),
      close: async () => {},
    };
  }
}
