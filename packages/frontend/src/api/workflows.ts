import type {
  GenerateRequest,
  RunTestResult,
  WorkflowDetail,
  WorkflowSummary,
} from "@/types/workflow";

async function parseJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export class WorkflowRejectedError extends Error {
  unsupportedCapabilities: string[];

  constructor(message: string, unsupportedCapabilities: string[] = []) {
    super(message);
    this.name = "WorkflowRejectedError";
    this.unsupportedCapabilities = unsupportedCapabilities;
  }
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const res = await fetch("/api/workflows");
  if (!res.ok) throw new Error("Failed to load workflows");
  return parseJson<WorkflowSummary[]>(res);
}

export async function getWorkflow(id: string): Promise<WorkflowDetail> {
  const res = await fetch(`/api/workflows/${id}`);
  if (res.status === 404) throw new Error("Workflow not found");
  if (!res.ok) throw new Error("Failed to load workflow");
  return parseJson<WorkflowDetail>(res);
}

export async function generateWorkflow(
  req: GenerateRequest,
): Promise<WorkflowDetail> {
  const res = await fetch("/api/workflows/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      unsupportedCapabilities?: string[];
    };
    if (res.status === 422) {
      throw new WorkflowRejectedError(
        err.error ?? "This request requires capabilities that are not yet supported.",
        err.unsupportedCapabilities ?? [],
      );
    }
    throw new Error(err.error ?? "Generation failed");
  }
  return parseJson<WorkflowDetail>(res);
}

export async function setWorkflowActive(
  id: string,
  isActive: boolean,
): Promise<WorkflowDetail> {
  const res = await fetch(`/api/workflows/${id}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to update workflow");
  }
  return parseJson<WorkflowDetail>(res);
}

export async function renameWorkflow(
  id: string,
  name: string,
): Promise<WorkflowDetail> {
  const res = await fetch(`/api/workflows/${id}/name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to rename workflow");
  }
  return parseJson<WorkflowDetail>(res);
}

export async function runWorkflowTest(
  workflowId: string,
  event: Record<string, unknown>,
): Promise<RunTestResult> {
  const res = await fetch(`/api/workflows/${workflowId}/run-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Test run failed");
  }
  return parseJson<RunTestResult>(res);
}
