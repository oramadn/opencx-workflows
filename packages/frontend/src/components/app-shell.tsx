import { Outlet } from "react-router-dom";

import { NavRail } from "@/components/nav-rail";

export function AppShell() {
  return (
    <div className="flex h-dvh min-h-0 w-full bg-background">
      <NavRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
