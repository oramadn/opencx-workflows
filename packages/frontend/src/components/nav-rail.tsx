import { Inbox, Layers } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const linkBase =
  "flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

export function NavRail() {
  return (
    <nav
      className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-4"
      aria-label="Main"
    >
      <NavLink
        to="/inbox"
        className={({ isActive }) => cn(linkBase, isActive && "bg-accent text-accent-foreground")}
        title="Inbox"
      >
        <Inbox className="size-5" aria-hidden />
      </NavLink>
      <NavLink
        to="/workflows"
        className={({ isActive }) => cn(linkBase, isActive && "bg-accent text-accent-foreground")}
        title="Workflows"
      >
        <Layers className="size-5" aria-hidden />
      </NavLink>
    </nav>
  );
}
