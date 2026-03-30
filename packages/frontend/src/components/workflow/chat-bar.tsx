import { ArrowUp, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PromptEntry {
  role: "user" | "assistant";
  content: string;
  unsupportedCapabilities?: string[];
}

interface ChatBarProps {
  history: PromptEntry[];
  loading: boolean;
  onSubmit: (prompt: string) => void;
}

export function ChatBar({ history, loading, onSubmit }: ChatBarProps) {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.length, loading]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
    setValue("");
    resetTextareaHeight();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setValue("");
      setIsFocused(false);
      textareaRef.current?.blur();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${e.target.scrollHeight}px`;
  }

  function resetTextareaHeight() {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  const hasHistory = history.length > 0 || loading;
  const isExpanded = isFocused || value.trim().length > 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4">
      <div
        className="pointer-events-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur-sm transition-all"
        style={{ maxHeight: isExpanded && hasHistory ? "20rem" : undefined }}
      >
        {/* Message history — only visible when focused/expanded and has content */}
        {isExpanded && hasHistory && (
          <ScrollArea className="max-h-40 border-b border-border">
            <div className="flex flex-col gap-2 px-4 pt-3 pb-2">
              {history.map((entry, i) =>
                entry.role === "user" ? (
                  <div
                    key={i}
                    className="self-end rounded-lg bg-accent/60 px-3 py-1.5 text-sm text-foreground"
                  >
                    {entry.content}
                  </div>
                ) : (
                  <div
                    key={i}
                    className="self-start rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm text-foreground"
                  >
                    <p>{entry.content}</p>
                    {entry.unsupportedCapabilities &&
                      entry.unsupportedCapabilities.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                          {entry.unsupportedCapabilities.map((cap) => (
                            <li key={cap}>{cap}</li>
                          ))}
                        </ul>
                      )}
                  </div>
                ),
              )}
              {loading && (
                <div className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Generating workflow...
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        )}

        {/* Input row */}
        <form
          className="flex items-end gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          onClick={() => textareaRef.current?.focus()}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) e.preventDefault();
          }}
        >
          <textarea
            ref={textareaRef}
            placeholder={
              isFocused
                ? history.length > 0
                  ? "Describe changes to your workflow..."
                  : "Describe your workflow with natural language..."
                : "Ask AI..."
            }
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              if (!value.trim()) setIsFocused(false);
            }}
            disabled={loading}
            rows={1}
            className="max-h-28 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={!value.trim() || loading}
            title="Generate"
            className="shrink-0 rounded-lg"
          >
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
