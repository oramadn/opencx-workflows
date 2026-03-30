import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";

export interface TriggerNodeData {
  label: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function TriggerNode({ data }: NodeProps) {
  const { label } = data as TriggerNodeData;
  return (
    <div className="rounded-lg border-2 border-emerald-500/60 bg-emerald-950/80 px-4 py-3 shadow-md">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 shrink-0 text-emerald-400" />
        <span className="text-sm font-medium text-emerald-100">{label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-400" />
    </div>
  );
}
