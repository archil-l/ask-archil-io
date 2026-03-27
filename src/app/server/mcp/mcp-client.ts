import { createMCPClient } from "@ai-sdk/mcp";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
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
async function getTemporaryCredentials() {
  if (!CLIENT_ACCESS_ROLE_ARN) {
    // If no role ARN, use default credentials (for local development)
    return defaultProvider();
  }

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

/**
 * Custom MCP Transport that signs requests with AWS SigV4
 * for authenticated Lambda Function URL calls
 */
class SigV4HttpTransport {
  private url: string;
  private signer: SignatureV4;
  private sessionId: string | undefined;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(url: string) {
    this.url = url;
    // Initialize with default credentials, will get temporary ones when needed
    this.signer = new SignatureV4({
      service: "lambda",
      region: AWS_REGION,
      credentials: defaultProvider(),
      sha256: Sha256,
    });
  }

  async start(): Promise<void> {
    // Initialize connection - send initialize request
    console.log("SigV4HttpTransport: Starting connection to", this.url);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    try {
      const urlObj = new URL(this.url);
      const body = JSON.stringify(message);

      // Get temporary credentials for each request
      const credentials = await getTemporaryCredentials();

      // Create a new signer with temporary credentials
      const signer = new SignatureV4({
        service: "lambda",
        region: AWS_REGION,
        credentials: credentials,
        sha256: Sha256,
      });

      // Build the request for signing
      const httpRequest = new HttpRequest({
        method: "POST",
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port ? parseInt(urlObj.port) : undefined,
        path: urlObj.pathname + urlObj.search,
        headers: {
          host: urlObj.hostname,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: body,
      });

      // Sign the request with temporary credentials
      const signedRequest = await signer.sign(httpRequest);

      // Convert signed headers to format expected by fetch
      const signedHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(signedRequest.headers)) {
        signedHeaders[key] = value as string;
      }

      // Make the actual request with signed headers
      const response = await fetch(this.url, {
        method: "POST",
        headers: signedHeaders,
        body: body,
      });

      // Store session ID if returned
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this.sessionId = sessionId;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ${response.status}: ${response.statusText} - ${errorText}`,
        );
      }

      // Parse response - handle both JSON and SSE formats
      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // Handle SSE streaming response
        const text = await response.text();
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                const parsed = JSON.parse(data);
                if (this.onmessage) {
                  this.onmessage(parsed);
                }
              } catch {
                // Skip non-JSON lines
              }
            }
          }
        }
      } else {
        // Handle regular JSON response
        const responseData = await response.json();
        if (this.onmessage) {
          this.onmessage(responseData);
        }
      }
    } catch (error) {
      console.error("SigV4HttpTransport send error:", error);
      if (this.onerror) {
        this.onerror(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    console.log("SigV4HttpTransport: Closing connection");
    if (this.onclose) {
      this.onclose();
    }
  }
}

// Type for JSON-RPC message
interface JSONRPCMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Creates and returns an MCP client connected to the mcp-ask-archil server.
 * Uses custom SigV4 transport for authenticated Lambda Function URL.
 */
export async function createMcpToolsClient() {
  const transport = new SigV4HttpTransport(MCP_SERVER_URL);

  const mcpClient = await createMCPClient({
    transport: transport,
  });

  return mcpClient;
}

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
