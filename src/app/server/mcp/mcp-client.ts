import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getToolUiResourceUri,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { createSignedFetcher } from "aws-sigv4-fetch";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import type Anthropic from "@anthropic-ai/sdk";
import type { Tool, Resource } from "@modelcontextprotocol/sdk/types.js";

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

export interface ServerInfo {
  name: string;
  client: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
  appHtmlCache: Map<string, string>;
}

export type McpToolsClient = {
  anthropicTools: Anthropic.Tool[];
  serverInfo: ServerInfo | null;
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
      serverInfo: null,
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

    const serverUrl = new URL(MCP_SERVER_URL);

    // Try Streamable HTTP first, fall back to SSE
    let client: Client;
    try {
      client = new Client({
        name: "ask-archil-mcp-client",
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(serverUrl, { fetch: signedFetch }),
      );
      console.log("Connected via Streamable HTTP transport");
    } catch (streamableError) {
      console.log(
        "Streamable HTTP failed, falling back to SSE:",
        streamableError,
      );
      client = new Client({
        name: "ask-archil-mcp-client",
        version: "1.0.0",
      });
      await client.connect(
        new SSEClientTransport(serverUrl, { fetch: signedFetch }),
      );
      console.log("Connected via SSE transport");
    }

    // Get tools list
    const { tools } = await client.listTools();
    console.log(
      "MCP tools loaded:",
      tools.map((t) => t.name),
    );

    // Get resources list
    const { resources } = await client.listResources();
    console.log(
      "MCP resources loaded:",
      resources.map((r) => r.uri),
    );

    // Build maps for caching
    const toolsMap = new Map(tools.map((tool) => [tool.name, tool]));
    const resourcesMap = new Map(resources.map((r) => [r.uri, r]));

    // Convert to Anthropic format
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: (t.inputSchema as Anthropic.Tool["input_schema"]) ?? {
        type: "object",
        properties: {},
      },
    }));

    // Build lookup using official helper
    const toolMetaMap = new Map<string, string>();
    for (const t of tools) {
      const uiResourceUri = getToolUiResourceUri(t);
      if (uiResourceUri) {
        toolMetaMap.set(t.name, uiResourceUri);
      }
    }

    // Prepare server info object
    const serverInfo: ServerInfo = {
      name: client.getServerVersion()?.name ?? MCP_SERVER_URL,
      client,
      tools: toolsMap,
      resources: resourcesMap,
      appHtmlCache: new Map(),
    };

    return {
      anthropicTools,
      serverInfo,
      callTool: async (name: string, input: Record<string, unknown>) => {
        const result = (await client.callTool({ name, arguments: input })) as {
          content: Array<Record<string, unknown>>;
          structuredContent?: unknown;
          isError?: boolean;
        };

        // If this tool has an associated UI resource, fetch properly
        const resourceUri = toolMetaMap.get(name);
        if (resourceUri) {
          try {
            // Check cache first
            if (!serverInfo.appHtmlCache.has(resourceUri)) {
              const resourceResult = await client.readResource({
                uri: resourceUri,
              });

              if (resourceResult.contents.length === 1) {
                const content = resourceResult.contents[0];

                // Validate correct MIME type
                if (content.mimeType === RESOURCE_MIME_TYPE) {
                  // Handle both blob and text formats
                  const html =
                    "blob" in content ? atob(content.blob) : content.text;

                  // Get metadata with proper fallback: content-level → listing-level
                  const contentMeta =
                    (content as any)._meta || (content as any).meta;
                  const listingResource = serverInfo.resources.get(resourceUri);
                  const listingMeta = (listingResource as any)?._meta;
                  const uiMeta = contentMeta?.ui ?? listingMeta?.ui;

                  // Store full resource data in cache
                  serverInfo.appHtmlCache.set(resourceUri, html);

                  result.content.push({
                    type: "resource",
                    resource: {
                      uri: resourceUri,
                      mimeType: RESOURCE_MIME_TYPE,
                      text: html,
                      meta: uiMeta,
                    },
                  } as any);
                }
              }
            } else {
              // Return cached version
              result.content.push({
                type: "resource",
                resource: {
                  uri: resourceUri,
                  mimeType: RESOURCE_MIME_TYPE,
                  text: serverInfo.appHtmlCache.get(resourceUri),
                },
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
      serverInfo: null,
      callTool: async () => ({}),
      close: async () => {},
    };
  }
}
