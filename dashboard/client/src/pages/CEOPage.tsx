import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchCeoRecs, acknowledgeCeoRec, fetchVentures } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Zap, ArrowRight, CheckCircle2, Link2 } from "lucide-react";
import type { CeoRecommendation, Venture } from "@shared/schema";

const PRIORITY_ICON: Record<string, string> = {
  critical: "🔴", high: "🟠", medium: "🟡", low: "⚪",
};
const TYPE_LABEL: Record<string, string> = {
  synergy: "Synergy", risk: "Risk Alert", opportunity: "Opportunity",
  action: "Action", insight: "Insight",
};

function RecCard({ rec, ventures, onAcknowledge }: {
  rec: CeoRecommendation; ventures: Venture[]; onAcknowledge: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const involvedVentures = rec.venturesInvolved
    ?.map((id: string) => ventures.find(v => v.id === id))
    .filter(Boolean) || [];

  return (
    <Card data-testid={`ceo-rec-card-${rec.id}`} className="venture-card border border-border">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-base flex-shrink-0 mt-0.5">{PRIORITY_ICON[rec.priority || "medium"]}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold leading-tight">{rec.title}</h3>
              <Badge variant="outline" className="text-[10px] flex-shrink-0">
                {TYPE_LABEL[rec.type] || rec.type}
              </Badge>
            </div>

            {/* Involved ventures */}
            {involvedVentures.length > 0 && (
              <div className="flex gap-1 mb-2 flex-wrap">
                {involvedVentures.map((v: any) => (
                  <span key={v.id} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Link2 size={8} />{v.name}
                  </span>
                ))}
              </div>
            )}

            <p className={`text-xs text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
              {rec.body}
            </p>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-[11px] text-primary hover:underline mt-1"
            >
              {expanded ? "Show less" : "Read more"}
            </button>

            {expanded && rec.actionItems && rec.actionItems.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Action items</p>
                {rec.actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <ArrowRight size={10} className="mt-0.5 flex-shrink-0 text-primary" />
                    <span className="text-xs">{item}</span>
                  </div>
                ))}
              </div>
            )}

            {expanded && rec.estimatedRevenueImpact && (
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <Zap size={11} className="text-primary" />
                <span className="text-muted-foreground">Impact:</span>
                <span className="font-medium text-primary">{rec.estimatedRevenueImpact}</span>
              </div>
            )}

            <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
              <span className="text-[10px] text-muted-foreground">
                {rec.aiModelUsed && `via ${rec.aiModelUsed} · `}
                {new Date(rec.generatedAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
              {rec.status === "new" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px] gap-1"
                  onClick={onAcknowledge}
                >
                  <CheckCircle2 size={10} /> Acknowledge
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SynergyMatrix({ ventures }: { ventures: Venture[] }) {
  // Build a simple tag overlap matrix for visualization
  const tagMap = ventures.reduce((acc: Record<string, string[]>, v: Venture) => {
    (v.synergyTags || []).forEach((tag: string) => {
      if (!acc[tag]) acc[tag] = [];
      acc[tag].push(v.name);
    });
    return acc;
  }, {});

  const sharedTags = Object.entries(tagMap)
    .filter(([, names]) => names.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Shared capability tags across ventures — potential synergy clusters
      </p>
      {sharedTags.map(([tag, names]) => (
        <div key={tag} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded w-28 text-center flex-shrink-0">
            #{tag}
          </span>
          <div className="flex gap-1 flex-wrap">
            {names.map(name => (
              <span key={name} className="text-[11px] bg-secondary text-foreground px-1.5 py-0.5 rounded">
                {name.split(" ")[0]}
              </span>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
            {names.length} ventures
          </span>
        </div>
      ))}
    </div>
  );
}

export function CEOPage() {
  const { data: newRecs = [], isLoading } = useQuery({
    queryKey: ["/api/ceo/recs", "new"],
    queryFn: () => fetchCeoRecs("new"),
  });
  const { data: ackRecs = [] } = useQuery({
    queryKey: ["/api/ceo/recs", "acknowledged"],
    queryFn: () => fetchCeoRecs("acknowledged"),
  });
  const { data: ventures = [] } = useQuery({
    queryKey: ["/api/ventures"],
    queryFn: fetchVentures,
  });

  const ackMutation = useMutation({
    mutationFn: acknowledgeCeoRec,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ceo/recs"] });
    },
  });

  const synergyRecs = newRecs.filter((r: CeoRecommendation) => r.type === "synergy");
  const otherRecs = newRecs.filter((r: CeoRecommendation) => r.type !== "synergy");

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg pulse-glow">
          <Brain size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Virtual CEO</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {newRecs.length} new insights · synergy analysis across {ventures.length} ventures
          </p>
        </div>
      </div>

      <Tabs defaultValue="insights">
        <TabsList>
          <TabsTrigger value="insights">New Insights ({newRecs.length})</TabsTrigger>
          <TabsTrigger value="synergy">Synergy Map</TabsTrigger>
          <TabsTrigger value="history">History ({ackRecs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="insights" className="mt-4 space-y-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)
          ) : newRecs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Brain size={24} className="mx-auto text-primary mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">
                  No new CEO insights yet.<br />
                  The Virtual CEO analyzes your portfolio on each scheduled run.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {synergyRecs.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Synergy Opportunities ({synergyRecs.length})
                  </h2>
                  {synergyRecs.map((r: CeoRecommendation) => (
                    <RecCard
                      key={r.id}
                      rec={r}
                      ventures={ventures}
                      onAcknowledge={() => ackMutation.mutate(r.id)}
                    />
                  ))}
                </div>
              )}
              {otherRecs.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Other Insights ({otherRecs.length})
                  </h2>
                  {otherRecs.map((r: CeoRecommendation) => (
                    <RecCard
                      key={r.id}
                      rec={r}
                      ventures={ventures}
                      onAcknowledge={() => ackMutation.mutate(r.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="synergy" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Synergy Tag Matrix</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <SynergyMatrix ventures={ventures} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4 space-y-3">
          {ackRecs.map((r: CeoRecommendation) => (
            <RecCard
              key={r.id}
              rec={r}
              ventures={ventures}
              onAcknowledge={() => {}}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
