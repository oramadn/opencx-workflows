import { Handle, Position, type NodeProps } from "@xyflow/react";

import { DEFAULT_TRIGGER_ICON, nodeIconMap } from "../icons";

export interface TriggerNodeData {
  label: string;
  selected?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export function TriggerNode({ data }: NodeProps) {
  const { label, selected, metadata } = data as TriggerNodeData;
  const triggerType = metadata?.triggerType as string | undefined;
  const Icon = (triggerType && nodeIconMap[triggerType]) || DEFAULT_TRIGGER_ICON;

  return (
    <div
      className={`rounded-lg border-2 bg-emerald-950/80 px-4 py-3 shadow-md transition-shadow ${selected ? "border-emerald-400 ring-2 ring-emerald-400/50" : "border-emerald-500/60"}`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-emerald-400" />
        <span className="text-sm font-medium text-emerald-100">{label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-400" />
    </div>
  );
}
