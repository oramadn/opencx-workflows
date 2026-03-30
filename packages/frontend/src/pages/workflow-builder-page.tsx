import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  WorkflowRejectedError,
  generateWorkflow,
  getWorkflow,
  renameWorkflow,
  updateNodeCode,
} from "@/api/workflows";
import { WorkflowCanvas } from "@/components/workflow/canvas/workflow-canvas";
import {
  ChatBar,
  type PromptEntry,
} from "@/components/workflow/chat-bar";
import { NodeCodePanel } from "@/components/workflow/node-code-panel";
import { WorkflowTitle } from "@/components/workflow/workflow-title";
import type { FlowNodeDescriptor, WorkflowDetail } from "@/types/workflow";

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [history, setHistory] = useState<PromptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

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
        setError(
          err instanceof Error ? err.message : "Failed to load workflow",
        );
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
        if (err instanceof WorkflowRejectedError) {
          setHistory((prev) => [
            ...prev,
            {
              role: "assistant",
              content: err.message,
              unsupportedCapabilities: err.unsupportedCapabilities,
            },
          ]);
        } else {
          setError(err instanceof Error ? err.message : "Generation failed");
        }
      } finally {
        setLoading(false);
      }
    },
    [workflow?.id, navigate],
  );

  const handleRename = useCallback(
    async (name: string) => {
      if (!workflow) return;
      const updated = await renameWorkflow(workflow.id, name);
      setWorkflow(updated);
    },
    [workflow],
  );

  const handleSaveNodeCode = useCallback(
    async (nodeId: string, code: string) => {
      if (!workflow) return;
      setCodeError(null);
      setSavingCode(true);
      try {
        const updated = await updateNodeCode(workflow.id, nodeId, code);
        setWorkflow(updated);
      } catch (err) {
        setCodeError(err instanceof Error ? err.message : "Save failed");
      } finally {
        setSavingCode(false);
      }
    },
    [workflow],
  );

  const selectedNode: FlowNodeDescriptor | null =
    selectedNodeId && workflow?.flowGraph
      ? (workflow.flowGraph.nodes.find((n) => n.id === selectedNodeId) ?? null)
      : null;

  if (error && !workflow) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* Main area: canvas with floating chat bar overlay */}
      <div className="relative min-w-0 flex-1">
        {/* Title bar — top left */}
        {workflow && (
          <div className="absolute left-3 top-3 z-10">
            <div className="rounded-lg border border-border bg-background/95 px-2 py-1 shadow-sm backdrop-blur-sm">
              <WorkflowTitle name={workflow.name} onRename={handleRename} />
            </div>
          </div>
        )}

        <WorkflowCanvas
          flowGraph={workflow?.flowGraph ?? null}
          loading={loading}
          selectedNodeId={selectedNodeId}
          onNodeClick={setSelectedNodeId}
        />

        {loading && (
          <div className="pointer-events-none absolute inset-0 z-[5] bg-background/40" />
        )}

        {error && workflow && (
          <div className="absolute inset-x-0 top-0 z-20 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
            {error}
          </div>
        )}

        <ChatBar
          history={history}
          loading={loading}
          onSubmit={handleSubmit}
        />
      </div>

      {/* Right panel — node code inspector */}
      <div className="hidden w-96 shrink-0 border-l border-border lg:block">
        <NodeCodePanel
          key={`${selectedNode?.id ?? ""}:${selectedNode?.code ?? ""}`}
          node={selectedNode}
          onSave={handleSaveNodeCode}
          saving={savingCode}
          error={codeError}
        />
      </div>
    </div>
  );
}
