import { Inbox, MessageSquarePlus, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  closeSession,
  createSession,
  getSession,
  listSessions,
  postMessage,
} from "@/api/sessions";
import { CloseSessionModal } from "@/components/close-session-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type {
  AuthorRole,
  Sentiment,
  SessionDetail,
  SessionSummary,
} from "@/types/session";

const POLL_MS = 4000;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function InboxPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [composer, setComposer] = useState("");
  const [authorRole, setAuthorRole] = useState<AuthorRole>("customer");
  const [closeOpen, setCloseOpen] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const rows = await listSessions();
      setSessions(rows);
      setListError(null);
    } catch {
      setListError("Could not load sessions. Is the API running?");
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const d = await getSession(id);
      setDetail(d);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    const t = setInterval(() => void refreshList(), POLL_MS);
    return () => clearInterval(t);
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void refreshDetail(selectedId);
    const t = setInterval(() => void refreshDetail(selectedId), POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, refreshDetail]);

  const session = detail?.session;
  const isOpen = session?.status === "open";

  const handleNewSession = async () => {
    setSendError(null);
    try {
      const s = await createSession();
      await refreshList();
      setSelectedId(s.id);
    } catch {
      setSendError("Failed to create session");
    }
  };

  const handleSend = async () => {
    if (!selectedId || !composer.trim() || !isOpen) return;
    setSendError(null);
    try {
      await postMessage(selectedId, authorRole, composer.trim());
      setComposer("");
      await refreshDetail(selectedId);
      await refreshList();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    }
  };

  const handleCloseConfirm = async (sentiment: Sentiment) => {
    if (!selectedId) return;
    await closeSession(selectedId, sentiment);
    await refreshList();
    await refreshDetail(selectedId);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-card/50">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
          <span className="text-sm font-medium text-foreground">Sessions</span>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={() => void handleNewSession()}
            title="New session"
          >
            <Plus className="size-4" />
          </Button>
        </div>
        {listError && (
          <p className="px-3 py-2 text-xs text-destructive">{listError}</p>
        )}
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-0.5 p-2">
            {sessions.length === 0 && !listError && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                No sessions yet. Create one to start.
              </li>
            )}
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60",
                    selectedId === s.id && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="truncate font-medium">{s.customerName}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-medium uppercase tracking-wide",
                        s.status === "open"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {s.status}
                    </span>
                    <span className="truncate">
                      {formatTime(s.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </aside>

      <Separator orientation="vertical" className="hidden sm:block" />

      <section className="flex min-w-0 flex-1 flex-col bg-background">
        {!selectedId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
            <Inbox className="size-12 opacity-40" aria-hidden />
            <p className="max-w-sm text-sm">
              Select a session or create a new one to play both customer and
              agent in this prototype.
            </p>
          </div>
        )}

        {selectedId && session && (
          <>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  {session.customerName}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {session.status === "open"
                    ? "Open — send as customer or agent below"
                    : `Closed — sentiment: ${session.sentiment ?? "—"}`}
                </p>
              </div>
              {isOpen && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCloseOpen(true)}
                >
                  Close session
                </Button>
              )}
            </header>

            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 p-4">
                {detail?.messages.length === 0 && (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                      <MessageSquarePlus className="size-8 opacity-50" />
                      <p>No messages yet. Say something as the customer or agent.</p>
                    </CardContent>
                  </Card>
                )}
                {detail?.messages.map((m) => {
                  const isCustomer = m.authorRole === "customer";
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex w-full",
                        isCustomer ? "justify-start" : "justify-end",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[min(100%,28rem)] rounded-lg border px-3 py-2 text-sm shadow-xs",
                          isCustomer
                            ? "border-border bg-muted/60 text-foreground"
                            : "border-primary/30 bg-primary/10 text-foreground",
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="font-medium capitalize">
                            {m.authorRole === "customer" ? "Customer" : "Agent"}
                          </span>
                          <span>{formatTime(m.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {isOpen && (
              <footer className="shrink-0 border-t border-border bg-card/40 p-4">
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Send as
                    </span>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      spacing={0}
                      value={authorRole}
                      onValueChange={(v) => {
                        if (v === "customer" || v === "agent") {
                          setAuthorRole(v);
                        }
                      }}
                    >
                      <ToggleGroupItem value="customer" className="px-4">
                        Customer
                      </ToggleGroupItem>
                      <ToggleGroupItem value="agent" className="px-4">
                        Agent
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <Textarea
                    placeholder="Type a message…"
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    rows={3}
                    className="resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                  />
                  {sendError && (
                    <p className="text-xs text-destructive">{sendError}</p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={!composer.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </footer>
            )}
          </>
        )}
      </section>

      <CloseSessionModal
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onConfirm={handleCloseConfirm}
      />
    </div>
  );
}
