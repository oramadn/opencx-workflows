import { ChevronLeft, ChevronRight, Inbox, Layers } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

type NavItem = {
  to: string;
  label: string;
  Icon: typeof Inbox;
};

const items: NavItem[] = [
  { to: "/inbox", label: "Inbox", Icon: Inbox },
  { to: "/workflows", label: "Workflows", Icon: Layers },
];

export function NavRail() {
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const expanded = pinnedOpen || hovered;

  return (
    <nav
      className={cn(
        "relative flex shrink-0 flex-col gap-1 border-r border-border bg-card py-3 transition-[width] duration-200 ease-out",
        expanded ? "w-44 px-2" : "w-14 px-1.5",
      )}
      aria-label="Main"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-1 flex-col gap-1">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/inbox"}
            title={label}
            className={({ isActive }) =>
              cn(
                "flex min-h-10 cursor-pointer items-center gap-3 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                expanded ? "justify-start px-2" : "justify-center px-0",
                isActive && "bg-accent text-accent-foreground",
              )
            }
          >
            <Icon className="size-5 shrink-0" aria-hidden />
            <span
              className={cn(
                "overflow-hidden whitespace-nowrap text-sm font-medium transition-[opacity,max-width] duration-200",
                expanded ? "max-w-[10rem] opacity-100" : "max-w-0 opacity-0",
              )}
            >
              {label}
            </span>
          </NavLink>
        ))}
      </div>

      <button
        type="button"
        className={cn(
          "mt-1 flex min-h-9 cursor-pointer items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
          expanded ? "justify-start gap-2 px-2" : "justify-center px-0",
        )}
        onClick={() => setPinnedOpen((p) => !p)}
        aria-expanded={pinnedOpen}
        aria-pressed={pinnedOpen}
        aria-label={pinnedOpen ? "Collapse sidebar labels" : "Keep sidebar labels visible"}
      >
        {pinnedOpen ? (
          <ChevronLeft className="size-5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        )}
        <span
          className={cn(
            "overflow-hidden whitespace-nowrap text-left text-sm transition-[opacity,max-width] duration-200",
            expanded ? "max-w-[10rem] opacity-100" : "max-w-0 opacity-0",
          )}
        >
          {pinnedOpen ? "Narrow rail" : "Pin open"}
        </span>
      </button>
    </nav>
  );
}
