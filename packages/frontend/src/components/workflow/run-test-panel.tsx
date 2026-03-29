import { useCallback, useState } from "react";

import { runWorkflowTest } from "@/api/workflows";
import type { RunTestResult } from "@/types/workflow";

interface RunTestPanelProps {
  workflowId: string;
  triggerEvents: string[];
}

const SAMPLE_EVENTS: Record<string, Record<string, unknown>> = {
  onSessionClosed: {
    triggerType: "onSessionClosed",
    sessionId: "00000000-0000-0000-0000-000000000001",
    customerName: "Alice",
    customerEmail: "alice@example.com",
    sentiment: "angry",
    createdAt: new Date().toISOString(),
  },
  onSessionOpened: {
    triggerType: "onSessionOpened",
    sessionId: "00000000-0000-0000-0000-000000000002",
    customerName: "Bob",
    customerEmail: "bob@example.com",
    createdAt: new Date().toISOString(),
  },
};

export function RunTestPanel({ workflowId, triggerEvents }: RunTestPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrigger, setSelectedTrigger] = useState(
    triggerEvents[0] ?? "onSessionClosed",
  );

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setError(null);

    try {
      const event = SAMPLE_EVENTS[selectedTrigger] ?? SAMPLE_EVENTS.onSessionClosed!;
      const res = await runWorkflowTest(workflowId, event);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test run failed");
    } finally {
      setRunning(false);
    }
  }, [workflowId, selectedTrigger]);

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-background px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Test run
        </span>

        {triggerEvents.length > 1 && (
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            value={selectedTrigger}
            onChange={(e) => setSelectedTrigger(e.target.value)}
          >
            {triggerEvents.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          disabled={running}
          onClick={handleRun}
          className="ml-auto rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? "Running..." : "Run sample event"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5 rounded border border-border bg-muted/30 p-3 text-xs font-mono">
          <div className="flex gap-2">
            <span className="text-muted-foreground">exit:</span>
            <span className={result.exitCode === 0 ? "text-green-400" : "text-destructive"}>
              {result.exitCode}
            </span>
          </div>
          {result.stdout && (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">stdout:</span>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-foreground">
                {result.stdout}
              </pre>
            </div>
          )}
          {result.stderr && (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">stderr:</span>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-destructive/80">
                {result.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
