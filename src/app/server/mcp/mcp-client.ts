import { createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createSignedFetcher } from "aws-sigv4-fetch";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

// MCP Server configuration
const MCP_SERVER_URL =
  process.env.MCP_SERVER_URL ||
  "https://pkwf55vc2ekorcesqaubtw2sny0dfzbv.lambda-url.us-east-1.on.aws/mcp";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
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

export async function createMcpToolsClient() {
  const { accessKeyId, secretAccessKey, sessionToken } = await getCredentials();

  // 1. Setup the SigV4 signed fetcher
  const signedFetch = createSignedFetcher({
    service: "lambda",
    region: AWS_REGION,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    fetch: signedFetch,
  });

  const mcpClient = await createMCPClient({
    transport,
  });

  return mcpClient;
}

/**
 * Creates and returns an MCP client connected to the mcp-ask-archil server.
 * Uses custom SigV4 transport for authenticated Lambda Function URL.
 */

/**
 * Gets tools from the MCP server.
 * Returns an empty object if connection fails to allow graceful degradation.
 */
export async function getMcpTools() {
  try {
    const mcpClient = await createMcpToolsClient();
    const tools = await mcpClient.tools();
    console.log("MCP tools loaded:", Object.keys(tools));
    return { tools, client: mcpClient };
  } catch (error) {
    console.error("Failed to connect to MCP server:", error);
    // Return empty tools to allow graceful degradation
    return { tools: {}, client: null };
  }
}

/**
 * Closes the MCP client connection if it exists.
 */
export async function closeMcpClient(
  client: Awaited<ReturnType<typeof createMCPClient>> | null,
) {
  if (client) {
    try {
      await client.close();
    } catch (error) {
      console.error("Error closing MCP client:", error);
    }
  }
}
