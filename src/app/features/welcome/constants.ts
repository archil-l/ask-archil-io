export const WELCOME_MESSAGE = `# Hi there! 🖖🏻

My name is Archil Lelashvili - I'm a software engineer at [Amazon Robotics](https://www.aboutamazon.com/news/tag/robotics), building agentic AI systems, full-stack web applications and more. 
<br>

Welcome to my personal page! I'm excited to share my work, projects, and insights into my engineering journey. Glad to have you here!

This page is powered by an AI assistant, you can ask any questions :)
`;

import {
  Briefcase,
  FileText,
  Mail,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";
import { AgentUIMessage } from "~/lib/message-schema";

export interface SuggestionPrompt {
  text: string;
  icon: LucideIcon;
  iconColor: string;
}

export const PREDEFINED_PROMPTS: SuggestionPrompt[] = [
  {
    text: "Tell me about Archil's experience",
    icon: Briefcase,
    iconColor: "text-blue-500",
  },
  {
    text: "Show me Archil's resume",
    icon: FileText,
    iconColor: "text-purple-500",
  },
  {
    text: "What's under the hood of this site?",
    icon: SquareTerminal,
    iconColor: "text-orange-500",
  },
  {
    text: "How can I get in touch with Archil?",
    icon: Mail,
    iconColor: "text-green-500",
  },
];

export const INITIAL_WELCOME_MESSAGE: AgentUIMessage = {
  id: "welcome",
  role: "assistant",
  parts: [{ type: "text", text: WELCOME_MESSAGE }],
};
