// Ping Telegram when free slots appear on Limassol District Admin SimplyBook.
// Secrets: TG_TOKEN, TG_CHAT_ID. KV binding: STATE (keys: "dates", "last_run").
const BASE = "https://limassoldistrictadmin.simplybook.it/v2";
const SERVICE = 8, PROVIDER = 10, DAYS_AHEAD = 120;
const DAY = 864e5;
const NONE_EVERY = 2 * 3600e3 - 60e3; // ~2h; 1 min slack so cron jitter doesn't skip a cycle
const fmt = d => d.toISOString().slice(0, 10);
const link = d => `${BASE}/#book/service/${SERVICE}/count/1/provider/${PROVIDER}/date/${d}/`;

async function freeDates() {
  const found = new Set();
  // API rejects ranges longer than ~30 days ("Too long period")
  for (let start = 0; start < DAYS_AHEAD; start += 30) {
    const a = new Date(Date.now() + start * DAY), b = new Date(a.getTime() + 29 * DAY);
    const q = new URLSearchParams({ from: fmt(a), to: fmt(b), location: "", category: "",
                                    provider: PROVIDER, service: SERVICE, count: 1 });
    const r = await fetch(`${BASE}/booking/time-slots/?${q}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`simplybook HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const slots = await r.json();
    if (!Array.isArray(slots)) throw new Error(`simplybook: ${JSON.stringify(slots).slice(0, 200)}`);
    for (const s of slots) if (s.type === "free") found.add(s.date);
  }
  return [...found].sort();
}

async function send(env, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`telegram HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function run(env) {
  const at = new Date().toISOString();
  try {
    const now = await freeDates();
    const prev = new Set(JSON.parse((await env.STATE.get("dates")) || "[]"));
    const fresh = now.filter(d => !prev.has(d));
    if (fresh.length) await send(env, "Free slots:\n" + fresh.map(d => `${d}: ${link(d)}`).join("\n"));
    // Heartbeat: while nothing is free, say so at most every NONE_EVERY ms.
    if (now.length === 0) {
      const last = Number(await env.STATE.get("last_none")) || 0;
      if (Date.now() - last >= NONE_EVERY) {
        await send(env, `No free slots in the next ${DAYS_AHEAD} days.`);
        await env.STATE.put("last_none", String(Date.now()));
      }
    } else if (await env.STATE.get("last_none")) {
      await env.STATE.delete("last_none");
    }
    if (JSON.stringify(now) !== JSON.stringify([...prev].sort())) await env.STATE.put("dates", JSON.stringify(now));
    console.log("free:", now, "new:", fresh);
    await env.STATE.put("last_run", JSON.stringify({ at, ok: true, free: now, new: fresh }));
  } catch (e) {
    console.error(e);
    await env.STATE.put("last_run", JSON.stringify({ at, ok: false, error: String(e) }));
    throw e;
  }
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
};
