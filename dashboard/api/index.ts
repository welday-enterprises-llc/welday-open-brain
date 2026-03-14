import type { IncomingMessage, ServerResponse } from "http";

type Req = IncomingMessage & { url?: string; method?: string; body?: any; query?: any };
type Res = ServerResponse & { json: (data: any) => void; status: (code: number) => Res };

const GEMINI_MODEL = "gemini-1.5-flash";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, key);
}

async function gemini(systemPrompt: string, messages: any[], maxTokens = 300) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const turns = messages.filter((m: any) => m.role !== "system");
  const contents = turns.map((m: any) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: any = {
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function buildContext(supabase: any) {
  const now   = new Date();
  const today = now.toISOString().split("T")[0];
  const in3   = new Date(now.getTime() + 3 * 86400000).toISOString().split("T")[0];

  const [
    { data: overdue }, { data: todayItems }, { data: soon },
    { data: inbox },  { data: waiting },    { data: ventures },
    { data: alerts },
  ] = await Promise.all([
    supabase.from("gtd_actions").select("title,context,due_date,ventures(name)").eq("status","active").lt("due_date",today).limit(8),
    supabase.from("gtd_actions").select("title,context,energy,ventures(name)").eq("status","active").eq("due_date",today).limit(8),
    supabase.from("gtd_actions").select("title,due_date,ventures(name)").eq("status","active").gt("due_date",today).lte("due_date",in3).order("due_date").limit(6),
    supabase.from("gtd_inbox").select("raw_text").eq("processed",false).limit(5),
    supabase.from("gtd_actions").select("title,delegated_to").eq("status","waiting").limit(5),
    supabase.from("ventures").select("name,readiness_score,risk_level,monthly_revenue_usd").eq("status","active").order("readiness_score",{ascending:false}),
    supabase.from("ceo_recommendations").select("title,priority").eq("status","new").in("priority",["critical","high"]).limit(3),
  ]);

  const lines: string[] = [];
  lines.push(`TODAY: ${now.toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}`);
  if (overdue?.length)    { lines.push(`\nOVERDUE (${overdue.length}):`);    overdue.forEach((a:any)    => lines.push(`  • ${a.title} — was due ${a.due_date}`)); }
  if (todayItems?.length) { lines.push(`\nDUE TODAY (${todayItems.length}):`); todayItems.forEach((a:any) => lines.push(`  • ${a.title}${a.context?` ${a.context}`:""}`)); }
  else lines.push(`\nDUE TODAY: nothing scheduled`);
  if (soon?.length)       { lines.push(`\nNEXT 3 DAYS:`); soon.forEach((a:any) => lines.push(`  • ${a.title} — ${a.due_date}`)); }
  lines.push(`\nINBOX: ${inbox?.length||0} unprocessed`);
  if (waiting?.length)    { lines.push(`\nWAITING FOR:`); waiting.forEach((w:any) => lines.push(`  • ${w.title}${w.delegated_to?` → ${w.delegated_to}`:""}`)); }
  if (ventures?.length)   { lines.push(`\nACTIVE VENTURES:`); ventures.forEach((v:any) => lines.push(`  • ${v.name} ${v.readiness_score}%`)); }
  if (alerts?.length)     { lines.push(`\nCEO ALERTS:`); alerts.forEach((r:any) => lines.push(`  • [${r.priority}] ${r.title}`)); }
  return lines.join("\n");
}

function getSystemPrompt(role: string, context: string) {
  switch (role) {
    case "ceo":
      return `You are Burns — the Virtual CEO of Welday Enterprises. Cold, calculating, brilliant. You speak like Mr. Burns from The Simpsons — measured, slightly imperious, dry wit. Focus on portfolio strategy, synergies, revenue. Under 180 words.\n\nPORTFOLIO STATE:\n${context}`;
    case "jailbait":
      return `You are the Executive Assistant for Welday Enterprises — playful, sharp, witty. Inspired by Charlie Wilson's War secretaries. Tactical (today and this week). Short punchy replies, casual language, occasional emoji. Under 150 words.\n\nCURRENT STATE:\n${context}`;
    case "filer":
      return `You are Radar — the GTD Filer. Like Radar O'Reilly from M*A*S*H. Terse, anticipatory. Confirm captures, report inbox status. Under 80 words.\n\nCURRENT STATE:\n${context}`;
    default: // smithers / assistant
      return `You are Smithers — the Executive Assistant for Welday Enterprises. Efficient, professional, helpful. Focus on TODAY and THIS WEEK. One clear answer when asked what to do next. Under 150 words. Accept captures.\n\nCURRENT STATE:\n${context}`;
  }
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
const BOTS: Record<string, { token: string; role: string }> = {
  Burns_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_BURNS    || "", role: "ceo" },
  Smithers_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_SMITHERS || "", role: "assistant" },
  Radar_Welday_Ent_bot:    { token: process.env.TELEGRAM_TOKEN_RADAR    || "", role: "filer" },
  Jailbait_Welday_Ent_bot: { token: process.env.TELEGRAM_TOKEN_JAILBAIT || "", role: "jailbait" },
};

async function tgSend(token: string, chatId: number, text: string) {
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).catch(() => {});
}

// ─── Main handler ─────────────────────────────────────────────────────────────
async function parseBody(req: Req): Promise<any> {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = "";
    req.on("data", (chunk: any) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req: Req, res: Res) {
  // Attach helpers Vercel expects
  const json = (data: any) => { res.setHeader("Content-Type","application/json"); res.end(JSON.stringify(data)); };
  const status = (code: number) => { res.statusCode = code; return { json }; };
  const path = (req.url || "").split("?")[0];

  // Parse body for POST requests
  if (req.method === "POST" && !req.body) {
    req.body = await parseBody(req);
  }

  // Health check
  if (path === "/api/health") {
    return json({ status: "ok", ts: new Date().toISOString() });
  }

  // EA Chat
  if (path === "/api/ea/chat" && req.method === "POST") {
    const { message, history = [], persona = "smithers" } = req.body || {};
    if (!message?.trim()) return status(400).json({ error: "message required" });

    const supabase = getSupabase();
    let context = "(no live data — Supabase not configured)";
    if (supabase) { try { context = await buildContext(supabase); } catch (e: any) { context = `(context error: ${e.message})`; } }

    const role = persona === "jailbait" ? "jailbait" : "assistant";
    const systemPrompt = getSystemPrompt(role, context);

    const captureMatch = message.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
    if (captureMatch && supabase) {
      await supabase.from("gtd_inbox").insert({ source: "web", raw_text: captureMatch[1].trim() }).catch(() => {});
    }

    try {
      const allMessages = [
        ...((history || []).slice(-10).map((m: any) => ({ role: m.role, content: m.content }))),
        { role: "user", content: message },
      ];
      const reply = await gemini(systemPrompt, allMessages, 300);
      if (supabase) supabase.from("agent_logs").insert({ agent_name: "ea_agent_dashboard", action: "chat", input_summary: message.substring(0,100), output_summary: reply.substring(0,100), model_used: GEMINI_MODEL, success: true }).catch(() => {});
      return json({ reply });
    } catch (err: any) {
      return status(500).json({ error: err.message });
    }
  }

  // EA Briefing
  if (path === "/api/ea/briefing" && req.method === "POST") {
    const supabase = getSupabase();
    let context = "(no data)";
    if (supabase) { try { context = await buildContext(supabase); } catch {} }
    try {
      const reply = await gemini(getSystemPrompt("assistant", context), [{ role: "user", content: "Morning briefing — top 3 things for today. Under 120 words." }], 350);
      return json({ briefing: reply });
    } catch (err: any) { return status(500).json({ error: err.message }); }
  }

  // Telegram webhooks
  const tgMatch = path.match(/^\/api\/telegram\/(.+)$/);
  if (tgMatch && req.method === "POST") {
    const botName = tgMatch[1];
    const bot = BOTS[botName];
    if (!bot) return status(404).json({ error: "unknown bot" });

    const message = req.body?.message;
    if (message?.text) {
      const text: string = message.text;
      const chatId: number = message.chat?.id;
      const { token, role } = bot;
      const supabase = getSupabase();

      if (!text.startsWith("/") && supabase) {
        await supabase.from("gtd_inbox").insert({ source: "telegram", raw_text: text, telegram_chat_id: chatId }).catch(() => {});
      }

      if (role === "filer") {
        if (text === "/status" && supabase) {
          const { data } = await supabase.from("gtd_inbox").select("id").eq("processed", false);
          await tgSend(token, chatId, `📋 ${data?.length||0} items in inbox. Send /process to file now.`);
        } else if (text === "/process" || text === "/file") {
          await tgSend(token, chatId, "📋 Processing your inbox now, sir. Stand by.");
        } else {
          await tgSend(token, chatId, `✅ Noted: "${text.substring(0,80)}" — filing next run.`);
        }
      } else {
        let context = "(no data)";
        if (supabase) { try { context = await buildContext(supabase); } catch {} }
        const userMsg = (text === "/briefing" || text === "/b") ? "Give me my briefing for today. Top 3 things. Under 100 words." : text;
        try {
          const reply = await gemini(getSystemPrompt(role, context), [{ role: "user", content: userMsg }], 280);
          await tgSend(token, chatId, reply);
        } catch (err: any) {
          await tgSend(token, chatId, "Something went wrong — try again.");
        }
      }
    }
    return json({ ok: true });
  }

  // CEO / GTD cron stubs
  if (path === "/api/ceo/run")    return json({ message: "CEO agent stub — configure as external cron" });
  if (path === "/api/gtd/process") return json({ message: "GTD filer stub — configure as external cron" });

  return status(404).json({ error: "not found", path });
}
