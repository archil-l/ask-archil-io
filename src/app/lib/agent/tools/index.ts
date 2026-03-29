import {
  toggleThemeTool,
  checkThemeTool,
  showResumeTool,
} from "./client-side-tools";

export type ToolDef = {
  description: string;
  inputSchema: import("zod").ZodType;
  outputSchema?: import("zod").ZodType;
};

export type ToolSet = Record<string, ToolDef>;

export const allTools = {
  toggleTheme: toggleThemeTool,
  checkTheme: checkThemeTool,
  showResume: showResumeTool,
} satisfies ToolSet;
