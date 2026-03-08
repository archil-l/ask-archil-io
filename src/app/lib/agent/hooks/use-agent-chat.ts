import { useChat, UseChatHelpers } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

import { AgentUIMessage } from "~/lib/message-schema";
import { ClientToolHandlers } from "./use-client-tool-handlers";

interface UseAgentChatOptions {
  initialMessages?: AgentUIMessage[];
  streamingEndpoint: string;
  token: string;
  toolHandlers: ClientToolHandlers;
}

export const useAgentChat = (
  options: UseAgentChatOptions,
): UseChatHelpers<AgentUIMessage> => {
  const { initialMessages, streamingEndpoint, token, toolHandlers } = options;

  // Build transport config with streaming endpoint and JWT token
  const transportConfig = {
    api: streamingEndpoint,
    headers: { Authorization: `Bearer ${token}` },
  };

  const chat = useChat({
    transport: new DefaultChatTransport(transportConfig),
    messages: initialMessages,
    onToolCall: async ({ toolCall }) => {
      const toolName = toolCall.toolName;
      const toolCallId = toolCall.toolCallId;

      // Look up the handler dynamically
      const handler = toolHandlers[toolName];
      if (handler) await handler(toolCallId, chat.addToolOutput);
    },
  });

  return chat;
};
