import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Play } from "lucide-react";

export interface ActionNodeData {
  label: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function ActionNode({ data }: NodeProps) {
  const { label } = data as ActionNodeData;
  return (
    <div className="rounded-lg border-2 border-blue-500/60 bg-blue-950/80 px-4 py-3 shadow-md">
      <Handle type="target" position={Position.Top} className="!bg-blue-400" />
      <div className="flex items-center gap-2">
        <Play className="h-4 w-4 shrink-0 text-blue-400" />
        <span className="text-sm font-medium text-blue-100">{label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400" />
    </div>
  );
}
