import { Theme } from "~/hooks/use-theme";
import { AddToolOutputFn } from "~/lib/agent/hooks/use-client-tool-handlers";

/**
 * Creates a check theme handler for the AI chat tool system.
 * This handler reads the current theme and reports it without toggling.
 */
export function createCheckThemeHandler(theme: Theme) {
  return async (toolCallId: string, addToolOutput: AddToolOutputFn) => {
    await addToolOutput({
      state: "output-available",
      tool: "checkTheme",
      toolCallId,
      output: { currentTheme: theme },
    });

    console.log(
      `[checkTheme] Tool execution completed - current theme: ${theme}`,
    );
  };
}
