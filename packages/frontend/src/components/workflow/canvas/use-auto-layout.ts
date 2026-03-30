import dagre from "@dagrejs/dagre";
import { type Edge, type Node, Position } from "@xyflow/react";
import { useMemo } from "react";

import type { FlowGraph } from "@/types/workflow";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 60;

export function useAutoLayout(flowGraph: FlowGraph | null): {
  nodes: Node[];
  edges: Edge[];
} {
  return useMemo(() => {
    if (!flowGraph || flowGraph.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });

    for (const node of flowGraph.nodes) {
      g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const edge of flowGraph.edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    const nodes: Node[] = flowGraph.nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        type: n.type,
        position: {
          x: (pos?.x ?? 0) - NODE_WIDTH / 2,
          y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
        },
        data: { label: n.label, code: n.code, metadata: n.metadata },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });

    const edges: Edge[] = flowGraph.edges.map((e, i) => ({
      id: `e-${e.source}-${e.target}-${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: true,
    }));

    return { nodes, edges };
  }, [flowGraph]);
}
