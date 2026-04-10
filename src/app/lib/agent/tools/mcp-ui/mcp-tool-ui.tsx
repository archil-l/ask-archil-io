"use client";

import { useEffect, useRef, useState } from "react";
import {
  RESOURCE_MIME_TYPE,
  AppBridge,
  PostMessageTransport,
  type McpUiSandboxProxyReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { DynamicToolUIPart } from "~/lib/message-schema";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const log = {
  info: console.log.bind(console, "[MCP-UI]"),
  warn: console.warn.bind(console, "[MCP-UI]"),
  error: console.error.bind(console, "[MCP-UI]"),
};

/**
 * Checks if a content item is a UI resource (MCP App).
 * Replaces the @mcp-ui/client isUIResource function.
 */
function isUIResource(item: unknown): item is {
  type: "resource";
  resource: { mimeType?: string; text?: string; blob?: string };
} {
  if (!item || typeof item !== "object") return false;
  const obj = item as Record<string, unknown>;
  if (obj.type !== "resource") return false;
  const resource = obj.resource as Record<string, unknown> | undefined;
  if (!resource || typeof resource !== "object") return false;
  return resource.mimeType === RESOURCE_MIME_TYPE;
}

// Implementation info for AppBridge
const IMPLEMENTATION = { name: "AskArchil Host", version: "1.0.0" };

/**
 * Extracts the HTML string from a CallToolResult that contains a UIResource.
 * Returns null if no UIResource is found.
 */
export function extractUIResourceHtml(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const result = output as { content?: unknown[] };
  if (!Array.isArray(result.content)) return null;

  for (const item of result.content) {
    if (isUIResource(item as Parameters<typeof isUIResource>[0])) {
      const resource = (item as { resource: { text?: string; blob?: string } })
        .resource;
      if (resource.text) return resource.text;
      if (resource.blob) return atob(resource.blob);
    }
  }
  return null;
}

interface McpToolUIProps {
  tool: DynamicToolUIPart;
  html: string;
}

/**
 * Loads the sandbox proxy iframe and returns a promise that resolves
 * when the sandbox is ready to receive HTML content.
 */
function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxUrl: string,
): Promise<boolean> {
  // Prevent reload if already loaded
  if (iframe.src) return Promise.resolve(false);

  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");

  const readyNotification: McpUiSandboxProxyReadyNotification["method"] =
    "ui/notifications/sandbox-proxy-ready";

  const readyPromise = new Promise<boolean>((resolve) => {
    const listener = ({ source, data }: MessageEvent) => {
      if (
        source === iframe.contentWindow &&
        data?.method === readyNotification
      ) {
        log.info("Sandbox proxy ready");
        window.removeEventListener("message", listener);
        resolve(true);
      }
    };
    window.addEventListener("message", listener);
  });

  // Set src AFTER setting up the listener to avoid race condition
  log.info("Loading sandbox proxy...");
  iframe.src = sandboxUrl;

  return readyPromise;
}

/**
 * Hooks into AppBridge.oninitialized and returns a Promise that resolves
 * when the MCP App is initialized (i.e., when the inner iframe is ready).
 */
function hookInitializedCallback(appBridge: AppBridge): Promise<void> {
  const oninitialized = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = oninitialized;
      appBridge.oninitialized?.(...args);
    };
  });
}

/**
 * Renders an MCP tool's UIResource in a sandboxed iframe using AppBridge
 * for proper communication with the MCP app.
 */
export function McpToolUI({ tool, html }: McpToolUIProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appBridgeRef = useRef<AppBridge | null>(null);
  const initializedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sandboxUrl = new URL("/sandbox", window.location.origin);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || initializedRef.current) return;

    initializedRef.current = true;

    const initializeApp = async () => {
      try {
        log.info("Starting MCP App initialization...");

        // Wait for sandbox proxy to be ready (this also sets iframe.src)
        const ready = await loadSandboxProxy(iframe, sandboxUrl.href);
        if (!ready) {
          log.warn("Sandbox already loaded, skipping initialization");
          return;
        }

        // Create AppBridge - we pass null for client since we don't have an MCP client
        // on the frontend. AppBridge is designed to work without it for tool result display.
        const appBridge = new AppBridge(
          null as any, // No MCP client on frontend
          IMPLEMENTATION,
          {
            openLinks: {},
          },
          {
            hostContext: {
              theme: document.documentElement.classList.contains("dark")
                ? "dark"
                : "light",
              platform: "web",
              containerDimensions: { maxHeight: 600 },
              displayMode: "inline",
              availableDisplayModes: ["inline"],
            },
          },
        );
        appBridgeRef.current = appBridge;

        // Set up handlers before connecting
        appBridge.onopenlink = async (params) => {
          log.info("Open link request:", params);
          window.open(params.url, "_blank", "noopener,noreferrer");
          return {};
        };

        appBridge.onloggingmessage = (params) => {
          log.info("Log from MCP App:", params);
        };

        appBridge.onsizechange = async ({ width, height }) => {
          log.info("Size change request:", { width, height });
          if (height !== undefined && iframe) {
            iframe.style.height = `${height}px`;
          }
          if (width !== undefined && iframe) {
            iframe.style.minWidth = `min(${width}px, 100%)`;
          }
        };

        // Hook into initialization callback
        const appInitializedPromise = hookInitializedCallback(appBridge);

        // Connect the app bridge
        log.info("Connecting AppBridge...");
        await appBridge.connect(
          new PostMessageTransport(
            iframe.contentWindow!,
            iframe.contentWindow!,
          ),
        );

        // Send HTML to sandbox
        log.info("Sending HTML to sandbox...");
        await appBridge.sendSandboxResourceReady({ html });

        // Wait for app to initialize
        log.info("Waiting for MCP App to initialize...");
        await appInitializedPromise;
        log.info("MCP App initialized!");

        // Send tool input
        const toolInput =
          tool.input instanceof Object
            ? (tool.input as Record<string, unknown>)
            : {};
        log.info("Sending tool input:", toolInput);
        appBridge.sendToolInput({ arguments: toolInput });

        // Send tool result if available
        if (tool.output) {
          log.info("Sending tool result:", tool.output);
          appBridge.sendToolResult(tool.output as CallToolResult);
        }

        setIsLoading(false);
      } catch (err) {
        log.error("Failed to initialize MCP App:", err);
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    };

    initializeApp();

    // Cleanup
    return () => {
      if (appBridgeRef.current) {
        appBridgeRef.current.teardownResource({}).catch(() => {
          // Ignore errors during cleanup
        });
      }
    };
  }, [html, tool.input, tool.output, sandboxUrl.href]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {isLoading && (
        <div style={{ padding: "16px", color: "var(--muted-foreground)" }}>
          Loading MCP App...
        </div>
      )}
      {error && (
        <div style={{ padding: "16px", color: "var(--destructive)" }}>
          Error: {error}
        </div>
      )}
      <iframe
        ref={iframeRef}
        style={{
          width: "100%",
          height: "600px",
          border: "none",
          backgroundColor: "transparent",
          display: isLoading ? "none" : "block",
        }}
      />
    </div>
  );
}
