"use client";

import type {
  AgentUIMessagePart,
  TextUIPart,
  ReasoningUIPart,
  DynamicToolUIPart,
  ToolUIPart,
  FileUIPart,
  SourceUrlUIPart,
  SourceDocumentUIPart,
  DataUIPart,
} from "~/lib/message-schema";
import {
  isTextUIPart,
  isReasoningUIPart,
  isToolUIPart,
  isFileUIPart,
} from "~/lib/message-schema";
import { MessageResponse } from "~/components/ai-elements/message";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "~/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "~/components/ai-elements/tool";
import { ToggleThemeToolUI } from "../../../lib/agent/tools/toggle-theme/toggle-theme-tool-ui";
import { CheckThemeToolUI } from "../../../lib/agent/tools/check-theme/check-theme-tool-ui";
import {
  ThemeToggleOutputType,
  ThemeCheckOutputType,
} from "~/lib/agent/tools/client-side-tools";
import { WebPreviewToolUI } from "~/lib/agent/tools/web-preview";
import { ShowResumeToolUI } from "~/lib/agent/tools/show-resume";
import {
  McpToolUI,
  extractUIResource,
} from "~/lib/agent/tools/mcp-ui/mcp-tool-ui";

interface UIMessagePartRendererProps {
  part: AgentUIMessagePart;
  index: number;
  messageId: string;
  isStreaming: boolean;
}

export function UIMessagePartRenderer({
  part,
  index,
  messageId,
  isStreaming,
}: UIMessagePartRendererProps) {
  console.log(part);

  // Handle text parts
  if (isTextUIPart(part)) {
    const textPart = part as TextUIPart;
    return (
      <MessageResponse key={`${messageId}-text-${index}`}>
        {textPart.text}
      </MessageResponse>
    );
  }

  // Handle reasoning parts
  if (isReasoningUIPart(part)) {
    const reasoningPart = part as ReasoningUIPart;
    return (
      <Reasoning
        key={`${messageId}-reasoning-${index}`}
        isStreaming={isStreaming}
        defaultOpen={true}
      >
        <ReasoningTrigger />
        <ReasoningContent>{reasoningPart.text}</ReasoningContent>
      </Reasoning>
    );
  }

  // Handle tool parts (both dynamic-tool and legacy tool-* types)
  if (isToolUIPart(part)) {
    const isDynamic = part.type === "dynamic-tool";
    const dynPart = isDynamic ? (part as DynamicToolUIPart) : null;
    const staticPart = !isDynamic ? (part as ToolUIPart) : null;
    const state = part.state || "input-available";
    const toolIsStreaming = state === "input-streaming";
    const hasOutput = state === "output-available" || state === "output-error";

    // Resolve tool name
    const toolName = isDynamic ? dynPart!.toolName : staticPart!.type.slice(5);

    // Custom UIs for known client-side tools
    if (toolName === "toggleTheme" && dynPart) {
      return (
        <ToggleThemeToolUI
          key={`${messageId}-tool-${index}`}
          tool={dynPart}
          theme={(dynPart.output as ThemeToggleOutputType)?.newTheme}
        />
      );
    }

    if (toolName === "checkTheme" && dynPart) {
      return (
        <CheckThemeToolUI
          key={`${messageId}-tool-${index}`}
          tool={dynPart}
          theme={(dynPart.output as ThemeCheckOutputType)?.currentTheme}
        />
      );
    }

    if (toolName === "webpreview" && dynPart) {
      const url =
        dynPart.input &&
        typeof dynPart.input === "object" &&
        "url" in dynPart.input
          ? (dynPart.input as any).url
          : "";
      return (
        <WebPreviewToolUI
          key={`${messageId}-tool-${index}`}
          tool={dynPart}
          url={url}
        />
      );
    }

    if (toolName === "showResume" && dynPart) {
      return (
        <ShowResumeToolUI key={`${messageId}-tool-${index}`} tool={dynPart} />
      );
    }

    // MCP tool with UIResource HTML
    if (dynPart && dynPart.state === "output-available") {
      const uiResource = extractUIResource(dynPart.output);
      if (uiResource) {
        return (
          <McpToolUI
            key={`${messageId}-tool-${index}`}
            tool={dynPart}
            html={uiResource.html}
            permissions={uiResource.permissions}
          />
        );
      }
    }

    // Generic tool rendering
    const toolHeaderProps = isDynamic
      ? {
          title: dynPart!.title || dynPart!.toolName,
          type: "dynamic-tool" as const,
          state,
          toolName: dynPart!.toolName,
        }
      : {
          title: staticPart!.title || staticPart!.type.slice(5),
          type: staticPart!.type,
          state,
        };

    return (
      <Tool key={`${messageId}-tool-${index}`}>
        <ToolHeader {...(toolHeaderProps as any)} />
        <ToolContent>
          {(part.input !== undefined || toolIsStreaming) && (
            <ToolInput input={part.input} />
          )}
          {hasOutput && (
            <ToolOutput output={part.output} errorText={part.errorText || ""} />
          )}
        </ToolContent>
      </Tool>
    );
  }

  // Handle file parts
  if (isFileUIPart(part)) {
    const filePart = part as FileUIPart;
    const mediaType = filePart.mediaType || "";
    const isImage = mediaType.startsWith("image/");

    if (isImage && filePart.url) {
      return (
        <img
          key={`${messageId}-file-${index}`}
          alt={filePart.filename || "attachment"}
          src={filePart.url}
          className="max-w-full rounded-lg"
        />
      );
    }

    return (
      <div
        key={`${messageId}-file-${index}`}
        className="rounded-lg border border-muted bg-muted/50 p-4"
      >
        <div className="text-sm">
          <div className="font-medium">{filePart.filename || "File"}</div>
          <div className="text-xs text-muted-foreground">{mediaType}</div>
        </div>
      </div>
    );
  }

  // Handle source-url parts
  if ("type" in part && part.type === "source-url") {
    const sourcePart = part as SourceUrlUIPart;
    return (
      <div
        key={`${messageId}-source-url-${index}`}
        className="rounded-lg border border-muted bg-muted/50 p-3"
      >
        <a
          href={sourcePart.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          {sourcePart.title || sourcePart.url}
        </a>
      </div>
    );
  }

  // Handle source-document parts
  if ("type" in part && part.type === "source-document") {
    const sourcePart = part as SourceDocumentUIPart;
    return (
      <div
        key={`${messageId}-source-doc-${index}`}
        className="rounded-lg border border-muted bg-muted/50 p-3"
      >
        <div className="text-sm">
          <div className="font-medium">{sourcePart.title}</div>
          {sourcePart.filename && (
            <div className="text-xs text-muted-foreground">
              {sourcePart.filename}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Handle data parts
  if ("type" in part && part.type.startsWith("data-")) {
    const dataPart = part as DataUIPart;
    return (
      <div
        key={`${messageId}-data-${index}`}
        className="rounded-lg border border-muted bg-muted/50 p-4"
      >
        <pre className="overflow-x-auto text-xs">
          {JSON.stringify(dataPart.data, null, 2)}
        </pre>
      </div>
    );
  }

  // Fallback for unknown part types
  return null;
}
