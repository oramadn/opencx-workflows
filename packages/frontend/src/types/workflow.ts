// ---------------------------------------------------------------------------
// Flow graph types — mirrors backend FlowGraph from workflow-sdk.ts
// ---------------------------------------------------------------------------

export type FlowNodeType = "trigger" | "condition" | "action";

export interface FlowNodeDescriptor {
  id: string;
  type: FlowNodeType;
  label: string;
  code?: string;
  metadata?: Record<string, unknown>;
}

export interface FlowEdgeDescriptor {
  source: string;
  target: string;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNodeDescriptor[];
  edges: FlowEdgeDescriptor[];
}

// ---------------------------------------------------------------------------
// Workflow DTOs
// ---------------------------------------------------------------------------

export interface WorkflowSummary {
  id: string;
  name: string;
  triggerEvents: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDetail extends WorkflowSummary {
  originalPrompt: string;
  generatedCode: string;
  flowGraph: FlowGraph | null;
}

export interface GenerateRequest {
  prompt: string;
  workflowId?: string;
}

export interface RunTestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
