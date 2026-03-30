import { javascript } from "@codemirror/lang-javascript";
import { type Diagnostic, linter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import * as acorn from "acorn";
import { EditorView, basicSetup } from "codemirror";
import { Code, GitBranch, Play, Save, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatWorkflowCode } from "@/lib/format-workflow-code";
import type { FlowNodeDescriptor, FlowNodeType } from "@/types/workflow";

interface NodeCodePanelProps {
  node: FlowNodeDescriptor | null;
  onSave: (nodeId: string, code: string) => void;
  saving: boolean;
  error: string | null;
}

const TRIGGER_EVENT_SHAPES: Record<string, string> = {
  onSessionClosed: `{
  triggerType: "onSessionClosed",
  sessionId: string,
  customerName: string,
  customerEmail: string,
  sentiment: "happy" | "neutral" | "angry",
  createdAt: string,
}`,
  onSessionOpened: `{
  triggerType: "onSessionOpened",
  sessionId: string,
  customerName: string,
  customerEmail: string,
  createdAt: string,
}`,
};

function inferTriggerEvent(label: string): string | null {
  const lower = label.toLowerCase();
  if (lower.includes("closed")) return "onSessionClosed";
  if (lower.includes("opened")) return "onSessionOpened";
  return null;
}

const typeBadge: Record<string, { label: string; color: string; icon: typeof Zap }> = {
  trigger: { label: "Trigger", color: "bg-emerald-500/20 text-emerald-400", icon: Zap },
  action: { label: "Action", color: "bg-blue-500/20 text-blue-400", icon: Play },
  condition: { label: "Condition", color: "bg-amber-500/20 text-amber-400", icon: GitBranch },
};

function createStepLinter(nodeType: FlowNodeType) {
  return linter((view) => {
    const code = view.state.doc.toString();
    const trimmed = code.trim();
    if (trimmed.length === 0) return [];

    const wrapper =
      nodeType === "condition"
        ? `(async () => { if (\n${trimmed}\n) {} })()`
        : `(async () => {\n${trimmed}\n})()`;

    const prefixLines = 1;

    try {
      acorn.parse(wrapper, { ecmaVersion: 2022, sourceType: "module" });
      return [];
    } catch (err: unknown) {
      if (!(err instanceof SyntaxError)) return [];

      const acornErr = err as SyntaxError & {
        loc?: { line: number; column: number };
        pos?: number;
        raisedAt?: number;
      };

      const rawMsg = acornErr.message.replace(/\s*\(\d+:\d+\)$/, "");

      let from = code.length;
      let to = from;

      if (acornErr.loc) {
        const adjustedLine = acornErr.loc.line - prefixLines;
        if (adjustedLine >= 1) {
          let offset = 0;
          const lines = code.split("\n");
          for (let i = 0; i < adjustedLine - 1 && i < lines.length; i++) {
            offset += lines[i]!.length + 1;
          }
          from = Math.min(offset + acornErr.loc.column, code.length);
          to = Math.min(from + 1, code.length);
        }
      }

      const diagnostic: Diagnostic = {
        from,
        to,
        severity: "error",
        message: rawMsg,
      };
      return [diagnostic];
    }
  });
}

function CodeMirrorEditor({
  initialCode,
  nodeType,
  onChange,
}: {
  initialCode: string;
  nodeType: FlowNodeType;
  onChange: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: initialCode,
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        createStepLinter(nodeType),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { padding: "12px 0" },
        }),
      ],
      parent: containerRef.current,
    });

    return () => {
      view.destroy();
    };
  }, [initialCode, nodeType]);

  return <div ref={containerRef} className="h-full" />;
}

export function NodeCodePanel({ node, onSave, saving, error }: NodeCodePanelProps) {
  const rawCode = node?.code ?? "";
  const [formattedCode, setFormattedCode] = useState<string | null>(null);
  const [localCode, setLocalCode] = useState(rawCode);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    formatWorkflowCode(rawCode).then((result) => {
      if (cancelled) return;
      setFormattedCode(result);
      setLocalCode(result);
    });
    return () => { cancelled = true; };
  }, [rawCode]);

  const baseCode = formattedCode ?? rawCode;

  const handleChange = useCallback(
    (value: string) => {
      setLocalCode(value);
      setDirty(value !== baseCode);
    },
    [baseCode],
  );

  const handleSave = useCallback(() => {
    if (!node) return;
    onSave(node.id, localCode);
  }, [node, localCode, onSave]);

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
        <Code className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-center text-xs text-muted-foreground/50">
          Click a node to inspect its code
        </p>
      </div>
    );
  }

  const badge = typeBadge[node.type] ?? typeBadge.action!;
  const BadgeIcon = badge.icon;
  const isEditable = node.type !== "trigger";

  const triggerEvent = !isEditable ? inferTriggerEvent(node.label) : null;
  const eventShape = triggerEvent ? TRIGGER_EVENT_SHAPES[triggerEvent] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <BadgeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {node.label}
        </span>
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.color}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Body */}
      {isEditable ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeMirrorEditor
            key={node.id}
            initialCode={baseCode}
            nodeType={node.type}
            onChange={handleChange}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-[#22272e] p-4">
          {eventShape ? (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Event payload shape
              </p>
              <pre className="whitespace-pre font-mono text-[13px] leading-relaxed text-gray-300">
                {eventShape}
              </pre>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Trigger nodes subscribe to events and do not contain editable code.
            </p>
          )}
        </div>
      )}

      {/* Footer with Save */}
      {isEditable && (
        <div className="flex items-center justify-end border-t border-border px-4 py-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <Save className="h-3 w-3" />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
