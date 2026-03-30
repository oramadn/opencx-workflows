import { javascript } from "@codemirror/lang-javascript";
import { type Diagnostic, linter } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";
import * as acorn from "acorn";
import { EditorView, basicSetup } from "codemirror";
import {
  Code,
  GitBranch,
  Pencil,
  Play,
  Save,
  Settings2,
  Workflow,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatWorkflowCode } from "@/lib/format-workflow-code";
import type {
  FlowNodeDescriptor,
  FlowNodeType,
  WorkflowDetail,
} from "@/types/workflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidePanelProps {
  workflow: WorkflowDetail | null;
  selectedNode: FlowNodeDescriptor | null;
  onSaveCode: (nodeId: string, code: string) => void;
  onRenameNode: (nodeId: string, label: string) => void;
  onRenameWorkflow: (name: string) => Promise<void>;
  savingCode: boolean;
  codeError: string | null;
}

type TabId = "config" | "code";

// ---------------------------------------------------------------------------
// Acorn linter (reused from previous implementation)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CodeMirror editor (editable — for node step code)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Read-only CodeMirror viewer (for overall composed code)
// ---------------------------------------------------------------------------

function ReadOnlyCodeViewer({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      doc: code,
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        EditorView.editable.of(false),
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
  }, [code]);

  return <div ref={containerRef} className="h-full" />;
}

// ---------------------------------------------------------------------------
// Editable label input
// ---------------------------------------------------------------------------

function EditableLabel({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    onCommit(trimmed);
    setEditing(false);
  }, [draft, value, onCommit]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit()}
        maxLength={80}
        className="h-7 w-full rounded border border-border bg-muted/50 px-2 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center gap-1.5 text-left"
      title="Click to rename"
    >
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {value}
      </span>
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const typeBadge: Record<
  string,
  { label: string; color: string; icon: typeof Zap }
> = {
  trigger: {
    label: "Trigger",
    color: "bg-emerald-500/20 text-emerald-400",
    icon: Zap,
  },
  action: {
    label: "Action",
    color: "bg-blue-500/20 text-blue-400",
    icon: Play,
  },
  condition: {
    label: "Condition",
    color: "bg-amber-500/20 text-amber-400",
    icon: GitBranch,
  },
};

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SidePanel({
  workflow,
  selectedNode,
  onSaveCode,
  onRenameNode,
  onRenameWorkflow,
  savingCode,
  codeError,
}: SidePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("config");

  // Step-code formatting state (only relevant when a node is selected)
  const rawCode = selectedNode?.code ?? "";
  const [formattedCode, setFormattedCode] = useState<string | null>(null);
  const [localCode, setLocalCode] = useState(rawCode);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!rawCode) return;
    let cancelled = false;
    formatWorkflowCode(rawCode).then((result) => {
      if (cancelled) return;
      setFormattedCode(result);
      setLocalCode(result);
    });
    return () => {
      cancelled = true;
    };
  }, [rawCode]);

  // Overall composed code formatting
  const rawGeneratedCode = workflow?.generatedCode ?? "";
  const [formattedGeneratedCode, setFormattedGeneratedCode] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!rawGeneratedCode) return;
    let cancelled = false;
    formatWorkflowCode(rawGeneratedCode).then((result) => {
      if (cancelled) return;
      setFormattedGeneratedCode(result);
    });
    return () => {
      cancelled = true;
    };
  }, [rawGeneratedCode]);

  const baseCode = formattedCode ?? rawCode;

  const handleChange = useCallback(
    (value: string) => {
      setLocalCode(value);
      setDirty(value !== baseCode);
    },
    [baseCode],
  );

  const handleSave = useCallback(() => {
    if (!selectedNode) return;
    onSaveCode(selectedNode.id, localCode);
  }, [selectedNode, localCode, onSaveCode]);

  const hasNode = !!selectedNode;
  const isEditable = selectedNode ? selectedNode.type !== "trigger" : false;

  const configLabel = hasNode ? "Details" : "Workflow";
  const codeLabel = "Code";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        <TabButton
          active={activeTab === "config"}
          onClick={() => setActiveTab("config")}
          icon={hasNode ? Settings2 : Workflow}
          label={configLabel}
        />
        <TabButton
          active={activeTab === "code"}
          onClick={() => setActiveTab("code")}
          icon={Code}
          label={codeLabel}
        />
      </div>

      {/* Error banner (code tab errors) */}
      {activeTab === "code" && codeError && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {codeError}
        </div>
      )}

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "config" ? (
          hasNode ? (
            <NodeConfigTab
              node={selectedNode!}
              onRenameNode={onRenameNode}
            />
          ) : (
            <WorkflowConfigTab
              workflow={workflow}
              onRename={onRenameWorkflow}
            />
          )
        ) : hasNode ? (
          <NodeCodeTab
            node={selectedNode!}
            baseCode={baseCode}
            nodeType={selectedNode!.type}
            isEditable={isEditable}
            dirty={dirty}
            saving={savingCode}
            onChange={handleChange}
            onSave={handleSave}
          />
        ) : (
          <OverallCodeTab code={formattedGeneratedCode ?? rawGeneratedCode} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Code;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Config tabs
// ---------------------------------------------------------------------------

function WorkflowConfigTab({
  workflow,
  onRename,
}: {
  workflow: WorkflowDetail | null;
  onRename: (name: string) => Promise<void>;
}) {
  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-xs text-muted-foreground/50">
          Generate a workflow to see its details
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 overflow-auto p-4">
      <Field label="Name">
        <EditableLabel
          value={workflow.name}
          onCommit={(name) => void onRename(name)}
        />
      </Field>

      <Field label="Triggers">
        <div className="flex flex-wrap gap-1.5">
          {workflow.triggerEvents.map((t) => (
            <span
              key={t}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {t}
            </span>
          ))}
        </div>
      </Field>

      <Field label="Status">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
            workflow.isActive
              ? "bg-green-500/15 text-green-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {workflow.isActive ? "Active" : "Inactive"}
        </span>
      </Field>

      <Field label="Nodes">
        <span className="text-sm text-foreground">
          {workflow.flowGraph?.nodes.length ?? 0}
        </span>
      </Field>
    </div>
  );
}

function NodeConfigTab({
  node,
  onRenameNode,
}: {
  node: FlowNodeDescriptor;
  onRenameNode: (nodeId: string, label: string) => void;
}) {
  const badge = typeBadge[node.type] ?? typeBadge.action!;

  const triggerEvent = node.type === "trigger" ? inferTriggerEvent(node.label) : null;
  const eventShape = triggerEvent
    ? TRIGGER_EVENT_SHAPES[triggerEvent]
    : null;

  return (
    <div className="space-y-5 overflow-auto p-4">
      <Field label="Label">
        <EditableLabel
          value={node.label}
          onCommit={(label) => onRenameNode(node.id, label)}
        />
      </Field>

      <Field label="Type">
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${badge.color}`}
        >
          {badge.label}
        </span>
      </Field>

      <Field label="ID">
        <span className="font-mono text-xs text-muted-foreground">
          {node.id}
        </span>
      </Field>

      {eventShape && (
        <Field label="Event payload">
          <pre className="whitespace-pre rounded-md bg-[#22272e] p-3 font-mono text-[12px] leading-relaxed text-gray-300">
            {eventShape}
          </pre>
        </Field>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code tabs
// ---------------------------------------------------------------------------

function NodeCodeTab({
  node,
  baseCode,
  nodeType,
  isEditable,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  node: FlowNodeDescriptor;
  baseCode: string;
  nodeType: FlowNodeType;
  isEditable: boolean;
  dirty: boolean;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  if (!isEditable) {
    return (
      <div className="flex h-full flex-col overflow-auto bg-[#22272e] p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Trigger nodes do not contain editable code.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirrorEditor
          key={node.id}
          initialCode={baseCode}
          nodeType={nodeType}
          onChange={onChange}
        />
      </div>

      <div className="flex items-center justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={onSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Save className="h-3 w-3" />
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function OverallCodeTab({ code }: { code: string }) {
  if (!code) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-xs text-muted-foreground/50">
          Generate a workflow to see its code
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <ReadOnlyCodeViewer code={code} />
    </div>
  );
}
