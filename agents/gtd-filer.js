/**
 * WELDAY ENTERPRISES — GTD FILER AGENT
 * ----------------------------------------
 * Run: node gtd-filer.js
 * Schedule: Daily, or triggered by /process Telegram command
 * Model: Google Gemini (free tier)
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash';

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
    }),
  });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}

async function classifyItem(text) {
  const prompt = `Classify this GTD inbox item and tell me where to file it.

Inbox text: "${text}"

GTD destinations:
- action: A concrete next step (do in <2min, or schedule)
- project: Outcome requiring multiple steps
- someday: Idea to revisit later
- reference: Information to keep (not actionable)
- trash: Not worth keeping

Respond with JSON only:
{
  "destination": "action" | "project" | "someday" | "reference" | "trash",
  "title": "clean, concise title",
  "summary": "one sentence summary",
  "category": "work" | "personal" | "health" | "finance" | "learning" | "business",
  "venture_slug": "relevant-venture-slug or null",
  "context": "@computer" | "@phone" | "@errands" | "@waiting" | null,
  "energy": "high" | "medium" | "low",
  "confidence": 0.0-1.0
}`;

  const content = await callGemini(prompt);
  try {
    return JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  } catch {
    return { destination: 'reference', title: text.substring(0, 80), confidence: 0.5 };
  }
}

async function fileItem(inbox, classification) {
  const { data: ventures } = await supabase
    .from('ventures')
    .select('id, slug')
    .eq('slug', classification.venture_slug || '');

  const ventureId = ventures?.[0]?.id || null;

  if (classification.destination === 'action') {
    await supabase.from('gtd_actions').insert({
      title: classification.title,
      venture_id: ventureId,
      context: classification.context,
      energy: classification.energy || 'medium',
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    });
  } else if (classification.destination === 'project') {
    await supabase.from('gtd_projects').insert({
      title: classification.title,
      venture_id: ventureId,
      area: classification.category,
      notes: inbox.raw_text,
      tags: [classification.category].filter(Boolean),
    });
  } else if (classification.destination === 'someday') {
    await supabase.from('gtd_someday').insert({
      title: classification.title,
      description: inbox.raw_text,
      venture_id: ventureId,
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    });
  } else if (classification.destination === 'reference') {
    await supabase.from('gtd_reference').insert({
      title: classification.title,
      content: inbox.raw_text,
      venture_id: ventureId,
      category: 'idea',
      area: classification.category,
      tags: [classification.category].filter(Boolean),
    });
  }
  // 'trash' → just mark processed, don't create anything

  await supabase.from('gtd_inbox').update({
    processed: true,
    processed_at: new Date().toISOString(),
    filed_to: classification.destination,
    ai_summary: classification.summary,
    ai_category: classification.category,
    ai_confidence: classification.confidence,
  }).eq('id', inbox.id);
}

async function runFiler() {
  const startTime = Date.now();
  console.log('[GTD Filer] Starting…');

  const { data: items } = await supabase
    .from('gtd_inbox')
    .select('*')
    .eq('processed', false)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!items?.length) {
    console.log('[GTD Filer] Inbox is empty.');
    return;
  }

  console.log(`[GTD Filer] Processing ${items.length} items…`);
  let processed = 0;

  for (const item of items) {
    try {
      const classification = await classifyItem(item.raw_text);
      await fileItem(item, classification);
      console.log(`  ✓ "${item.raw_text.substring(0, 50)}" → ${classification.destination}`);
      processed++;
    } catch (err) {
      console.error(`  ✗ Error processing item ${item.id}:`, err.message);
    }
  }

  await supabase.from('agent_logs').insert({
    agent_name: 'gtd_filer',
    action: 'process_inbox',
    input_summary: `${items.length} inbox items`,
    output_summary: `Processed ${processed} items`,
    tables_read: ['gtd_inbox', 'ventures'],
    tables_written: ['gtd_actions', 'gtd_projects', 'gtd_someday', 'gtd_reference', 'gtd_inbox'],
    duration_ms: Date.now() - startTime,
    model_used: GEMINI_MODEL,
    success: true,
  });

  console.log(`[GTD Filer] Done. ${processed}/${items.length} items filed.`);
}

runFiler();
