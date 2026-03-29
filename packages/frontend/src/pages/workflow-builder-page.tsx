import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { generateWorkflow, getWorkflow } from "@/api/workflows";
import { CodeViewer } from "@/components/workflow/code-viewer";
import {
  PromptPanel,
  type PromptEntry,
} from "@/components/workflow/prompt-panel";
import { RunTestPanel } from "@/components/workflow/run-test-panel";
import type { WorkflowDetail } from "@/types/workflow";

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [history, setHistory] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getWorkflow(id)
      .then((w) => {
        if (cancelled) return;
        setWorkflow(w);
        setHistory([{ role: "user", content: w.originalPrompt }]);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load workflow");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      setError(null);
      setHistory((prev) => [...prev, { role: "user", content: prompt }]);
      setLoading(true);

      try {
        const result = await generateWorkflow({
          prompt,
          workflowId: workflow?.id,
        });
        setWorkflow(result);

        if (!workflow?.id) {
          navigate(`/workflows/${result.id}`, { replace: true });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Generation failed");
      } finally {
        setLoading(false);
      }
    },
    [workflow?.id, navigate],
  );

  if (error && !workflow) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex w-[40%] min-w-[320px] flex-col border-r border-border">
        <PromptPanel
          history={history}
          loading={loading}
          onSubmit={handleSubmit}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <CodeViewer
          code={workflow?.generatedCode ?? ""}
          triggerEvents={workflow?.triggerEvents ?? []}
          loading={loading}
        />
        {error && workflow && (
          <div className="border-t border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {workflow && (
          <RunTestPanel
            workflowId={workflow.id}
            triggerEvents={workflow.triggerEvents}
          />
        )}
      </div>
    </div>
  );
}
