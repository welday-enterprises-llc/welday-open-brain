import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchActions, fetchProjects, completeAction } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Plus, Calendar, Clock } from "lucide-react";
import type { GtdAction, GtdProject } from "@shared/schema";

const CONTEXT_COLORS: Record<string, string> = {
  "@computer": "bg-blue-500/10 text-blue-400",
  "@phone": "bg-green-500/10 text-green-400",
  "@errands": "bg-amber-500/10 text-amber-400",
  "@waiting": "bg-purple-500/10 text-purple-400",
};

function ActionRow({ action, onComplete }: { action: GtdAction; onComplete: () => void }) {
  const isOverdue = action.dueDate && new Date(action.dueDate) < new Date();

  return (
    <div
      data-testid={`action-row-${action.id}`}
      className="flex items-start gap-3 py-2.5 border-b border-border last:border-0 group"
    >
      <button
        onClick={onComplete}
        className="mt-0.5 w-4 h-4 rounded border border-border flex-shrink-0 flex items-center justify-center hover:border-primary hover:bg-primary/10 transition-colors"
        title="Mark complete"
      >
        <Check size={10} className="opacity-0 group-hover:opacity-100 text-primary" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm">{action.title}</p>
        <div className="flex gap-2 mt-0.5 flex-wrap">
          {action.context && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONTEXT_COLORS[action.context] || "bg-secondary text-muted-foreground"}`}>
              {action.context}
            </span>
          )}
          {action.timeEstimateMin && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock size={9} />{action.timeEstimateMin}m
            </span>
          )}
          {(action as any).ventures?.name && (
            <span className="text-[10px] text-muted-foreground">{(action as any).ventures.name}</span>
          )}
        </div>
      </div>
      {action.dueDate && (
        <span className={`text-[10px] tabular flex-shrink-0 flex items-center gap-0.5 ${isOverdue ? "text-red-400" : "text-muted-foreground"}`}>
          <Calendar size={9} />
          {new Date(action.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}

function QuickCapture() {
  const [text, setText] = useState("");
  const mutation = useMutation({
    mutationFn: async (title: string) => {
      const { error } = await supabase.from("gtd_inbox").insert({
        raw_text: title,
        source: "web",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      queryClient.invalidateQueries({ queryKey: ["/api/inbox"] });
    },
  });

  return (
    <div className="flex gap-2">
      <Input
        data-testid="input-quick-capture"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Capture a thought… hit Enter to inbox it"
        className="text-sm"
        onKeyDown={e => e.key === "Enter" && text.trim() && mutation.mutate(text.trim())}
      />
      <Button
        data-testid="button-capture-submit"
        onClick={() => text.trim() && mutation.mutate(text.trim())}
        disabled={!text.trim() || mutation.isPending}
        size="sm"
      >
        <Plus size={14} />
      </Button>
    </div>
  );
}

export function GTDPage() {
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ["/api/actions", "active"],
    queryFn: () => fetchActions("active"),
  });
  const { data: waiting = [] } = useQuery({
    queryKey: ["/api/actions", "waiting"],
    queryFn: () => fetchActions("waiting"),
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["/api/projects", "active"],
    queryFn: () => fetchProjects("active"),
  });

  const completeMutation = useMutation({
    mutationFn: completeAction,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/actions"] }),
  });

  // Group actions by context
  const byContext = actions.reduce((acc: Record<string, GtdAction[]>, a: GtdAction) => {
    const ctx = a.context || "uncategorized";
    if (!acc[ctx]) acc[ctx] = [];
    acc[ctx].push(a);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">GTD</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {actions.length} next actions · {projects.length} active projects
        </p>
      </div>

      {/* Quick capture */}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Quick Capture → Inbox</p>
          <QuickCapture />
        </CardContent>
      </Card>

      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Next Actions ({actions.length})</TabsTrigger>
          <TabsTrigger value="projects">Projects ({projects.length})</TabsTrigger>
          <TabsTrigger value="waiting">Waiting ({waiting.length})</TabsTrigger>
        </TabsList>

        {/* Actions tab */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          {actionsLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)
          ) : actions.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Check size={20} className="mx-auto text-primary mb-2" />
                <p className="text-sm text-muted-foreground">All clear — no next actions</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(byContext).map(([ctx, ctxActions]) => (
              <Card key={ctx}>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {ctx} ({ctxActions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-2">
                  {ctxActions.map((a: GtdAction) => (
                    <ActionRow
                      key={a.id}
                      action={a}
                      onComplete={() => completeMutation.mutate(a.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Projects tab */}
        <TabsContent value="projects" className="mt-4">
          {projectsLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="space-y-2">
              {projects.map((p: GtdProject) => (
                <Card key={p.id} data-testid={`project-card-${p.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium">{p.title}</p>
                        {p.outcome && <p className="text-xs text-muted-foreground mt-0.5">→ {p.outcome}</p>}
                        {(p as any).ventures?.name && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded mt-1 inline-block">
                            {(p as any).ventures.name}
                          </span>
                        )}
                      </div>
                      {p.dueDate && (
                        <span className="text-[11px] text-muted-foreground tabular flex items-center gap-1 flex-shrink-0">
                          <Calendar size={10} />
                          {new Date(p.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Waiting tab */}
        <TabsContent value="waiting" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-1">
              {waiting.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nothing waiting</p>
              ) : (
                waiting.map((a: GtdAction) => (
                  <div key={a.id} className="flex items-center gap-2 py-2 border-b border-border last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                    <span className="text-sm flex-1">{a.title}</span>
                    {a.delegatedTo && (
                      <span className="text-[10px] text-muted-foreground">→ {a.delegatedTo}</span>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
