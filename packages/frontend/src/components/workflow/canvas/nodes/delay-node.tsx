import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Clock } from "lucide-react";

export interface DelayNodeData {
  label: string;
  selected?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function DelayNode({ data }: NodeProps) {
  const { label, selected } = data as DelayNodeData;
  return (
    <div
      className={`rounded-lg border-2 bg-violet-950/80 px-4 py-3 shadow-md transition-shadow ${selected ? "border-violet-400 ring-2 ring-violet-400/50" : "border-violet-500/60"}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-400" />
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 shrink-0 text-violet-400" />
        <span className="text-sm font-medium text-violet-100">{label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-400" />
    </div>
  );
}
