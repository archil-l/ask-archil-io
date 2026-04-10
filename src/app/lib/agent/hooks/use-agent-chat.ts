"use client";

import { useState, useCallback, useRef } from "react";
import {
  AgentUIMessage,
  AgentMetadata,
  DynamicToolUIPart,
  AddToolOutputFn,
} from "~/lib/message-schema";
import { ClientToolHandlers } from "./use-client-tool-handlers";

export interface UseAgentChatOptions {
  initialMessages?: AgentUIMessage[];
  streamingEndpoint: string;
  token: string;
  toolHandlers: ClientToolHandlers;
}

export type ChatStatus = "idle" | "submitted" | "streaming" | "error";

export interface AgentChatResult {
  messages: AgentUIMessage[];
  sendMessage: (msg: { text: string; metadata?: AgentMetadata }) => void;
  setMessages: (messages: AgentUIMessage[]) => void;
  status: ChatStatus;
  error: Error | undefined;
}

// SSE event types from server
type SSEEvent =
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-input-done"; toolCallId: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; output: unknown }
  | { type: "tool-error"; toolCallId: string; error: string }
  | {
      type: "client-tools-needed";
      tools: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: string };

function createUserMessage(
  text: string,
  metadata?: AgentMetadata,
): AgentUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }],
    metadata,
  };
}

function createAssistantMessage(): AgentUIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [],
  };
}

/**
 * Updates the last assistant message in the messages array.
 * Returns a new array with the updated message.
 */
function updateLastAssistant(
  messages: AgentUIMessage[],
  assistantId: string,
  updater: (msg: AgentUIMessage) => AgentUIMessage,
): AgentUIMessage[] {
  return messages.map((m) =>
    m.id === assistantId && m.role === "assistant" ? updater(m) : m,
  );
}

export function useAgentChat(options: UseAgentChatOptions): AgentChatResult {
  const { initialMessages, streamingEndpoint, token, toolHandlers } = options;

  const [messages, setMessages] = useState<AgentUIMessage[]>(
    initialMessages ?? [],
  );
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | undefined>();

  // Keep a ref to the latest messages for use inside async callbacks
  const messagesRef = useRef<AgentUIMessage[]>(messages);
  messagesRef.current = messages;

  const doStream = useCallback(
    async (
      allMessages: AgentUIMessage[],
      toolResults?: Array<{
        toolCallId: string;
        toolName: string;
        output: unknown;
      }>,
    ) => {
      setStatus("submitted");
      setError(undefined);

      let response: Response;
      try {
        response = await fetch(streamingEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messages: allMessages, toolResults }),
        });
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (!response.ok || !response.body) {
        setStatus("error");
        setError(new Error(`HTTP ${response.status}`));
        return;
      }

      // Create a new assistant message placeholder
      const assistantMsg = createAssistantMessage();
      const assistantId = assistantMsg.id;

      setMessages((prev) => [...prev, assistantMsg]);
      setStatus("streaming");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Track tool call state
      let textPartIndex = -1;
      const toolPartIndexByCallId = new Map<string, number>();
      let pendingClientTools: Array<{
        toolCallId: string;
        toolName: string;
        input: unknown;
      }> = [];

      // Working copy of parts (modified in place, then committed via setMessages)
      const workingParts: AgentUIMessage["parts"] = [];

      function commitParts() {
        setMessages((prev) =>
          updateLastAssistant(prev, assistantId, (msg) => ({
            ...msg,
            parts: [...workingParts],
          })),
        );
      }

      function handleEvent(event: SSEEvent) {
        switch (event.type) {
          case "text-delta": {
            if (textPartIndex === -1) {
              workingParts.push({ type: "text", text: event.delta });
              textPartIndex = workingParts.length - 1;
            } else {
              const part = workingParts[textPartIndex] as {
                type: "text";
                text: string;
              };
              part.text += event.delta;
            }
            commitParts();
            break;
          }

          case "reasoning-delta": {
            // Find existing reasoning part or create one
            let reasoningIdx = workingParts.findIndex(
              (p) => p.type === "reasoning",
            );
            if (reasoningIdx === -1) {
              workingParts.push({ type: "reasoning", text: event.delta });
              reasoningIdx = workingParts.length - 1;
            } else {
              const part = workingParts[reasoningIdx] as {
                type: "reasoning";
                text: string;
              };
              part.text += event.delta;
            }
            commitParts();
            break;
          }

          case "tool-start": {
            const toolPart: DynamicToolUIPart = {
              type: "dynamic-tool",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              state: "input-streaming",
              input: {},
            };
            workingParts.push(toolPart);
            toolPartIndexByCallId.set(event.toolCallId, workingParts.length - 1);
            commitParts();
            break;
          }

          case "tool-input-done": {
            const idx = toolPartIndexByCallId.get(event.toolCallId);
            if (idx !== undefined) {
              const toolPart = workingParts[idx] as DynamicToolUIPart;
              toolPart.input = event.input;
              toolPart.state = "input-available";
              commitParts();
            }
            break;
          }

          case "tool-result": {
            const idx = toolPartIndexByCallId.get(event.toolCallId);
            if (idx !== undefined) {
              const toolPart = workingParts[idx] as DynamicToolUIPart;
              toolPart.output = event.output;
              toolPart.state = "output-available";
              commitParts();
            }
            break;
          }

          case "tool-error": {
            const idx = toolPartIndexByCallId.get(event.toolCallId);
            if (idx !== undefined) {
              const toolPart = workingParts[idx] as DynamicToolUIPart;
              toolPart.errorText = event.error;
              toolPart.state = "output-error";
              commitParts();
            }
            break;
          }

          case "client-tools-needed": {
            pendingClientTools = event.tools;
            break;
          }

          case "error": {
            setError(new Error(event.error));
            setStatus("error");
            break;
          }

          case "done": {
            // handled after stream ends
            break;
          }
        }
      }

      // Read SSE stream
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;

            try {
              const event = JSON.parse(raw) as SSEEvent;
              handleEvent(event);
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Handle client-side tool execution
      if (pendingClientTools.length > 0) {
        const collectedResults: Array<{
          toolCallId: string;
          toolName: string;
          output: unknown;
        }> = [];

        for (const clientTool of pendingClientTools) {
          // Find and update tool part to input-available
          const idx = toolPartIndexByCallId.get(clientTool.toolCallId);
          if (idx !== undefined) {
            const toolPart = workingParts[idx] as DynamicToolUIPart;
            toolPart.input = clientTool.input;
            toolPart.state = "input-available";
            commitParts();
          }

          // Execute the client handler
          const handler = toolHandlers[clientTool.toolName];
          if (handler) {
            let resolvedOutput: unknown = null;

            const addToolOutput: AddToolOutputFn = ({ output, state }) => {
              resolvedOutput = output;
              // Update the tool part with the result
              const partIdx = toolPartIndexByCallId.get(clientTool.toolCallId);
              if (partIdx !== undefined) {
                const toolPart = workingParts[partIdx] as DynamicToolUIPart;
                toolPart.output = output;
                toolPart.state =
                  state === "output-error" ? "output-error" : "output-available";
                commitParts();
              }
            };

            await handler(clientTool.toolCallId, addToolOutput);
            collectedResults.push({
              toolCallId: clientTool.toolCallId,
              toolName: clientTool.toolName,
              output: resolvedOutput,
            });
          }
        }

        // Re-submit with tool results — pass current messages (including the assistant message we just built)
        const currentMsgs = messagesRef.current;
        await doStream(currentMsgs, collectedResults);
        return;
      }

      setStatus("idle");
    },
    [streamingEndpoint, token, toolHandlers],
  );

  const sendMessage = useCallback(
    ({ text, metadata }: { text: string; metadata?: AgentMetadata }) => {
      const userMsg = createUserMessage(text, metadata);

      setMessages((prev) => {
        const next = [...prev, userMsg];
        // doStream is called with the next messages state
        doStream(next);
        return next;
      });
    },
    [doStream],
  );

  return {
    messages,
    sendMessage,
    setMessages,
    status,
    error,
  };
}
