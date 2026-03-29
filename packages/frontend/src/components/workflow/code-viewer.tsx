import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type HighlighterCore } from "shiki";

import { formatWorkflowCode } from "@/lib/format-workflow-code";

let highlighterPromise: Promise<HighlighterCore> | null = null;
let highlighterInstance: HighlighterCore | null = null;
let highlighterVersion = 0;
const listeners = new Set<() => void>();

function getHighlighter(): HighlighterCore | null {
  if (highlighterInstance) return highlighterInstance;
  if (!highlighterPromise) {
    highlighterPromise = import("shiki")
      .then((shiki) =>
        shiki.createHighlighter({
          themes: ["github-dark-dimmed"],
          langs: ["javascript"],
        }),
      )
      .then((h) => {
        highlighterInstance = h;
        highlighterVersion++;
        listeners.forEach((l) => l());
        return h;
      });
  }
  return null;
}

function subscribeHighlighter(cb: () => void) {
  listeners.add(cb);
  getHighlighter();
  return () => listeners.delete(cb);
}

function getHighlighterSnapshot() {
  return highlighterVersion;
}

function useHighlighter(): HighlighterCore | null {
  useSyncExternalStore(subscribeHighlighter, getHighlighterSnapshot);
  return highlighterInstance;
}

interface CodeViewerProps {
  code: string;
  triggerEvents: string[];
  loading?: boolean;
}

export function CodeViewer({ code, triggerEvents, loading }: CodeViewerProps) {
  const highlighter = useHighlighter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayCode, setDisplayCode] = useState("");

  useEffect(() => {
    if (!code.trim()) {
      void Promise.resolve().then(() => setDisplayCode(""));
      return;
    }
    void Promise.resolve().then(() => setDisplayCode(code));
    let cancelled = false;
    void formatWorkflowCode(code).then((formatted) => {
      if (!cancelled) setDisplayCode(formatted);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const html = highlighter && displayCode
    ? highlighter.codeToHtml(displayCode, {
        lang: "javascript",
        theme: "github-dark-dimmed",
      })
    : "";

  const setContainerHtml = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (el) el.innerHTML = html;
  }, [html]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-medium text-foreground">
          Generated Code
        </span>
        <div className="flex gap-1.5">
          {triggerEvents.map((t) => (
            <span
              key={t}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto bg-[#22272e]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#22272e]/80">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <svg
                className="size-5 animate-spin"
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
              Generating...
            </div>
          </div>
        )}

        {code ? (
          html ? (
            <div
              ref={setContainerHtml}
              className="min-h-full p-4 text-sm [&_pre]:!bg-transparent [&_pre]:whitespace-pre [&_code]:text-[13px] [&_code]:leading-relaxed"
            />
          ) : (
            <div className="min-h-full p-4 text-sm">
              <pre className="whitespace-pre font-mono text-[13px] leading-relaxed text-gray-300">
                {displayCode}
              </pre>
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {loading
              ? null
              : "Describe your workflow in the prompt panel to generate code."}
          </div>
        )}
      </div>
    </div>
  );
}
