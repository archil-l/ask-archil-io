"use client";
import { Conversation } from "~/components/ai-elements/conversation";
import { ConversationContent } from "~/components/ai-elements/conversation";
import { Message } from "~/components/ai-elements/message";
import { MessageContent } from "~/components/ai-elements/message";
import { useAutoScroll } from "../hooks/use-auto-scroll";
import { UIMessagePartRenderer } from "./message-renderers";
import { cn } from "~/lib/utils";
import { useConversationContext } from "~/contexts/conversation-context";
import { AgentUIMessage } from "~/lib/message-schema";

interface ConversationAreaProps {
  className: string;
}

export function ConversationArea({ className }: ConversationAreaProps) {
  const { messages, isLoading } = useConversationContext();
  const { scrollAnchorRef } = useAutoScroll({ messages, isLoading });

  return (
    <Conversation className={cn("flex-1 h-auto", className)}>
      <ConversationContent className="gap-4">
        {messages.map((message: AgentUIMessage) => (
          <div key={message.id}>
            <Message from={message.role}>
              <MessageContent className="transition-all">
                {message.parts.map((part, index) => (
                  <UIMessagePartRenderer
                    key={`${message.id}-part-${index}`}
                    part={part}
                    index={index}
                    messageId={message.id}
                    isStreaming={
                      isLoading && message === messages[messages.length - 1]
                    }
                  />
                ))}
              </MessageContent>
            </Message>
          </div>
        ))}

        <div ref={scrollAnchorRef} className="h-[100px]"></div>
      </ConversationContent>
    </Conversation>
  );
}
