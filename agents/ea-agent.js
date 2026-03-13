/**
 * WELDAY ENTERPRISES — EXECUTIVE ASSISTANT AGENT
 * ------------------------------------------------
 * Sits between the CEO Agent (strategic) and GTD Filer (classification).
 * Lives in the dashboard chat UI AND in Telegram (any message that isn't
 * a /process or /file command goes here).
 *
 * Personality:
 *   - Focused on TODAY and THIS WEEK
 *   - Knows your overdue items, what's due today, what's due soon
 *   - Knows the status of all 11 ventures at a glance
 *   - Knows your unprocessed inbox count
 *   - Never lectures, never over-explains
 *   - Talks like a sharp, efficient human assistant — short answers
 *   - Can capture new items directly to gtd_inbox
 *   - Can mark actions done, postpone them, or create new ones
 *   - Surfaces the ONE most important thing when asked
 *
 * Called from:
 *   - POST /api/ea/chat  (dashboard chat UI)
 *   - Telegram webhook   (fallback handler for all non-command messages)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_KEY = process.env.OPENAI_API_KEY;

// ─── Context builder: pulls the minimal real-time snapshot ──────────────────
async function buildContext() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const in3Days = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];
  const in7Days = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const [
    { data: overdueActions },
    { data: todayActions },
    { data: soonActions },
    { data: inboxItems },
    { data: waitingItems },
    { data: activeVentures },
    { data: newCeoRecs },
  ] = await Promise.all([
    // Overdue actions
    supabase.from('gtd_actions')
      .select('title, context, due_date, venture_id, ventures(name)')
      .eq('status', 'active')
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(10),

    // Due today
    supabase.from('gtd_actions')
      .select('title, context, due_date, energy, ventures(name)')
      .eq('status', 'active')
      .eq('due_date', today)
      .limit(10),

    // Due in next 3 days (not today)
    supabase.from('gtd_actions')
      .select('title, context, due_date, energy, ventures(name)')
      .eq('status', 'active')
      .gt('due_date', today)
      .lte('due_date', in3Days)
      .order('due_date', { ascending: true })
      .limit(8),

    // Unprocessed inbox
    supabase.from('gtd_inbox')
      .select('id, raw_text, created_at')
      .eq('processed', false)
      .order('created_at', { ascending: false })
      .limit(5),

    // Waiting-for items
    supabase.from('gtd_actions')
      .select('title, delegated_to, due_date')
      .eq('status', 'waiting')
      .limit(5),

    // Active ventures (status + readiness)
    supabase.from('ventures')
      .select('name, status, readiness_score, risk_level, monthly_revenue_usd')
      .eq('status', 'active')
      .order('readiness_score', { ascending: false }),

    // Unacknowledged CEO recs (critical/high priority only)
    supabase.from('ceo_recommendations')
      .select('title, type, priority')
      .eq('status', 'new')
      .in('priority', ['critical', 'high'])
      .limit(3),
  ]);

  // Build a compact context string for the system prompt
  const lines = [];

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });
  lines.push(`TODAY: ${dateStr}`);

  // Overdue
  if (overdueActions?.length) {
    lines.push(`\nOVERDUE ACTIONS (${overdueActions.length}):`);
    overdueActions.forEach(a => {
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${venture} — was due ${a.due_date}`);
    });
  }

  // Today
  if (todayActions?.length) {
    lines.push(`\nDUE TODAY (${todayActions.length}):`);
    todayActions.forEach(a => {
      const ctx = a.context ? ` ${a.context}` : '';
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${ctx}${venture}`);
    });
  } else {
    lines.push(`\nDUE TODAY: nothing scheduled`);
  }

  // Coming soon
  if (soonActions?.length) {
    lines.push(`\nDUE IN 3 DAYS (${soonActions.length}):`);
    soonActions.forEach(a => {
      const venture = a.ventures?.name ? ` [${a.ventures.name}]` : '';
      lines.push(`  • ${a.title}${venture} — ${a.due_date}`);
    });
  }

  // Inbox
  const inboxCount = inboxItems?.length || 0;
  lines.push(`\nUNPROCESSED INBOX: ${inboxCount} items${inboxCount > 0 ? ' (GTD Filer will process next hour)' : ''}`);
  if (inboxCount > 0 && inboxItems) {
    inboxItems.slice(0, 3).forEach(i => {
      lines.push(`  • "${i.raw_text.substring(0, 60)}${i.raw_text.length > 60 ? '…' : ''}"`);
    });
  }

  // Waiting-for
  if (waitingItems?.length) {
    lines.push(`\nWAITING FOR (${waitingItems.length}):`);
    waitingItems.forEach(w => {
      const who = w.delegated_to ? ` → ${w.delegated_to}` : '';
      lines.push(`  • ${w.title}${who}`);
    });
  }

  // Active ventures summary
  if (activeVentures?.length) {
    lines.push(`\nACTIVE VENTURES:`);
    activeVentures.forEach(v => {
      const mrr = parseFloat(v.monthly_revenue_usd || 0);
      const mrrStr = mrr > 0 ? ` $${mrr}/mo` : '';
      lines.push(`  • ${v.name} — ${v.readiness_score}% ready, ${v.risk_level} risk${mrrStr}`);
    });
  }

  // CEO alerts
  if (newCeoRecs?.length) {
    lines.push(`\nUNACKNOWLEDGED CEO ALERTS (high priority):`);
    newCeoRecs.forEach(r => {
      lines.push(`  • [${r.priority}] ${r.title}`);
    });
  }

  return lines.join('\n');
}

// ─── System prompt ───────────────────────────────────────────────────────────
function buildSystemPrompt(context) {
  return `You are the Executive Assistant for Welday Enterprises — a sharp, efficient assistant who helps the owner (Welday) stay focused on what matters today and this week.

Your role sits BETWEEN strategic thinking (handled by the Virtual CEO) and task filing (handled by the GTD Filer). You operate at the TACTICAL level.

PERSONALITY:
- Concise. Short answers unless asked to elaborate.
- Proactive. Volunteer the most important thing unprompted when relevant.
- Practical. No motivation speeches. No unnecessary filler.
- Conversational. Talk like a smart human assistant, not a robot.
- When asked "what should I do now?" — give ONE clear answer, not a list.

CAPABILITIES:
- Tell Welday what's overdue, due today, coming up soon
- Remind about waiting-for items that may need a follow-up nudge
- Surface urgent CEO alerts when they exist
- Help prioritize: "of these 3 things, start with X because..."
- Accept new captures: "add [task] to my inbox" → confirm you'll note it (the system handles filing)
- Suggest batching: "you have 3 @phone tasks — good time to knock them out"
- Notice patterns: "you have 5 overdue items — want to do a quick review?"
- Acknowledge when things look clear: "you're clear for now — nothing due until Tuesday"

HARD RULES:
- You are NOT the CEO. Don't make strategic portfolio decisions or synergy recommendations.
- You are NOT the filer. Don't classify or route tasks yourself — just acknowledge captures.
- Never overwhelm with lists longer than 5 items unless explicitly asked.
- If inbox has 5+ unprocessed items, mention it once and suggest a /process.
- Keep responses under 150 words unless the user asks for more detail.

CURRENT STATE (as of right now):
${context}

Respond to the user's message below.`;
}

// ─── Main chat handler (called from Express route) ───────────────────────────
async function chat(messages, userMessage) {
  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(context);

  // Build message history (last 10 turns max to stay within context)
  const history = (messages || []).slice(-10).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Check if the user is capturing something to inbox
  const captureMatch = userMessage.match(/^(?:add|capture|inbox|remember|note|remind me[:\s]+)(.+)/i);
  if (captureMatch) {
    const captured = captureMatch[1].trim();
    try {
      await supabase.from('gtd_inbox').insert({
        source: 'web',
        raw_text: captured,
      });
    } catch {}
    // Still pass through to the LLM so it can confirm naturally
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || 'Something went wrong — try again.';
  const tokensUsed = data.usage?.total_tokens || 0;

  // Log the interaction
  await supabase.from('agent_logs').insert({
    agent_name: 'ea_agent',
    action: 'chat',
    input_summary: userMessage.substring(0, 100),
    output_summary: reply.substring(0, 100),
    tables_read: ['gtd_actions', 'gtd_inbox', 'ventures', 'ceo_recommendations'],
    model_used: 'gpt-4o-mini',
    tokens_used: tokensUsed,
    success: true,
  }).catch(() => {}); // non-blocking

  return reply;
}

// ─── Daily briefing (called on demand or at day start) ────────────────────────
async function dailyBriefing() {
  const context = await buildContext();
  const systemPrompt = buildSystemPrompt(context);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 400,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: 'Give me my morning briefing. What are the 3 most important things for today? Keep it under 120 words.',
        },
      ],
    }),
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Unable to generate briefing.';
}

module.exports = { chat, dailyBriefing, buildContext };
