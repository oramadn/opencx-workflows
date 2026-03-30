import { Pencil, Workflow } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface WorkflowTitleProps {
  name: string;
  onRename: (name: string) => Promise<void>;
}

export function WorkflowTitle({ name, onRename }: WorkflowTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch {
      setDraft(name);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, name, onRename]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(name);
      setEditing(false);
    }
  }

  return (
    <div className="group flex items-center gap-2">
      <Workflow className="size-4 shrink-0 text-muted-foreground" />

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit()}
          disabled={saving}
          maxLength={255}
          className="h-6 rounded border-none bg-transparent px-0 text-sm font-medium text-foreground outline-none focus:ring-0"
          style={{ width: `${Math.max(draft.length, 1)}ch` }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
          title="Click to rename"
        >
          <span>{name}</span>
          <Pencil className="size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  );
}
