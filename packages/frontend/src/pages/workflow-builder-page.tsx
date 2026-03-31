import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import {
  WorkflowRejectedError,
  generateWorkflow,
  getWorkflow,
  renameWorkflow,
  updateNodeCode,
  updateNodeLabel,
} from "@/api/workflows";
import { Button } from "@/components/ui/button";
import { WorkflowCanvas } from "@/components/workflow/canvas/workflow-canvas";
import {
  ChatBar,
  type PromptEntry,
} from "@/components/workflow/chat-bar";
import { SidePanel } from "@/components/workflow/side-panel";
import { WorkflowTitle } from "@/components/workflow/workflow-title";
import { cn } from "@/lib/utils";
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
  const [referenceMode, setReferenceMode] = useState(false);

  const PANEL_MIN = 280;
  const PANEL_MAX = 900;
  const [panelWidth, setPanelWidth] = useState(() =>
    Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(window.innerWidth / 3))),
  );
  const dragging = useRef(false);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return;
      const newWidth = Math.min(PANEL_MAX, Math.max(PANEL_MIN, window.innerWidth - e.clientX));
      setPanelWidth(newWidth);
    }
    function onMouseUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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
          focusedNodeId: selectedNodeId ?? undefined,
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
    [workflow?.id, navigate, selectedNodeId],
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

  const handleRenameNode = useCallback(
    async (nodeId: string, label: string) => {
      if (!workflow) return;
      try {
        const updated = await updateNodeLabel(workflow.id, nodeId, label);
        setWorkflow(updated);
      } catch {
        // Silently ignore rename errors for now
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

        <div className="absolute right-3 top-3 z-10">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              "size-9 rounded-lg border-border bg-background/95 shadow-sm backdrop-blur-sm",
              referenceMode &&
                "border-primary/50 ring-2 ring-primary/25 bg-primary/5",
            )}
            onClick={() => setReferenceMode((v) => !v)}
            title="Toggle workflow SDK reference in the side panel"
            aria-label="Toggle workflow SDK reference"
            aria-pressed={referenceMode}
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <WorkflowCanvas
          flowGraph={workflow?.flowGraph ?? null}
          loading={loading}
          selectedNodeId={selectedNodeId}
          onNodeClick={setSelectedNodeId}
          onPaneClick={() => setSelectedNodeId(null)}
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
          selectedNode={selectedNode}
          onClearNodeFocus={() => setSelectedNodeId(null)}
        />
      </div>

      {/* Right panel — node code inspector (resizable) */}
      <div
        className={cn(
          "relative shrink-0 border-l border-border",
          referenceMode ? "block" : "hidden lg:block",
        )}
        style={{ width: panelWidth }}
      >
        {/* Drag handle */}
        <div
          className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />
        <SidePanel
          key={
            referenceMode
              ? "sdk-reference"
              : `${selectedNode?.id ?? ""}:${selectedNode?.code ?? ""}`
          }
          workflow={workflow}
          selectedNode={selectedNode}
          onSaveCode={handleSaveNodeCode}
          onRenameNode={handleRenameNode}
          onRenameWorkflow={handleRename}
          savingCode={savingCode}
          codeError={codeError}
          referenceMode={referenceMode}
          onExitReference={() => setReferenceMode(false)}
        />
      </div>
    </div>
  );
}
