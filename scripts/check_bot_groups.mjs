// Reads .env.local (no printing of secrets), verifies the bot via getMe,
// lists groups from Supabase, then checks the bot's member status in each.
import fs from "node:fs";

function loadEnv(path) {
  const env = {};
  if (!fs.existsSync(path)) return env;
  for (const line of fs.readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = { ...loadEnv(".env"), ...loadEnv(".env.local") };
const token = env.TELEGRAM_BOT_TOKEN;
const sbUrl = env.SUPABASE_URL;
const sbKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!token || !sbUrl || !sbKey) {
  console.error("missing env: need TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const tg = async (method, params = {}) => {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  const json = await res.json().catch(() => ({}));
  return { ok: json.ok, result: json.result, error: json.description, code: json.error_code };
};

// 1) Bot identity
const me = await tg("getMe");
if (!me.ok) { console.error("getMe failed:", me.error); process.exit(1); }
const bot = me.result;
console.log(`BOT: @${bot.username} (id ${bot.id})`);

// 2) Groups from Supabase
const gres = await fetch(`${sbUrl}/rest/v1/groups?select=id,level,rotation,label,chat_id&order=level.desc`, {
  headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
});
const groups = await gres.json().catch(() => []);
console.log(`GROUPS IN DB: ${groups.length}`);
if (!Array.isArray(groups)) { console.error("supabase error:", groups); process.exit(1); }

// 3) Membership/admin status per group
const results = [];
for (const g of groups) {
  const chatId = g.chat_id;
  // First confirm the chat exists & is accessible
  const chat = await tg("getChat", { chat_id: chatId });
  let title = "?";
  if (chat.ok && chat.result) title = chat.result.title || chat.result.username || chatId;
  else console.log(`  !! cannot access chat ${chatId}: ${chat.error}`);
  let status = "left/unreachable";
  if (chat.ok) {
    const member = await tg("getChatMember", { chat_id: chatId, user_id: bot.id });
    if (member.ok) status = member.result.status;
    else status = `error: ${member.error}`;
  }
  const admin = status === "administrator" || status === "creator" ? "ADMIN" : status === "member" ? "member" : "NOT ADMIN";
  results.push({ ...g, title, status, admin });
  console.log(`  [${admin}] ${g.level}/${g.rotation} "${title}" (${chatId}) -> ${status}`);
}

const adminCount = results.filter((r) => r.admin === "ADMIN").length;
const inChat = results.filter((r) => !["left/unreachable", "error", "kicked", "restricted"].includes(r.status) && !r.status.startsWith("error")).length;
console.log(`\nSUMMARY: ${groups.length} groups in DB, bot is IN ${inChat}, ADMIN of ${adminCount}.`);

// 4) Student census by level/rotation
const h = { apikey: sbKey, Authorization: `Bearer ${sbKey}` };
const sres = await fetch(`${sbUrl}/rest/v1/students?select=level,rotation,joined,nom,prenom&limit=100000`, { headers: h });
const studentsArr = await sres.json().catch(() => []);
if (!Array.isArray(studentsArr)) { console.error("students fetch error:", studentsArr); process.exit(1); }
const by = {};
for (const r of studentsArr) {
  const k = `${r.level ?? "?"}/${r.rotation ?? "?"}`;
  by[k] = (by[k] || 0) + 1;
}
console.log(`STUDENTS TOTAL: ${studentsArr.length}, JOINED: ${studentsArr.filter((s) => s.joined).length}`);
console.log("BY LEVEL/ROTATION:", JSON.stringify(by));