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
