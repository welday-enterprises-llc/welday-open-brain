/**
 * WELDAY ENTERPRISES — VIRTUAL CEO AGENT
 * ----------------------------------------
 * Run: node ceo-agent.js
 * Schedule: Every hour via Vercel Cron or Perplexity Computer scheduled task
 * 
 * What it does:
 *   1. Fetches all 11 ventures from Supabase
 *   2. Fetches recent GTD inbox items and unprocessed actions
 *   3. Calls OpenAI GPT-4o (or Claude via Anthropic) with venture data
 *   4. Asks for synergy recommendations + risk alerts
 *   5. Writes recommendations to ceo_recommendations table
 *   6. Logs activity to agent_logs table
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function runCEO() {
  const startTime = Date.now();
  console.log('[CEO Agent] Starting analysis…');

  try {
    // 1. Fetch venture data
    const { data: ventures } = await supabase
      .from('ventures')
      .select('*')
      .order('readiness_score', { ascending: false });

    // 2. Fetch recent inbox items (last 24h)
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const { data: inbox } = await supabase
      .from('gtd_inbox')
      .select('raw_text, source, created_at')
      .gte('created_at', yesterday)
      .eq('processed', false)
      .limit(20);

    // 3. Build prompt
    const venturesSummary = ventures.map(v =>
      `- ${v.name} (${v.status}): readiness=${v.readiness_score}%, risk=${v.risk_level}, tags=[${(v.synergy_tags||[]).join(',')}], MRR=$${v.monthly_revenue_usd || 0}`
    ).join('\n');

    const inboxSummary = inbox?.length
      ? inbox.map(i => `• ${i.raw_text}`).join('\n')
      : '(no recent inbox items)';

    const systemPrompt = `You are the Virtual CEO of Welday Enterprises, a portfolio of 11 AI-powered micro-businesses.
Your job is to analyze the portfolio and find synergies, risks, and opportunities.
You think strategically, focus on revenue and minimal-effort automation, and always look for ways 2+ businesses can work together.
Output JSON only — no markdown, no explanation outside the JSON.`;

    const userPrompt = `VENTURE PORTFOLIO:
${venturesSummary}

RECENT CAPTURES (24h):
${inboxSummary}

Analyze this portfolio and return a JSON array of 3-5 recommendations with this schema:
[{
  "type": "synergy" | "risk" | "opportunity" | "action",
  "title": "short title (max 10 words)",
  "body": "detailed explanation (2-3 sentences)",
  "ventures_involved": ["venture-slug-1", "venture-slug-2"],
  "priority": "critical" | "high" | "medium" | "low",
  "effort_level": "minimal" | "low" | "medium" | "high",
  "estimated_revenue_impact": "e.g. $500/mo or 20% traffic lift",
  "action_items": ["concrete step 1", "concrete step 2", "concrete step 3"]
}]

Focus on SYNERGIES first — how can 2+ ventures share content, users, or infrastructure?`;

    // 4. Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content;
    let recommendations = [];

    try {
      // Clean possible markdown code fences
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      recommendations = JSON.parse(cleaned);
    } catch (e) {
      console.error('[CEO Agent] JSON parse error:', e.message);
      console.error('Raw response:', content);
    }

    // 5. Write recommendations
    if (recommendations.length > 0) {
      // Map slug arrays to UUID arrays
      const slugToId = Object.fromEntries(ventures.map(v => [v.slug, v.id]));
      
      const rows = recommendations.map(r => ({
        type: r.type,
        title: r.title,
        body: r.body,
        ventures_involved: (r.ventures_involved || []).map(slug => slugToId[slug]).filter(Boolean),
        priority: r.priority || 'medium',
        effort_level: r.effort_level || 'medium',
        estimated_revenue_impact: r.estimated_revenue_impact,
        action_items: r.action_items || [],
        ai_model_used: 'gpt-4o-mini',
        status: 'new',
      }));

      const { error } = await supabase.from('ceo_recommendations').insert(rows);
      if (error) console.error('[CEO Agent] Insert error:', error);
      else console.log(`[CEO Agent] Inserted ${rows.length} recommendations`);
    }

    // 6. Log activity
    await supabase.from('agent_logs').insert({
      agent_name: 'ceo_agent',
      action: 'analyze_portfolio',
      input_summary: `${ventures.length} ventures, ${inbox?.length || 0} inbox items`,
      output_summary: `Generated ${recommendations.length} recommendations`,
      tables_read: ['ventures', 'gtd_inbox'],
      tables_written: ['ceo_recommendations', 'agent_logs'],
      duration_ms: Date.now() - startTime,
      tokens_used: completion.usage?.total_tokens,
      model_used: 'gpt-4o-mini',
      success: true,
    });

  } catch (err) {
    console.error('[CEO Agent] Error:', err);
    await supabase.from('agent_logs').insert({
      agent_name: 'ceo_agent',
      action: 'analyze_portfolio',
      success: false,
      error_message: err.message,
      duration_ms: Date.now() - startTime,
    });
  }
}

runCEO();
