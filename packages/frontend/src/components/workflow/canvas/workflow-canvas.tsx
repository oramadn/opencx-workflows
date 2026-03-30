import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Workflow } from "lucide-react";

import type { FlowGraph } from "@/types/workflow";

import { CustomControls } from "./custom-controls";
import { ActionNode } from "./nodes/action-node";
import { ConditionNode } from "./nodes/condition-node";
import { TriggerNode } from "./nodes/trigger-node";
import { useAutoLayout } from "./use-auto-layout";

const nodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
};

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Workflow className="h-12 w-12 opacity-30" />
      <p className="text-sm">
        {loading
          ? "Generating workflow..."
          : "Describe a workflow below to visualize it here"}
      </p>
    </div>
  );
}

interface WorkflowCanvasProps {
  flowGraph: FlowGraph | null;
  loading?: boolean;
  selectedNodeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
  onPaneClick?: () => void;
}

function CanvasInner({
  flowGraph,
  loading,
  selectedNodeId,
  onNodeClick,
  onPaneClick,
}: WorkflowCanvasProps) {
  const { nodes: layoutNodes, edges } = useAutoLayout(flowGraph);

  const nodes = layoutNodes.map((n) => ({
    ...n,
    selected: n.id === selectedNodeId,
    data: { ...n.data, selected: n.id === selectedNodeId },
  }));

  if (nodes.length === 0) {
    return <EmptyState loading={loading ?? false} />;
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onNodeClick={(_event, node) => onNodeClick?.(node.id)}
      onPaneClick={() => onPaneClick?.()}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <CustomControls />
    </ReactFlow>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
