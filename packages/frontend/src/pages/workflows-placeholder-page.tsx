import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function WorkflowsPlaceholderPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle>Workflows</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This area is reserved for the workflow builder. You can continue from
          here in a later iteration.
        </CardContent>
      </Card>
    </div>
  );
}
