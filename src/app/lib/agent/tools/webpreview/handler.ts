import { AddToolOutputFn } from "~/lib/agent/hooks/use-client-tool-handlers";

/**
 * Creates a webpreview handler for the AI chat tool system.
 * This handler processes the webpreview tool call and reports the result.
 */
export function createWebPreviewHandler() {
  return async (toolCallId: string, addToolOutput: AddToolOutputFn) => {
    // For now, we'll assume the webpreview always succeeds
    // In the future, we could add validation or error handling here

    await addToolOutput({
      state: "output-available",
      tool: "webpreview",
      toolCallId,
      output: { opened: true },
    });

    console.log(`[webpreview] Tool execution completed`);
  };
}
