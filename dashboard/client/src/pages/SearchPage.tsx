import { useState, useCallback } from "react";
import { searchAll } from "@/lib/supabaseQueries";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  PieChart, Pie, Cell, Legend
} from "recharts";
import { Search, Briefcase, CheckSquare, FolderOpen, Brain } from "lucide-react";

type SearchResult = {
  ventures: any[];
  actions: any[];
  projects: any[];
  recommendations: any[];
};

const CHART_COLORS = ["hsl(186 85% 52%)", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#ef4444"];

function VentureRadar({ ventures }: { ventures: any[] }) {
  if (!ventures.length) return null;
  const data = ventures.map(v => ({
    name: v.name?.split(" ")[0] || v.slug,
    readiness: v.readiness_score || 0,
  }));
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Readiness comparison</p>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barSize={20}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(215 10% 55%)" }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: "hsl(222 18% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 6, fontSize: 12 }}
            formatter={(v: any) => [`${v}%`, "Readiness"]}
          />
          <Bar dataKey="readiness" radius={[3, 3, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActionsPie({ actions }: { actions: any[] }) {
  if (!actions.length) return null;
  const byContext = actions.reduce((acc: any, a: any) => {
    const k = a.context || "none";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const data = Object.entries(byContext).map(([name, value]) => ({ name, value }));
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Actions by context</p>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 9 }}>
            {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: "hsl(222 18% 11%)", border: "1px solid hsl(222 15% 18%)", borderRadius: 6, fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultSection({ title, icon: Icon, items, renderItem }: {
  title: string; icon: any; items: any[]; renderItem: (item: any) => React.ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={13} className="text-muted-foreground" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title} ({items.length})
        </h3>
      </div>
      <div className="space-y-1">
        {items.map(renderItem)}
      </div>
    </div>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setHasSearched(true);
    try {
      const res = await searchAll(q);
      setResults(res);
    } finally {
      setLoading(false);
    }
  }, []);

  const totalResults = results
    ? results.ventures.length + results.actions.length + results.projects.length + results.recommendations.length
    : 0;

  const showCharts = results && (results.ventures.length > 1 || results.actions.length > 1);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Search & Explore</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Ask anything — get a live dynamic view of your data
        </p>
      </div>

      {/* Search bar */}
      <Card className="search-glow">
        <CardContent className="p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="input-search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch(query)}
                placeholder="Search ventures, actions, projects… try: 'AI synergies' or 'due this week'"
                className="pl-8 text-sm border-0 bg-transparent focus-visible:ring-0 shadow-none"
              />
            </div>
            <button
              data-testid="button-search"
              onClick={() => doSearch(query)}
              disabled={loading || !query.trim()}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "…" : "Search"}
            </button>
          </div>

          {/* Suggested queries */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {[
              "AI ventures synergy",
              "active projects",
              "overdue actions",
              "high risk",
              "readiness scores",
            ].map(suggestion => (
              <button
                key={suggestion}
                onClick={() => { setQuery(suggestion); doSearch(suggestion); }}
                className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      )}

      {/* Results */}
      {!loading && hasSearched && results && (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {totalResults > 0 ? `${totalResults} results for ` : "No results for "}
              <span className="font-medium text-foreground">"{query}"</span>
            </p>
          </div>

          {/* Dynamic visualizations */}
          {showCharts && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.ventures.length > 1 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Venture Overview</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <VentureRadar ventures={results.ventures} />
                  </CardContent>
                </Card>
              )}
              {results.actions.length > 1 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Action Distribution</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <ActionsPie actions={results.actions} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Text results */}
          <div className="space-y-5">
            <ResultSection
              title="Ventures"
              icon={Briefcase}
              items={results.ventures}
              renderItem={(v) => (
                <div key={v.id} data-testid={`search-venture-${v.id}`} className="flex items-center gap-2 p-2.5 rounded-md border border-border hover:border-primary/30 transition-colors">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${v.status === "active" ? "bg-green-400" : "bg-blue-400"}`} />
                  <span className="text-sm font-medium flex-1">{v.name}</span>
                  <span className="text-[10px] text-muted-foreground tabular">{v.readiness_score}%</span>
                  <Badge variant="outline" className={`text-[10px] status-${v.status}`}>{v.status}</Badge>
                </div>
              )}
            />
            <ResultSection
              title="Actions"
              icon={CheckSquare}
              items={results.actions}
              renderItem={(a) => (
                <div key={a.id} data-testid={`search-action-${a.id}`} className="flex items-center gap-2 p-2.5 rounded-md border border-border">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-sm flex-1">{a.title}</span>
                  {a.context && <span className="text-[10px] text-muted-foreground">{a.context}</span>}
                  {a.due_date && <span className="text-[10px] tabular text-muted-foreground">{a.due_date}</span>}
                </div>
              )}
            />
            <ResultSection
              title="Projects"
              icon={FolderOpen}
              items={results.projects}
              renderItem={(p) => (
                <div key={p.id} data-testid={`search-project-${p.id}`} className="flex items-center gap-2 p-2.5 rounded-md border border-border">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                  <span className="text-sm flex-1">{p.title}</span>
                  {p.area && <span className="text-[10px] text-muted-foreground">{p.area}</span>}
                </div>
              )}
            />
            <ResultSection
              title="CEO Insights"
              icon={Brain}
              items={results.recommendations}
              renderItem={(r) => (
                <div key={r.id} data-testid={`search-rec-${r.id}`} className="flex items-center gap-2 p-2.5 rounded-md border border-border">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                  <span className="text-sm flex-1">{r.title}</span>
                  <Badge variant="outline" className={`text-[10px] priority-${r.priority}`}>{r.priority}</Badge>
                </div>
              )}
            />
          </div>
        </>
      )}

      {!loading && !hasSearched && (
        <div className="text-center py-16 text-muted-foreground">
          <Search size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Type anything to search across all your ventures, tasks, and CEO insights</p>
          <p className="text-xs mt-1 opacity-60">Charts appear automatically based on your results</p>
        </div>
      )}
    </div>
  );
}
