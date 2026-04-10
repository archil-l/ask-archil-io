"use client";

import type { DynamicToolUIPart } from "~/lib/message-schema";
import { WebPreviewToolUI } from "../web-preview";

// Hardcoded resume URL
const RESUME_URL =
  "https://1drv.ms/b/c/21c15a5e07446ee2/IQRBbF567BgIT7TmH85PlsJIAVRhsMaqVC3pX-10johEVvM";

export interface ShowResumeToolUIProps {
  tool: DynamicToolUIPart;
  className?: string;
}

/**
 * ShowResumeToolUI - Dynamic UI component for the showResume tool
 *
 * Renders a web preview of the resume with a hardcoded URL.
 * This wraps WebPreviewToolUI to provide a specialized resume viewing experience.
 */
export function ShowResumeToolUI({ tool, className }: ShowResumeToolUIProps) {
  return (
    <WebPreviewToolUI
      tool={tool}
      url={RESUME_URL}
      className={className}
      editUrl={false}
      showNavigationButtons={false}
      title={"Archil's Resume"}
      showConsole={false}
    />
  );
}
