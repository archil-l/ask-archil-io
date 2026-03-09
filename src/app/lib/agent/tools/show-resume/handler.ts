import { AddToolOutputFn } from "~/lib/agent/hooks/use-client-tool-handlers";

/**
 * Creates a show resume handler for the AI chat tool system.
 * This handler reports that the resume has been displayed (client-side rendering).
 */
export function createShowResumeHandler() {
  return async (toolCallId: string, addToolOutput: AddToolOutputFn) => {
    await addToolOutput({
      state: "output-available",
      tool: "showResume",
      toolCallId,
      output: { displayed: true },
    });

    console.log(`[showResume] Tool execution completed`);
  };
}
