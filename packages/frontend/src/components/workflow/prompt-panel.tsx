import { Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export interface PromptEntry {
  role: "user" | "assistant";
  content: string;
  unsupportedCapabilities?: string[];
}

interface PromptPanelProps {
  history: PromptEntry[];
  loading: boolean;
  onSubmit: (prompt: string) => void;
}

export function PromptPanel({ history, loading, onSubmit }: PromptPanelProps) {
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">
          Prompt
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 p-4">
          {history.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">
              Describe what you want your workflow to do. For example:
              &ldquo;When an angry session closes, send a Slack message to the
              alerts channel with the customer name.&rdquo;
            </p>
          )}
          {history.map((entry, i) =>
            entry.role === "user" ? (
              <div
                key={i}
                className="rounded-lg bg-accent/50 px-3 py-2 text-sm text-foreground"
              >
                {entry.content}
              </div>
            ) : (
              <div
                key={i}
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
              >
                <p>{entry.content}</p>
                {entry.unsupportedCapabilities &&
                  entry.unsupportedCapabilities.length > 0 && (
                    <ul className="mt-1.5 list-disc pl-5 text-xs text-muted-foreground">
                      {entry.unsupportedCapabilities.map((cap) => (
                        <li key={cap}>{cap}</li>
                      ))}
                    </ul>
                  )}
              </div>
            ),
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <svg
                className="size-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating workflow...
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <Textarea
            placeholder={
              history.length > 0
                ? "Refine your workflow..."
                : "Describe your workflow..."
            }
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            className="min-h-10 resize-none"
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!value.trim() || loading}
            title="Generate"
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
