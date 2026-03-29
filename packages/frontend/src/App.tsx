import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import { InboxPage } from "@/pages/inbox-page";
import { WorkflowBuilderPage } from "@/pages/workflow-builder-page";
import { WorkflowsListPage } from "@/pages/workflows-list-page";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/workflows" element={<WorkflowsListPage />} />
        <Route path="/workflows/new" element={<WorkflowBuilderPage />} />
        <Route path="/workflows/:id" element={<WorkflowBuilderPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
