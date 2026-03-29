import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Sentiment } from "@/types/session";

type CloseSessionModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (sentiment: Sentiment) => Promise<void>;
};

const SENTIMENTS: { value: Sentiment; label: string }[] = [
  { value: "happy", label: "Happy" },
  { value: "neutral", label: "Neutral" },
  { value: "angry", label: "Angry" },
];

export function CloseSessionModal({
  open,
  onOpenChange,
  onConfirm,
}: CloseSessionModalProps) {
  const [sentiment, setSentiment] = useState<Sentiment | "">("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!sentiment) return;
    setPending(true);
    try {
      await onConfirm(sentiment);
      setSentiment("");
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSentiment("");
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Close session</DialogTitle>
          <DialogDescription>
            Choose how the customer seemed at the end of this session. This
            prototype records it manually—no AI is involved.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Label id="sentiment-label">Sentiment</Label>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={sentiment}
            onValueChange={(v) => {
              if (v === "happy" || v === "neutral" || v === "angry") {
                setSentiment(v);
              }
            }}
            className="w-full justify-stretch"
            aria-labelledby="sentiment-label"
          >
            {SENTIMENTS.map(({ value, label }) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="flex-1 capitalize"
              >
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!sentiment || pending}
            onClick={() => void submit()}
          >
            {pending ? "Closing…" : "Close session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
