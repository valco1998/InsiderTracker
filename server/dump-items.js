// dump-items.js
import fs from "node:fs";
import path from "node:path";

const OUT_FILE = process.env.OUT_FILE || "empire-items.json";

// ✅ אם אתה חסום מישראל (403), תעבוד דרך הפרוקסי שלך:
// לדוגמה: set EMPIRE_BASE_URL=http://localhost:5055
const BASE = (process.env.EMPIRE_BASE_URL || "https://csgoempire.com").replace(/\/$/, "");
const API_PREFIX = process.env.EMPIRE_API_PREFIX || "/api/v2";

// ✅ חשוב: ב-CSGOEmpire בדרך כלל ה-API key הוא ההזדהות.
// זה לא JWT. אל תנסה להשתמש ב-EMPIRE_TOKEN.
const KEY = (process.env.EMPIRE_API_KEY || "").trim();

// ⚠️ אם הפרוקסי שלך דורש Authorization פנימי (JWT שלך), תשים פה:
const LOCAL_AUTH = (process.env.LOCAL_AUTH || "").trim(); // לדוגמה: "Bearer eyJ..."

if (!BASE) {
  console.error("Missing EMPIRE_BASE_URL");
  process.exit(1);
}

if (!KEY && !BASE.includes("localhost")) {
  console.error("Missing EMPIRE_API_KEY in env (required when calling Empire directly)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function isHtml(ct, text) {
  if ((ct || "").includes("text/html")) return true;
  const t = (text || "").trim().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function buildUrl(endpoint, params) {
  const u = new URL(`${BASE}${API_PREFIX}${endpoint}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function headersForRequest() {
  const h = {
    accept: "application/json",
  };

  // אם זה Empire ישיר:
  if (!BASE.includes("localhost")) {
    h["x-api-key"] = KEY;
    h["Authorization"] = `Bearer ${KEY}`;
  }

  // אם זה הפרוקסי שלך – והוא דורש auth פנימי:
  if (LOCAL_AUTH) {
    h["authorization"] = LOCAL_AUTH;
  }

  return h;
}

async function fetchJson(url, attempt = 0) {
  const res = await fetch(url, { headers: headersForRequest() });

  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  // ✅ 429 rate limit
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") || "0");
    const waitMs =
      retryAfter > 0
        ? retryAfter * 1000
        : Math.min(120000, 5000 * Math.pow(2, attempt)); // 5s, 10s, 20s... עד 120s

    console.log(`[${now()}] 429 RATE LIMITED. Waiting ${Math.round(waitMs / 1000)}s...`);
    await sleep(waitMs);
    return fetchJson(url, attempt + 1);
  }

  // ✅ 403 blocked (Country/IP)
  if (res.status === 403 && isHtml(ct, text)) {
    throw new Error(
      `403 BLOCKED (HTML). You are probably blocked by country/IP. Use your proxy: set EMPIRE_BASE_URL=http://localhost:5055`
    );
  }

  // ✅ אם זה לא JSON (כמו mirror 404 html)
  if (!ct.includes("application/json")) {
    const first = (text || "").slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`Non-JSON response (${res.status}, ${ct}). First: ${first}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON (${res.status}). First chars: ${(text || "").slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return data;
}

function loadExisting() {
  try {
    if (!fs.existsSync(OUT_FILE)) return { all: [], seen: new Set() };
    const raw = fs.readFileSync(OUT_FILE, "utf8");
    const arr = JSON.parse(raw);
    const all = Array.isArray(arr) ? arr : [];
    const seen = new Set();
    for (const it of all) {
      const id = it?.id ?? it?.item_id ?? it?.itemId ?? it?.market_hash_name ?? it?.name;
      if (id != null) seen.add(String(id));
    }
    return { all, seen };
  } catch {
    return { all: [], seen: new Set() };
  }
}

function save(all) {
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2));
}

async function dumpAll() {
  // ⚠️ תתאים את ה-endpoint לפי מה שעובד אצלך באמת.
  // אצל Empire זה לרוב: /trading/items
  const endpoint = process.env.EMPIRE_ENDPOINT || "/trading/items";

  const perPage = Number(process.env.PER_PAGE || 50); // 50 יותר בטוח מ-100
  const maxPages = Number(process.env.MAX_PAGES || 2000); // הגנה
  const delayMs = Number(process.env.DELAY_MS || 1200); // בין בקשות (מומלץ 1000-2000)

  const { all, seen } = loadExisting();

  console.log("====================================");
  console.log("BASE:", BASE);
  console.log("API_PREFIX:", API_PREFIX);
  console.log("ENDPOINT:", endpoint);
  console.log("OUT_FILE:", OUT_FILE);
  console.log("Loaded existing:", all.length);
  console.log("perPage:", perPage, "delayMs:", delayMs, "maxPages:", maxPages);
  console.log("====================================");

  let page = 1;
  let stuckCount = 0;

  while (page <= maxPages) {
    const url = buildUrl(endpoint, { page, per_page: perPage });
    console.log(`[${now()}] GET page=${page}`);

    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      console.error(`[${now()}] Fetch error:`, e.message);

      // אם זה חסימה 403 – אין טעם להמשיך בלי פרוקסי
      if (String(e.message).includes("403 BLOCKED")) {
        break;
      }

      // בעיה זמנית: נחכה וננסה שוב אותו page
      await sleep(Math.max(delayMs, 2000));
      continue;
    }

    const items = data?.data || data?.items || [];
    if (!Array.isArray(items) || items.length === 0) {
      console.log(`[${now()}] No more items. Stop at page=${page}`);
      break;
    }

    let added = 0;
    for (const it of items) {
      const id =
        it?.id ??
        it?.item_id ??
        it?.itemId ??
        it?.market_hash_name ??
        it?.name ??
        JSON.stringify(it).slice(0, 80);

      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(it);
      added++;
    }

    console.log(
      `[${now()}] page=${page} got=${items.length} added=${added} total=${all.length}`
    );

    // שמירה כל עמוד כדי לא לאבד הכל
    save(all);

    // הגנה נגד “חוזר על עצמו”
    if (added === 0) {
      stuckCount++;
      if (stuckCount >= 3) {
        console.log(`[${now()}] Looks stuck (added=0 for 3 pages). Stop.`);
        break;
      }
    } else {
      stuckCount = 0;
    }

    page++;
    await sleep(delayMs);
  }

  console.log(`[${now()}] ✅ Saved ${all.length} items to ${OUT_FILE}`);
}

dumpAll().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
