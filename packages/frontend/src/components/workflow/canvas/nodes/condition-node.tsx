import { Handle, Position, type NodeProps } from "@xyflow/react";
import { GitBranch } from "lucide-react";

export interface ConditionNodeData {
  label: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function ConditionNode({ data }: NodeProps) {
  const { label } = data as ConditionNodeData;
  return (
    <div className="rounded-lg border-2 border-amber-500/60 bg-amber-950/80 px-4 py-3 shadow-md">
      <Handle type="target" position={Position.Top} className="!bg-amber-400" />
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="text-sm font-medium text-amber-100">{label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400" />
    </div>
  );
}
