import { supabase } from "./supabase";
import type { Venture, GtdInbox, GtdAction, GtdProject, CeoRecommendation, AgentLog } from "@shared/schema";

// ─── Ventures ────────────────────────────────────────────────
export async function fetchVentures(): Promise<Venture[]> {
  const { data, error } = await supabase
    .from("ventures")
    .select("*")
    .order("readiness_score", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateVenture(id: string, patch: Partial<Venture>) {
  const { error } = await supabase.from("ventures").update(patch).eq("id", id);
  if (error) throw error;
}

// ─── GTD Inbox ───────────────────────────────────────────────
export async function fetchInbox(limit = 50): Promise<GtdInbox[]> {
  const { data, error } = await supabase
    .from("gtd_inbox")
    .select("*")
    .eq("processed", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function addToInbox(rawText: string, source = "web") {
  const { error } = await supabase
    .from("gtd_inbox")
    .insert({ raw_text: rawText, source });
  if (error) throw error;
}

// ─── GTD Actions ─────────────────────────────────────────────
export async function fetchActions(status = "active"): Promise<GtdAction[]> {
  const { data, error } = await supabase
    .from("gtd_actions")
    .select("*, gtd_projects(title), ventures(name, slug)")
    .eq("status", status)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function completeAction(id: string) {
  const { error } = await supabase
    .from("gtd_actions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ─── GTD Projects ────────────────────────────────────────────
export async function fetchProjects(status = "active"): Promise<GtdProject[]> {
  const { data, error } = await supabase
    .from("gtd_projects")
    .select("*, ventures(name, slug)")
    .eq("status", status)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// ─── CEO Recommendations ─────────────────────────────────────
export async function fetchCeoRecs(status = "new"): Promise<CeoRecommendation[]> {
  const { data, error } = await supabase
    .from("ceo_recommendations")
    .select("*")
    .eq("status", status)
    .order("generated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function acknowledgeCeoRec(id: string) {
  const { error } = await supabase
    .from("ceo_recommendations")
    .update({ status: "acknowledged", acknowledged_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ─── Agent Logs ──────────────────────────────────────────────
export async function fetchRecentLogs(limit = 20): Promise<AgentLog[]> {
  const { data, error } = await supabase
    .from("agent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ─── Portfolio Stats ──────────────────────────────────────────
export async function fetchPortfolioStats() {
  const { data: ventures, error } = await supabase
    .from("ventures")
    .select("status, readiness_score, monthly_revenue_usd, monthly_visitors, risk_level");
  if (error) throw error;

  const total = ventures?.length || 0;
  const active = ventures?.filter((v: any) => v.status === "active").length || 0;
  const totalRevenue = ventures?.reduce((sum: number, v: any) => sum + parseFloat(v.monthly_revenue_usd || 0), 0) || 0;
  const totalVisitors = ventures?.reduce((sum: number, v: any) => sum + (v.monthly_visitors || 0), 0) || 0;
  const avgReadiness = total > 0
    ? Math.round(ventures!.reduce((sum: number, v: any) => sum + (v.readiness_score || 0), 0) / total)
    : 0;

  return { total, active, totalRevenue, totalVisitors, avgReadiness };
}

// ─── Search / NL Query → data ─────────────────────────────────
// This is the foundation for the natural language search bar.
// Phase 1: keyword search across key tables.
export async function searchAll(query: string) {
  const q = query.trim();
  if (!q) return { ventures: [], actions: [], projects: [], recommendations: [] };

  const [v, a, p, r] = await Promise.all([
    supabase
      .from("ventures")
      .select("id, slug, name, status, readiness_score, ceo_notes, synergy_tags")
      .or(`name.ilike.%${q}%,description.ilike.%${q}%,ceo_notes.ilike.%${q}%`)
      .limit(5),
    supabase
      .from("gtd_actions")
      .select("id, title, status, context, due_date")
      .ilike("title", `%${q}%`)
      .eq("status", "active")
      .limit(5),
    supabase
      .from("gtd_projects")
      .select("id, title, status, area, due_date")
      .ilike("title", `%${q}%`)
      .limit(5),
    supabase
      .from("ceo_recommendations")
      .select("id, title, type, priority, status")
      .or(`title.ilike.%${q}%,body.ilike.%${q}%`)
      .limit(5),
  ]);

  return {
    ventures: v.data || [],
    actions: a.data || [],
    projects: p.data || [],
    recommendations: r.data || [],
  };
}
