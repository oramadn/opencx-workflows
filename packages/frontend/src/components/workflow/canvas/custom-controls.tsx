import { useReactFlow } from "@xyflow/react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CustomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-stretch overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => zoomIn()}
        title="Zoom in"
        className="rounded-none border-r border-border"
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => zoomOut()}
        title="Zoom out"
        className="rounded-none border-r border-border"
      >
        <ZoomOut className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => fitView({ padding: 0.2, duration: 300 })}
        title="Fit view"
        className="rounded-none"
      >
        <Maximize2 className="size-4" />
      </Button>
    </div>
  );
}
