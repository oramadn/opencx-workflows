import { Layers, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { listWorkflows, setWorkflowActive } from "@/api/workflows";
import { Button } from "@/components/ui/button";
import type { WorkflowSummary } from "@/types/workflow";

export function WorkflowsListPage() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listWorkflows()
      .then(setWorkflows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Workflows</h1>
        <Button asChild size="sm">
          <Link to="/workflows/new">
            <Plus className="size-4" />
            New Workflow
          </Link>
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}

        {!loading && workflows.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
            <Layers className="size-10 text-muted-foreground/50" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                No workflows yet
              </p>
              <p className="text-sm text-muted-foreground">
                Create your first workflow to automate actions based on session
                events.
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/workflows/new">
                <Plus className="size-4" />
                New Workflow
              </Link>
            </Button>
          </div>
        )}

        {!loading && workflows.length > 0 && (
          <div className="grid gap-3">
            {workflows.map((w) => (
              <Link
                key={w.id}
                to={`/workflows/${w.id}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {w.name}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {w.triggerEvents.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">
                      {new Date(w.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={w.isActive}
                  title={w.isActive ? "Active" : "Inactive"}
                  onClick={(e) => {
                    e.preventDefault();
                    setWorkflowActive(w.id, !w.isActive)
                      .then((updated) =>
                        setWorkflows((prev) =>
                          prev.map((p) =>
                            p.id === updated.id
                              ? { ...p, isActive: updated.isActive }
                              : p,
                          ),
                        ),
                      )
                      .catch(() => {});
                  }}
                  className={`relative ml-3 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${w.isActive ? "bg-green-500" : "bg-muted-foreground/30"}`}
                >
                  <span
                    className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${w.isActive ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                  />
                </button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
