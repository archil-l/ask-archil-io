"use client";

import { Button } from "~/components/ui/button";
import { ListRestart, MailIcon, MoonIcon, SunIcon } from "lucide-react";
import { useThemeContext } from "~/contexts/theme-context";
import { useConversationContext } from "~/contexts/conversation-context";

export const WelcomeHeader = () => {
  const { theme, toggleTheme } = useThemeContext();
  const { handleClearConversation } = useConversationContext();

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="flex justify-end items-center px-4 py-3 gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="transition-none bg-accent/40"
          onClick={handleClearConversation}
          aria-label="Reset conversation"
        >
          <ListRestart className="size-5" strokeWidth={1.25} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="transition-none bg-accent/40"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
        >
          {theme === "dark" ? (
            <SunIcon className="size-5" strokeWidth={1.25} />
          ) : (
            <MoonIcon className="size-5" strokeWidth={1.25} />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="transition-none bg-accent/40"
          onClick={() => (window.location.href = "mailto:archil-l@outlook.com")}
          aria-label="Contact"
        >
          <MailIcon className="size-5" strokeWidth={1.25} />
        </Button>
      </div>
    </header>
  );
};
