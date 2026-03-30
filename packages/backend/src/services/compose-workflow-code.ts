import type { FlowGraph, FlowNodeDescriptor } from "../workflow-sdk.js";
import { parseDuration } from "./parse-duration.js";

/**
 * Deterministic composition engine: walks the flow graph in topological order
 * and assembles per-node step code into a single executable `run(event, tools)`
 * function.  Condition nodes emit if/else branches using "Yes"/"No" edge labels.
 */
export function composeWorkflowCode(flowGraph: FlowGraph): string {
  const { nodes, edges } = flowGraph;
  const nodeMap = new Map<string, FlowNodeDescriptor>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const sorted = topoSort(nodes, edges);

  const childrenOf = buildAdjacencyList(edges);

  const emitted = new Set<string>();
  const lines: string[] = [];

  for (const nodeId of sorted) {
    if (emitted.has(nodeId)) continue;
    emitNode(nodeId, lines, nodeMap, childrenOf, emitted, 1);
  }

  const body = lines.join("\n");
  return `export default async function run(event, tools) {\n  const context = {};\n\n${body}\n}\n`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

type AdjList = Map<string, { target: string; label?: string }[]>;

function buildAdjacencyList(
  edges: FlowGraph["edges"],
): AdjList {
  const adj: AdjList = new Map();
  for (const e of edges) {
    let list = adj.get(e.source);
    if (!list) {
      list = [];
      adj.set(e.source, list);
    }
    list.push({ target: e.target, label: e.label });
  }
  return adj;
}

function emitNode(
  nodeId: string,
  lines: string[],
  nodeMap: Map<string, FlowNodeDescriptor>,
  childrenOf: AdjList,
  emitted: Set<string>,
  depth: number,
): void {
  if (emitted.has(nodeId)) return;
  emitted.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node) return;

  const indent = "  ".repeat(depth);
  const children = childrenOf.get(nodeId) ?? [];

  if (node.type === "trigger") {
    for (const child of children) {
      emitNode(child.target, lines, nodeMap, childrenOf, emitted, depth);
    }
    return;
  }

  if (node.type === "condition") {
    const code = (node.code ?? "").trim();
    const yesBranch = children.filter(
      (c) => c.label?.toLowerCase() === "yes",
    );
    const noBranch = children.filter(
      (c) => c.label?.toLowerCase() === "no",
    );

    lines.push(`${indent}// Step: ${node.id} — ${node.label}`);
    lines.push(`${indent}if (${code}) {`);

    for (const child of yesBranch) {
      emitNode(child.target, lines, nodeMap, childrenOf, emitted, depth + 1);
    }

    if (noBranch.length > 0) {
      lines.push(`${indent}} else {`);
      for (const child of noBranch) {
        emitNode(child.target, lines, nodeMap, childrenOf, emitted, depth + 1);
      }
    }

    lines.push(`${indent}}`);
    return;
  }

  if (node.type === "delay") {
    const ms = parseDuration(node.code ?? "0");
    lines.push(`${indent}// Step: ${node.id} — ${node.label}`);
    lines.push(`${indent}await new Promise(r => setTimeout(r, ${ms}));`);

    for (const child of children) {
      emitNode(child.target, lines, nodeMap, childrenOf, emitted, depth);
    }
    return;
  }

  // action node
  lines.push(`${indent}// Step: ${node.id} — ${node.label}`);
  lines.push(`${indent}await (async () => {`);

  const codeLines = (node.code ?? "").split("\n");
  for (const cl of codeLines) {
    lines.push(`${indent}  ${cl}`);
  }

  lines.push(`${indent}})();`);

  for (const child of children) {
    emitNode(child.target, lines, nodeMap, childrenOf, emitted, depth);
  }
}

/**
 * Kahn's algorithm — topological sort for the flow DAG.
 * Returns node IDs in execution order.
 */
function topoSort(
  nodes: FlowNodeDescriptor[],
  edges: FlowGraph["edges"],
): string[] {
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);

  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const e of edges) {
      if (e.source !== id) continue;
      const newDeg = (inDegree.get(e.target) ?? 1) - 1;
      inDegree.set(e.target, newDeg);
      if (newDeg === 0) queue.push(e.target);
    }
  }

  return result;
}
