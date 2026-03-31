import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";
import { Accordion } from "radix-ui";
import {
  ArrowLeft,
  ChevronDown,
  Clock,
  Copy,
  GitBranch,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_ACTION_ICON,
  nodeIconMap,
} from "@/components/workflow/canvas/icons";
import { cn } from "@/lib/utils";
import {
  SDK_REFERENCE_SECTIONS,
  filterSdkReferenceSections,
  type SdkReferenceItem,
  type SdkReferenceSection,
} from "@/lib/workflow-sdk-reference";

type IconComp = ComponentType<{ className?: string }>;

const REFERENCE_ICON_MAP: Record<string, IconComp> = {
  ...nodeIconMap,
  condition: GitBranch,
  delay: Clock,
};

function findSectionForItem(itemId: string): SdkReferenceSection | null {
  for (const s of SDK_REFERENCE_SECTIONS) {
    if (s.items.some((i) => i.id === itemId)) return s;
  }
  return null;
}

function ReferenceTile({
  item,
  onSelect,
}: {
  item: SdkReferenceItem;
  onSelect: () => void;
}) {
  const Icon = REFERENCE_ICON_MAP[item.iconKey] ?? DEFAULT_ACTION_ICON;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex aspect-square w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg border bg-black p-2 text-center shadow-sm transition-colors",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "border-border",
      )}
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-8 text-foreground" />
      </div>
      <span className="w-full px-0.5 font-mono text-[11px] font-medium leading-tight whitespace-normal break-words text-foreground">
        {item.title}
      </span>
    </button>
  );
}

function ReferenceDetailPage({ item }: { item: SdkReferenceItem }) {
  const [copied, setCopied] = useState(false);
  const Icon = REFERENCE_ICON_MAP[item.iconKey] ?? DEFAULT_ACTION_ICON;

  const copyExample = useCallback(() => {
    void navigator.clipboard.writeText(item.examplePrompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [item.examplePrompt]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
          <Icon className="size-7 text-foreground" />
        </div>
        <h2 className="min-w-0 font-mono text-base font-semibold tracking-tight text-foreground">
          {item.title}
        </h2>
      </div>

      <p className="text-sm leading-relaxed text-foreground">{item.summary}</p>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          You can mention
        </h3>
        <ul className="list-inside list-disc space-y-1.5 text-sm text-foreground">
          {item.attributes.map((line, idx) => (
            <li key={`${idx}-${line}`} className="leading-snug">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Example prompt
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={copyExample}
          >
            <Copy className="size-3" />
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <blockquote className="border-muted-foreground/25 border-l-2 pl-3 text-sm leading-relaxed text-foreground">
          {item.examplePrompt}
        </blockquote>
      </div>
    </div>
  );
}

function SdkReferenceBreadcrumb({
  section,
  itemTitle,
  onGoToBrowse,
}: {
  section: SdkReferenceSection;
  itemTitle: string;
  onGoToBrowse: () => void;
}) {
  const crumbClass =
    "rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <nav
      aria-label="Breadcrumb"
      className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px]"
    >
      <button type="button" onClick={onGoToBrowse} className={crumbClass}>
        SDK reference
      </button>
      <span className="text-muted-foreground/60" aria-hidden>
        /
      </span>
      <button type="button" onClick={onGoToBrowse} className={crumbClass}>
        {section.title}
      </button>
      <span className="text-muted-foreground/60" aria-hidden>
        /
      </span>
      <span
        className="min-w-0 truncate font-mono font-medium text-foreground"
        aria-current="page"
      >
        {itemTitle}
      </span>
    </nav>
  );
}

function ReferenceSectionAccordion({
  section,
  onOpenItem,
}: {
  section: SdkReferenceSection;
  onOpenItem: (item: SdkReferenceItem) => void;
}) {
  return (
    <Accordion.Item
      value={section.id}
      className="overflow-hidden rounded-lg border border-border"
    >
      <Accordion.Header className="flex">
        <Accordion.Trigger className="group flex flex-1 items-center justify-between gap-2 bg-muted/30 px-3 py-2.5 text-left text-sm font-semibold text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          {section.title}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content className="overflow-hidden border-t border-border bg-background">
        <div className="p-1.5">
          <div className="grid grid-cols-3 gap-1.5">
            {section.items.map((item) => (
              <ReferenceTile
                key={item.id}
                item={item}
                onSelect={() => onOpenItem(item)}
              />
            ))}
          </div>
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
}

export interface WorkflowSdkReferencePanelProps {
  onClose: () => void;
}

export function WorkflowSdkReferencePanel({
  onClose,
}: WorkflowSdkReferencePanelProps) {
  const [query, setQuery] = useState("");
  const [detailItem, setDetailItem] = useState<SdkReferenceItem | null>(null);

  const filtered = useMemo(
    () => filterSdkReferenceSections(SDK_REFERENCE_SECTIONS, query),
    [query],
  );

  const detailSection =
    detailItem != null ? findSectionForItem(detailItem.id) : null;

  const showDetailLayer =
    detailItem != null &&
    detailSection != null &&
    filtered.some((s) => s.items.some((i) => i.id === detailItem.id));

  function goBackFromDetail() {
    setDetailItem(null);
  }

  function handleHeaderBack() {
    if (detailItem != null) {
      setDetailItem(null);
      return;
    }
    onClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleHeaderBack}
          className="shrink-0"
          title={detailItem ? "Back to SDK reference" : "Back to workflow"}
          aria-label={
            detailItem ? "Back to SDK reference" : "Back to workflow"
          }
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          {showDetailLayer ? (
            <>
              <p className="truncate font-mono text-sm font-semibold text-foreground">
                {detailItem!.title}
              </p>
              <SdkReferenceBreadcrumb
                section={detailSection!}
                itemTitle={detailItem!.title}
                onGoToBrowse={goBackFromDetail}
              />
            </>
          ) : (
            <>
              <p className="truncate text-sm font-semibold text-foreground">
                SDK reference
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                AI-only — not runnable from here
              </p>
            </>
          )}
        </div>
      </div>

      {showDetailLayer ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ReferenceDetailPage item={detailItem!} />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-3 py-2">
            <label className="relative block">
              <span className="sr-only">Search reference</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDetailItem(null);
                }}
                placeholder="Search…"
                autoComplete="off"
                className="h-8 w-full rounded-md border border-border bg-background py-1 pr-2 pl-8 text-xs ring-offset-background outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </label>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Actions are exposed as{" "}
              <span className="font-mono text-foreground">tools</span> in the
              sandbox. Tap an item for inputs and outputs.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {filtered.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">
                No entries match your search.
              </p>
            ) : (
              <Accordion.Root
                key={query.trim()}
                type="multiple"
                defaultValue={
                  query.trim()
                    ? filtered.map((s) => s.id)
                    : []
                }
                className="space-y-2"
              >
                {filtered.map((section) => (
                  <ReferenceSectionAccordion
                    key={section.id}
                    section={section}
                    onOpenItem={setDetailItem}
                  />
                ))}
              </Accordion.Root>
            )}
          </div>
        </>
      )}
    </div>
  );
}
