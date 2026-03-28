"use client";

import { AppRenderer } from "@mcp-ui/client";
import { isUIResource } from "@mcp-ui/client";
import type { DynamicToolUIPart } from "ai";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
 * Renders an MCP tool's UIResource in a sandboxed iframe via @mcp-ui/client.
 */
export function McpToolUI({ tool, html }: McpToolUIProps) {
  const sandboxUrl = new URL("/sandbox.html", window.location.origin);

  return (
    <AppRenderer
      toolName={tool.toolName}
      sandbox={{ url: sandboxUrl }}
      html={html}
      toolInput={
        tool.input instanceof Object
          ? (tool.input as Record<string, unknown>)
          : undefined
      }
      toolResult={tool.output as CallToolResult | undefined}
    />
  );
}
