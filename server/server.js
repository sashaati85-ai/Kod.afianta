const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { LEGAL_VERSION, DOCUMENTS, renderLegalDocument } = require("./legal-documents");

const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, "site");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const PAID_AI_MODEL = process.env.PAID_AI_MODEL || process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const AI_API_BASE_URL = (process.env.AI_API_BASE_URL || "https://polza.ai/api/v1").replace(/\/$/, "");
const PAID_REPORT_STORE = process.env.PAID_REPORT_STORE || path.join(__dirname, "paid-reports.json");
const PAYMENT_STORE = process.env.PAYMENT_STORE || path.join(__dirname, "payments.json");
const CONSENT_STORE = process.env.CONSENT_STORE || path.join(__dirname, "consents.jsonl");
const SETTINGS_STORE = process.env.SETTINGS_STORE || path.join(path.dirname(CONSENT_STORE), "site-settings.json");
const PRODUCT_PRICE_RUB = Number(process.env.PRODUCT_PRICE_RUB || 490);
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "";
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "";
const YOOKASSA_API_URL = (process.env.YOOKASSA_API_URL || "https://api.yookassa.ru/v3").replace(/\/$/, "");
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://kod.afianta.ru").replace(/\/$/, "");
const CONTACT_TELEGRAM_URL = process.env.CONTACT_TELEGRAM_URL || "https://t.me/afianta";
const CONTACT_VK_URL = process.env.CONTACT_VK_URL || "https://vk.com/afianta";
const ADMIN_BASIC_AUTH = process.env.ADMIN_BASIC_AUTH || "";
const DEBUG_AI_REPORT = process.env.DEBUG_AI_REPORT === "1";
const REPORT_RETENTION_DAYS = Math.max(30, Number(process.env.REPORT_RETENTION_DAYS || 180));
const CONSENT_RETENTION_DAYS = Math.max(365, Number(process.env.CONSENT_RETENTION_DAYS || 1095));
const reportCache = new Map();
const paidReportCache = new Map();
const paymentCache = new Map();
const consentCache = new Map();
const paidReportInFlight = new Map();
const rateLimitCache = new Map();
let siteSettings = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const REQUIRED_AI_KEYS = [
  "introText",
  "annaMeaningText",
  "annaRecommendation",
  "alexanderIntroText",
  "alexanderScenarioText",
  "alexanderRiskText",
  "alexanderInnerFeelingText",
  "alexanderRecommendation",
  "nextStepText",
  "paidReportTeaserItems",
];

const FALLBACK_TEASER_ITEMS = [
  "Где именно вы теряете внутреннюю опору",
  "Какие реакции незаметно усиливают напряжение",
  "Какой сценарий начал закрепляться между вами",
  "Что сейчас лучше не делать, чтобы не ухудшить контакт",
  "Какой следующий шаг поможет вернуть больше ясности",
];

const DEFAULT_SITE_SETTINGS = {
  contactLinks: {
    telegram: CONTACT_TELEGRAM_URL,
    vk: CONTACT_VK_URL,
  },
  legalDocuments: {},
};

const THREE_TO_SIX_DISTANCE_PHRASE = "Тема отдаления уже перестала выглядеть как случайный эпизод и начала влиять на ваше внутреннее состояние";

const PAID_CONTEXT_LABELS = {
  relationshipStatus: {
    in_relationship: "В отношениях",
    together: "В отношениях",
    on_the_edge: "На грани расставания",
    after_breakup: "После расставания",
    unclear: "Сложная неопределённость",
    no_contact: "Почти нет контакта",
  },
  mainProblem: {
    distance: "Отдаление",
    conflicts: "Повторяющиеся конфликты",
    uncertainty: "Неясность",
    jealousy: "Ревность и недоверие",
    repeating_pattern: "Повторяющийся сценарий",
    fear_of_loss: "Страх потерять контакт",
  },
  duration: {
    less_than_month: "Меньше месяца",
    one_to_three_months: "1–3 месяца",
    three_to_six_months: "3–6 месяцев",
    more_than_six_months: "Больше 6 месяцев",
    years: "Больше года",
  },
  goal: {
    restore_dialogue: "Восстановить диалог",
    prepare_conversation: "Подготовиться к разговору",
    understand_partner: "Понять, что происходит",
    reduce_tension: "Снизить напряжение",
    make_decision: "Принять решение",
    return_contact: "Вернуть контакт",
  },
};

function labelContextValue(group, key) {
  const source = PAID_CONTEXT_LABELS[group] || {};
  return source[key] || clampText(key, 120);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...securityHeaders(),
  });
  res.end(body);
}

function sendPaidFlowDisabled(res) {
  sendJson(res, 410, {
    error: "Paid flow is disabled",
    nextStep: "free_diagnosis",
    redirectTo: "/lead",
  });
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = (await readBody(req)).replace(/^\uFEFF/, "");
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function clampText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeUrl(value, fallback) {
  const url = clampText(value, 500);
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    return parsed.toString();
  } catch (_) {
    return fallback;
  }
}

function normalizeLegalDocuments(value) {
  if (!value || typeof value !== "object") return {};
  return Object.keys(DOCUMENTS).reduce((result, pathname) => {
    const document = value[pathname];
    if (!document || typeof document !== "object") return result;
    const title = clampText(document.title, 180);
    const lead = clampText(document.lead, 1200);
    const content = clampText(document.content, 80000);
    if (title || lead || content) {
      result[pathname] = { title, lead, content };
    }
    return result;
  }, {});
}

function normalizeSiteSettings(value = {}) {
  const contactLinks = value.contactLinks && typeof value.contactLinks === "object"
    ? value.contactLinks
    : {};
  return {
    contactLinks: {
      telegram: normalizeUrl(contactLinks.telegram, DEFAULT_SITE_SETTINGS.contactLinks.telegram),
      vk: normalizeUrl(contactLinks.vk, DEFAULT_SITE_SETTINGS.contactLinks.vk),
    },
    legalDocuments: normalizeLegalDocuments(value.legalDocuments),
    updatedAt: clampText(value.updatedAt, 80) || "",
  };
}

function getSiteSettings() {
  if (!siteSettings) siteSettings = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
  return siteSettings;
}

function loadSiteSettings() {
  try {
    if (!fs.existsSync(SETTINGS_STORE)) {
      siteSettings = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_STORE, "utf8"));
    siteSettings = normalizeSiteSettings(parsed);
  } catch (error) {
    console.warn("[settings] failed to load settings", error.message);
    siteSettings = normalizeSiteSettings(DEFAULT_SITE_SETTINGS);
  }
}

function saveSiteSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_STORE), { recursive: true });
  fs.writeFileSync(SETTINGS_STORE, JSON.stringify(getSiteSettings(), null, 2), "utf8");
}

function adminSettingsPayload() {
  const settings = getSiteSettings();
  const legalDocuments = Object.keys(DOCUMENTS).reduce((result, pathname) => {
    const base = DOCUMENTS[pathname](PRODUCT_PRICE_RUB);
    result[pathname] = {
      title: base.title || "",
      lead: base.lead || "",
      content: base.content || "",
      ...(settings.legalDocuments[pathname] || {}),
    };
    return result;
  }, {});
  return {
    settings: {
      contactLinks: settings.contactLinks,
      legalDocuments,
      updatedAt: settings.updatedAt || "",
    },
    documentPaths: Object.keys(DOCUMENTS),
  };
}

function normalizeAiReport(input) {
  if (!input || typeof input !== "object") return null;
  const teaserItems = Array.isArray(input.paidReportTeaserItems)
    ? input.paidReportTeaserItems.map((item) => clampText(item, 140)).filter((item) => item.length >= 8)
    : [];
  while (teaserItems.length < 5) {
    teaserItems.push(FALLBACK_TEASER_ITEMS[teaserItems.length]);
  }

  const report = {
    introText: clampText(input.introText, 650),
    annaMeaningText: clampText(input.annaMeaningText, 750),
    annaRecommendation: clampText(input.annaRecommendation, 300),
    alexanderIntroText: clampText(input.alexanderIntroText, 500),
    alexanderScenarioText: clampText(input.alexanderScenarioText, 750),
    alexanderRiskText: clampText(input.alexanderRiskText, 650),
    alexanderInnerFeelingText: clampText(input.alexanderInnerFeelingText, 450),
    alexanderRecommendation: clampText(input.alexanderRecommendation, 400),
    nextStepText: clampText(input.nextStepText, 650),
    paidReportTeaserItems: teaserItems.slice(0, 5),
  };

  if (REQUIRED_AI_KEYS.some((key) => {
    if (key === "paidReportTeaserItems") return false;
    return report[key].length < 8;
  })) {
    return null;
  }

  return report;
}

function safeJsonParse(content) {
  if (typeof content !== "string") return null;
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function stableHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || "").toLowerCase(), "utf8");
  const rightBuffer = Buffer.from(String(right || "").toLowerCase(), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function timingSafeEqualExact(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestIp(req) {
  const forwarded = clampText(req.headers["x-forwarded-for"], 300);
  if (forwarded) {
    const chain = forwarded.split(",").map((item) => item.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return clampText(req.socket && req.socket.remoteAddress, 120);
}

function allowRequest(req, bucket, limit, windowMs = 60000) {
  const now = Date.now();
  const key = `${bucket}:${requestIp(req) || "unknown"}`;
  const current = rateLimitCache.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitCache.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function requireRateLimit(req, res, bucket, limit) {
  if (allowRequest(req, bucket, limit)) return true;
  sendJson(res, 429, { error: "Too many requests" });
  return false;
}

function isOlderThan(value, days) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp > days * 86400000;
}

function loadConsentStore() {
  try {
    if (!fs.existsSync(CONSENT_STORE)) return;
    const lines = fs.readFileSync(CONSENT_STORE, "utf8").split(/\r?\n/).filter(Boolean);
    const retained = [];
    for (const line of lines) {
      const record = JSON.parse(line);
      if (!record || !record.consentId || isOlderThan(record.receivedAt, CONSENT_RETENTION_DAYS)) continue;
      consentCache.set(record.consentId, record);
      retained.push(JSON.stringify(record));
    }
    if (retained.length !== lines.length) {
      fs.writeFileSync(CONSENT_STORE, retained.length ? `${retained.join("\n")}\n` : "", {
        encoding: "utf8",
        mode: 0o600,
      });
    }
  } catch (error) {
    console.error("[consent-store] load failed", error.message);
  }
}

function appendConsentRecord(record) {
  fs.mkdirSync(path.dirname(CONSENT_STORE), { recursive: true });
  fs.appendFileSync(CONSENT_STORE, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(CONSENT_STORE, 0o600);
  } catch (_) {}
  consentCache.set(record.consentId, record);
}

function consentAccepts(consentId, type) {
  const record = consentCache.get(consentId);
  return Boolean(
    record &&
    Array.isArray(record.documents) &&
    record.documents.some((document) => document.type === type && document.accepted === true)
  );
}

async function handleConsent(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const body = await readJson(req);
  const consentId = clampText(body.consentId, 120);
  const formId = clampText(body.formId, 80);
  const page = clampText(body.page, 160);
  const occurredAt = clampText(body.occurredAt, 80);
  const version = clampText(body.version, 40);
  const allowedTypes = new Set(["personal_data", "marketing", "offer", "cookies"]);
  const documents = Array.isArray(body.documents)
    ? body.documents.slice(0, 6).map((document) => ({
        type: clampText(document && document.type, 40),
        version: clampText(document && document.version, 40),
        accepted: Boolean(document && document.accepted),
        textId: clampText(document && document.textId, 80),
      })).filter((document) => allowedTypes.has(document.type))
    : [];

  if (
    !consentId ||
    !formId ||
    !page ||
    version !== LEGAL_VERSION ||
    !documents.length ||
    documents.some((document) => document.version !== LEGAL_VERSION)
  ) {
    sendJson(res, 400, { error: "Invalid consent record" });
    return;
  }

  if (!consentCache.has(consentId)) {
    appendConsentRecord({
      consentId,
      occurredAt: Date.parse(occurredAt) ? occurredAt : new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      version,
      page,
      formId,
      documents,
      ip: requestIp(req),
      userAgent: clampText(req.headers["user-agent"], 500),
    });
  }
  sendJson(res, 201, { recorded: true, consentId, version: LEGAL_VERSION });
}

function handleAdminSession(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!ADMIN_BASIC_AUTH || !timingSafeEqualExact(req.headers.authorization, ADMIN_BASIC_AUTH)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  sendJson(res, 200, { authenticated: true });
}

function requireAdmin(req, res) {
  if (!ADMIN_BASIC_AUTH) {
    sendJson(res, 503, { error: "Admin auth is not configured" });
    return false;
  }
  if (!timingSafeEqualExact(req.headers.authorization, ADMIN_BASIC_AUTH)) {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="KOD Admin", charset="UTF-8"',
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...securityHeaders(),
    });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
  }
  return true;
}

async function handleAdminSettings(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method === "GET") {
    sendJson(res, 200, adminSettingsPayload());
    return;
  }
  if (req.method === "POST") {
    const body = await readJson(req);
    siteSettings = normalizeSiteSettings({
      contactLinks: body.contactLinks,
      legalDocuments: body.legalDocuments,
      updatedAt: new Date().toISOString(),
    });
    saveSiteSettings();
    sendJson(res, 200, { saved: true, ...adminSettingsPayload() });
    return;
  }
  sendJson(res, 405, { error: "Method not allowed" });
}

async function yookassaRequest(pathname, options = {}) {
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    throw new Error("YooKassa is not configured");
  }
  const headers = {
    "Authorization": `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64")}`,
    "Accept": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(`${YOOKASSA_API_URL}${pathname}`, { ...options, headers });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const description = payload && (payload.description || payload.code)
      ? `${payload.code || "error"}: ${payload.description || ""}`
      : responseText;
    throw new Error(`YooKassa API failed (${response.status}): ${description}`);
  }
  return payload;
}

function applyYookassaPayment(payment, providerPayment) {
  if (!payment || !providerPayment) return;
  payment.provider = "yookassa";
  payment.providerPaymentId = clampText(providerPayment.id, 120);
  payment.paymentId = payment.providerPaymentId || payment.paymentId;
  payment.status = providerPayment.status === "succeeded"
    ? "paid"
    : clampText(providerPayment.status, 40) || "pending";
  payment.updatedAt = new Date().toISOString();
  if (payment.status === "paid") payment.paidAt = payment.updatedAt;
}

function loadPaidReportStore() {
  try {
    if (!fs.existsSync(PAID_REPORT_STORE)) return;
    const parsed = JSON.parse(fs.readFileSync(PAID_REPORT_STORE, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    let changed = false;
    Object.entries(parsed).forEach(([key, value]) => {
      if (key && value && typeof value === "object" && !isOlderThan(value.createdAt, REPORT_RETENTION_DAYS)) {
        paidReportCache.set(key, value);
      } else {
        changed = true;
      }
    });
    if (changed) savePaidReportStore();
  } catch (error) {
    console.error("[paid-report-store] load failed", error.message);
  }
}

function savePaidReportStore() {
  try {
    fs.mkdirSync(path.dirname(PAID_REPORT_STORE), { recursive: true });
    const data = Object.fromEntries(paidReportCache.entries());
    fs.writeFileSync(PAID_REPORT_STORE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("[paid-report-store] save failed", error.message);
  }
}

function loadPaymentStore() {
  try {
    if (!fs.existsSync(PAYMENT_STORE)) return;
    const parsed = JSON.parse(fs.readFileSync(PAYMENT_STORE, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    let changed = false;
    Object.entries(parsed).forEach(([key, value]) => {
      if (!key || !value || typeof value !== "object") return;
      const contextDate = value.contextAttachedAt || value.createdAt;
      if (isOlderThan(contextDate, REPORT_RETENTION_DAYS)) {
        delete value.answers;
        delete value.result;
        delete value.contextHash;
        delete value.accessToken;
        value.contextDeletedAt = value.contextDeletedAt || new Date().toISOString();
        changed = true;
      }
      paymentCache.set(key, value);
    });
    if (changed) savePaymentStore();
  } catch (error) {
    console.error("[payment-store] load failed", error.message);
  }
}

function savePaymentStore() {
  try {
    fs.mkdirSync(path.dirname(PAYMENT_STORE), { recursive: true });
    fs.writeFileSync(PAYMENT_STORE, JSON.stringify(Object.fromEntries(paymentCache.entries()), null, 2), "utf8");
  } catch (error) {
    console.error("[payment-store] save failed", error.message);
  }
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.max(1, Math.min(5, Math.round(number)));
}

function deriveMainScenario(answers, scores) {
  if (
    answers.mainProblem === "distance" &&
    scores.distanceHard >= 4 &&
    scores.emotionalTiredness >= 4 &&
    scores.needClarity >= 4
  ) {
    return "Тревога + эмоциональные качели + потребность в ясности";
  }

  const parts = [];
  if (answers.mainProblem === "distance" || scores.distanceHard >= 4) parts.push("тревога из-за отдаления");
  if (scores.emotionalTiredness >= 4) parts.push("эмоциональные качели");
  if (scores.needClarity >= 4) parts.push("потребность в ясности");
  if (scores.control >= 4) parts.push("попытка вернуть контроль");
  if (scores.silence >= 4) parts.push("молчание и накопление напряжения");
  if (scores.repeatingScenario >= 4) parts.push("повторяющийся способ реагировать");

  if (parts.length >= 2) {
    return parts.slice(0, 3).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" + ");
  }

  return "Поиск ясности без усиления давления";
}

function replaceHeavyReportLanguage(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/динамика взаимодействия/gi, "то, что сейчас происходит между вами")
    .replace(/динамика ваших отношений/gi, "то, что сейчас происходит между вами")
    .replace(/эмоциональная автономность/gi, "умение не зависеть полностью от реакции партнёра")
    .replace(/деструктивный паттерн/gi, "повторяющийся способ реагировать, который ухудшает ситуацию")
    .replace(/сценарная конструкция/gi, "повторяющийся сценарий")
    .replace(/механизмы компенсации/gi, "способы справиться с напряжением")
    .replace(/процесс стабилизации контакта/gi, "попытка сделать общение спокойнее")
    .replace(/стабилизация контакта/gi, "сделать общение спокойнее")
    .replace(/переработка чувств/gi, "время, чтобы разобраться в своих чувствах")
    .replace(/трансформация внутреннего состояния/gi, "постепенное изменение вашего состояния")
    .replace(/структурировать текущую ситуацию/gi, "разложить ситуацию по понятным частям")
    .replace(/Ваша устойчивость делает вас более привлекательным партнёром/gi, "Ваша устойчивость помогает входить в разговор не из тревоги, а из более взрослой позиции")
    .replace(/Сократите количество сообщений и звонков до минимума/gi, "Не увеличивайте количество сообщений из тревоги. Оставьте только те контакты, которые действительно помогают прояснению, а не просто снимают напряжение на минуту")
    .replace(/Партн[её]ру нужно пространство, чтобы почувствовать безопасность/gi, "В такой ситуации партнёр может нуждаться в большем пространстве, и давление может усиливать защитную реакцию")
    .replace(/Партн[её]ру нужно/gi, "Партнёру может быть важно")
    .replace(/партн[её]р точно/gi, "партнёр может")
    .replace(/партн[её]р хочет/gi, "партнёр может хотеть")
    .replace(/партн[её]р чувствует/gi, "партнёр может чувствовать");
}

function sanitizePaidReport(value) {
  if (typeof value === "string") return replaceHeavyReportLanguage(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePaidReport(item));
  if (!value || typeof value !== "object") return value;
  Object.keys(value).forEach((key) => {
    value[key] = sanitizePaidReport(value[key]);
  });
  return value;
}

function enforcePaidContextRules(report, context) {
  if (!report || !context) return report;
  sanitizePaidReport(report);

  if (context.mainScenario && report.alexanderBlock && report.alexanderBlock.cycleExplanation) {
    const current = report.alexanderBlock.cycleExplanation;
    if (!current.toLowerCase().includes(context.mainScenario.toLowerCase())) {
      report.alexanderBlock.cycleExplanation = `Главный сценарий сейчас: ${context.mainScenario}. ${current}`;
    }
  }

  if (context.rules && context.rules.threeToSixDistancePhrase) {
    const intro = report.intro && report.intro.text ? report.intro.text : "";
    if (/давно/i.test(intro)) {
      report.intro.text = intro.replace(/[^.!?]*давно[^.!?]*[.!?]?/i, `${THREE_TO_SIX_DISTANCE_PHRASE}.`);
    } else if (intro && !intro.includes(THREE_TO_SIX_DISTANCE_PHRASE)) {
      report.intro.text = `${THREE_TO_SIX_DISTANCE_PHRASE}. ${intro}`;
    }
  }

  if (report.finalMemo) {
    report.finalMemo.whenToBookDiagnosis = "Если вы хотите разобрать живую ситуацию глубже, можно прийти на диагностику.";
  }

  return report;
}

function readPaymentAccess(value) {
  if (!value || typeof value !== "object") return null;
  const status = typeof value.status === "string" ? value.status : "";
  if (status !== "paid") return null;
  return {
    status,
    paymentId: clampText(value.paymentId, 120),
    orderId: clampText(value.orderId, 120),
    paidAt: clampText(value.paidAt, 80),
    instant: Boolean(value.instant),
  };
}

function buildPaidContext(body) {
  const answers = body && body.answers && typeof body.answers === "object" ? body.answers : {};
  const result = body && body.result && typeof body.result === "object" ? body.result : {};
  const anna = result.anna && typeof result.anna === "object" ? result.anna : {};
  const alexander = result.alexander && typeof result.alexander === "object" ? result.alexander : {};
  const scores = {
    distanceHard: normalizeScore(answers.scaleAnxiety),
    control: normalizeScore(answers.scaleControl),
    silence: normalizeScore(answers.scaleSilence),
    emotionalTiredness: normalizeScore(answers.scaleFatigue),
    needClarity: normalizeScore(answers.scaleWaiting),
    repeatingScenario: normalizeScore(answers.scaleRepetition),
  };
  const mainScenario = deriveMainScenario(answers, scores);
  const isThreeToSixMonths = answers.problemDuration === "three_to_six_months";

  return {
    name: clampText(answers.name, 80),
    birthDate: clampText(answers.birthDate, 40),
    relationshipStatus: clampText(answers.relationshipStatus, 80),
    relationshipStatusLabel: labelContextValue("relationshipStatus", answers.relationshipStatus),
    mainProblem: clampText(answers.mainProblem, 80),
    mainProblemLabel: labelContextValue("mainProblem", answers.mainProblem),
    problemDuration: clampText(answers.problemDuration, 80),
    problemDurationLabel: labelContextValue("duration", answers.problemDuration),
    goal: clampText(answers.goal, 80),
    goalLabel: labelContextValue("goal", answers.goal),
    contextNote: clampText(answers.contextNote, 600),
    lifePathNumber: Number(anna.lifePathNumber) || 0,
    lifePathTitle: clampText(anna.title, 140),
    lifePathShortDescription: clampText(anna.shortDescription, 500),
    lifePathManifestation: clampText(anna.relationshipManifestation, 500),
    lifePathRecommendation: clampText(anna.recommendation, 350),
    cycleKey: clampText(alexander.scenarioKey, 100),
    cycleTitle: clampText(alexander.title, 160),
    cycleDynamics: clampText(alexander.relationshipDynamics, 700),
    cycleMistake: clampText(alexander.amplifyingMistake, 500),
    cycleRecommendation: clampText(alexander.recommendation, 500),
    stateReflection: clampText(alexander.stateReflection, 500),
    innerFeeling: clampText(alexander.innerFeeling, 500),
    awareness: clampText(alexander.awareness, 500),
    diagnosticBridge: clampText(alexander.diagnosticBridge, 500),
    mainScenario,
    scores,
    rules: {
      doNotEmphasizeRepeatingScenario: scores.repeatingScenario <= 2,
      doNotSayLongTime: answers.problemDuration === "less_than_month" || answers.problemDuration === "one_to_three_months" || isThreeToSixMonths,
      threeToSixDistancePhrase: isThreeToSixMonths,
      doNotSayEmotionalExhaustion: scores.emotionalTiredness <= 2,
      doNotMakeSilenceCentral: scores.silence <= 2,
      doNotMakeClaimsAboutPartner: true,
    },
  };
}

function validateContext(context) {
  if (!context || typeof context !== "object") return null;
  const scores = context.scores && typeof context.scores === "object" ? context.scores : {};
  return {
    name: clampText(context.name, 80),
    birthDate: clampText(context.birthDate, 40),
    lifePathNumber: Number(context.lifePathNumber) || 0,
    lifePathArchetype: clampText(context.lifePathArchetype, 80),
    lifePathMeaning: clampText(context.lifePathMeaning, 180),
    currentSituation: clampText(context.currentSituation, 120),
    mainRequest: clampText(context.mainRequest, 120),
    duration: clampText(context.duration, 80),
    mainGoal: clampText(context.mainGoal, 120),
    detectedCycle: clampText(context.detectedCycle, 160),
    contextNote: clampText(context.contextNote, 500),
    scores: {
      distanceHard: Number(scores.distanceHard) || 3,
      control: Number(scores.control) || 3,
      silence: Number(scores.silence) || 3,
      emotionalTiredness: Number(scores.emotionalTiredness) || 3,
      needClarity: Number(scores.needClarity) || 3,
      repeatingScenario: Number(scores.repeatingScenario) || 3,
    },
    rules: {
      doNotEmphasizeRepeatingScenario: Boolean(context.rules && context.rules.doNotEmphasizeRepeatingScenario),
      doNotSayLongTime: Boolean(context.rules && context.rules.doNotSayLongTime),
      threeToSixDistancePhrase: Boolean(context.rules && context.rules.threeToSixDistancePhrase),
      doNotSayEmotionalExhaustion: Boolean(context.rules && context.rules.doNotSayEmotionalExhaustion),
      doNotMakeClaimsAboutPartner: true,
    },
  };
}

function contextScore(context, key) {
  const value = context && context.scores ? Number(context.scores[key]) : 3;
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function freeReportRequestPhrase(context) {
  const request = (context.mainRequest || "").toLowerCase();
  if (request.includes("отдал") || request.includes("холод")) return "отдаления и потери тепла";
  if (request.includes("конфликт")) return "повторяющихся конфликтов";
  if (request.includes("неяс") || request.includes("подвеш")) return "неясности и подвешенности";
  if (request.includes("ревн") || request.includes("недовер")) return "ревности и недоверия";
  if (request.includes("повтор") || request.includes("сценар")) return "повторяющегося сценария";
  if (request.includes("потер")) return "страха потерять контакт";
  return "вашей ситуации";
}

function freeReportCycleTitle(context) {
  if (contextScore(context, "needClarity") >= 4 && contextScore(context, "distanceHard") >= 4) {
    return "ТРЕВОГА + ПОТРЕБНОСТЬ В ЯСНОСТИ";
  }
  if (contextScore(context, "needClarity") >= 4) return "ЦИКЛ ТРЕВОГИ И ПОТРЕБНОСТИ В ЯСНОСТИ";
  if (contextScore(context, "distanceHard") >= 4) return "ЦИКЛ ТРЕВОГИ НА ФОНЕ ДИСТАНЦИИ";
  if (contextScore(context, "control") >= 4) return "ЦИКЛ ТРЕВОГИ И ПОПЫТКИ ВЕРНУТЬ КОНТРОЛЬ";
  return context.detectedCycle || "ТЕКУЩИЙ МЕХАНИЗМ НАПРЯЖЕНИЯ";
}

function freeReportControlNote(context) {
  if (contextScore(context, "control") < 4) return "";
  return " На этом фоне может появляться желание быстрее вернуть управляемость, но именно срочность иногда делает разговор похожим на давление.";
}

function freeReportThemes(context) {
  const themes = [
    { key: "needClarity", text: "хочется быстрее понять перспективу отношений, но срочность может сделать разговор тяжелее" },
    { key: "distanceHard", text: "дистанция воспринимается особенно болезненно, потому что теряется ощущение контакта" },
    { key: "control", text: "в неопределённости появляется желание вернуть управляемость, но это может восприниматься как давление" },
    { key: "emotionalTiredness", text: "накопилось внутреннее напряжение, и сил на неопределённость становится меньше" },
    { key: "repeatingScenario", text: "какая-то реакция сейчас может постепенно стать привычной, если её не заметить вовремя" },
    { key: "silence", text: "паузы в контакте могут оставлять слишком много пространства для догадок" },
  ].filter((theme) => contextScore(context, theme.key) >= 3);
  if (!themes.length) {
    themes.push({ key: "needClarity", text: "важно спокойнее понять, что между вами происходит на самом деле" });
  }
  return themes.sort((a, b) => contextScore(context, b.key) - contextScore(context, a.key));
}

function buildPersonalizedFreeReport(context) {
  const themes = freeReportThemes(context);
  const primary = themes[0];
  const secondary = themes.find((theme) => theme.key !== primary.key) || { key: "distanceHard", text: "важно не усиливать напряжение резкими действиями" };
  const request = freeReportRequestPhrase(context);
  const name = context.name ? `${context.name}, ` : "";
  const cycle = freeReportCycleTitle(context);
  const life = context.lifePathArchetype || "ваш личный код";
  const lifeMeaning = context.lifePathMeaning || "важны ясность, бережность и понимание своего сценария";
  const durationNote = context.rules && context.rules.threeToSixDistancePhrase
    ? `Тема ${request} уже перестала выглядеть для вас случайным эпизодом и начала заметно влиять на внутреннее состояние.`
    : "По вашим ответам видно, что ситуация уже влияет не только на отношения, но и на ваше внутреннее состояние.";
  const status = (context.currentSituation || "").toLowerCase();
  const statusText = status.includes("грани")
    ? "когда отношения ощущаются на грани"
    : status.includes("расстав")
      ? "когда формальный статус уже изменился, но внутренняя связь ещё не отпустила"
      : status.includes("неопредел")
        ? "когда статус связи остаётся неясным"
        : "когда связь ещё есть, но внутри неё стало больше напряжения";

  return normalizeAiReport({
    introText: `${name}по вашим ответам видно, что главная тема сейчас не просто в факте ${request}. Важнее то, как эта ситуация действует на вас изнутри: ${primary.text}. ${durationNote}`,
    annaMeaningText: `По цифровой части разбора проявился код «${life}». Для вас в отношениях особенно значимо: ${lifeMeaning}. Поэтому текущая ситуация может задевать не только чувства к партнёру, но и ощущение собственной устойчивости.`,
    annaRecommendation: "Сейчас полезно отделять реальный контакт от внутренних догадок. Сначала возвращайте себе спокойствие, а уже потом выбирайте слова и действия.",
    alexanderIntroText: `Со стороны Александра эта ситуация читается как цикл: «${cycle}». Он может включаться, ${statusText}.`,
    alexanderScenarioText: `Если коротко, внутри этого механизма есть два слоя. Первый: ${primary.text}. Второй: ${secondary.text}.${freeReportControlNote(context)} Из-за этого разговор может становиться тяжелее ещё до того, как вы успеваете спокойно сказать главное.`,
    alexanderRiskText: contextScore(context, "control") >= 4
      ? "пытаться получить ясность из тревоги. Тогда даже правильные слова могут звучать как давление, и партнёр может защищаться сильнее."
      : "слишком долго оставаться внутри ожидания и догадок. Тогда напряжение копится, а следующий разговор становится тяжелее, чем мог бы быть.",
    alexanderInnerFeelingText: contextScore(context, "emotionalTiredness") >= 4
      ? "Внутри это может ощущаться как усталость от неопределённости: хочется уже не красивых объяснений, а спокойного и честного понимания, что делать дальше."
      : "Внутри это может ощущаться как постоянное считывание сигналов: есть ли тепло, есть ли ответ, есть ли шанс на нормальный разговор.",
    alexanderRecommendation: "Не превращайте каждую тревогу в срочное действие. Сначала сформулируйте, что именно вы хотите прояснить, и только потом выходите в контакт.",
    nextStepText: "Этот бесплатный результат показывает верхний слой вашей ситуации. Такой цикл легче остановить, когда видно, в какой момент тревога превращается в давление. В полном разборе можно точнее увидеть, какие фразы помогут говорить спокойнее и как двигаться к вашей цели.",
    paidReportTeaserItems: [
      "Карта того, что сейчас происходит между вами",
      "Где вы непреднамеренно усиливаете напряжение",
      "Какие слова помогут говорить спокойнее",
      "Что лучше прекратить уже сейчас",
      "План действий на ближайшие 7 дней",
    ],
  });
}

function buildSystemPrompt() {
  return [
    "Ты создаёшь только короткие персональные текстовые фрагменты для бесплатного отчёта по отношениям.",
    "Ты не создаёшь структуру отчёта, заголовки блоков, кнопки, HTML, JSX или markdown.",
    "Возвращай только валидный JSON без пояснений.",
    "Пиши на русском языке: спокойно, глубоко, по-человечески, без мистики, диагнозов, запугивания и обещаний сохранить отношения.",
    "Не утверждай, что партнёр думает или чувствует. Не используй слова: точно, гарантированно, навсегда.",
    "Не давай полный пошаговый план в бесплатном отчёте. Дай узнавание, один важный инсайт и мягкий переход к полному разбору.",
    "Если score 4-5, тему можно сделать заметной. Если score 1-2, нельзя делать её главной.",
    "Если duration короткий, не пиши 'давно', 'годами' или 'длительное время'.",
    `Если duration = 3–6 месяцев, не пиши 'давно'. Для темы отдаления используй смысл: "${THREE_TO_SIX_DISTANCE_PHRASE}".`,
    "Если repeatingScenario низкий, не пиши, что человек постоянно повторяет один сценарий.",
    "Если emotionalTiredness низкий, не пиши, что человек истощён или устал от эмоциональных качелей.",
    "Формат ответа строго:",
    '{"introText":"","annaMeaningText":"","annaRecommendation":"","alexanderIntroText":"","alexanderScenarioText":"","alexanderRiskText":"","alexanderInnerFeelingText":"","alexanderRecommendation":"","nextStepText":"","paidReportTeaserItems":["","","","",""]}',
    "Ограничения: introText до 500 символов; annaMeaningText до 600; annaRecommendation до 220; alexanderIntroText до 400; alexanderScenarioText до 600; alexanderRiskText до 500; alexanderInnerFeelingText до 350; alexanderRecommendation до 300; nextStepText до 550; каждый paidReportTeaserItems до 100 символов.",
  ].join("\n");
}

function buildUserPrompt(context) {
  return [
    "Сгенерируй короткие смысловые фрагменты для бесплатного отчёта на основе этого структурированного контекста.",
    "Сайт сам выведет имя, дату рождения, число жизненного пути, архетип, названия блоков и кнопки.",
    "Не повторяй технические названия полей.",
    JSON.stringify(context, null, 2),
  ].join("\n\n");
}

async function callAi(context) {
  throw new Error("Free AI generation is disabled; use the local free_template report");
  /* istanbul ignore next */
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured");

  const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(context) },
      ],
      temperature: 0.3,
      max_tokens: 900,
      response_format: { type: "json_object" },
    }),
  });

  const payloadText = await response.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && payload.error && payload.error.message ? payload.error.message : payloadText;
    throw new Error(`AI API failed: ${message}`);
  }

  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  const parsed = safeJsonParse(content);
  const report = normalizeAiReport(parsed);
  if (!report) {
    if (DEBUG_AI_REPORT) {
      console.error("[generate-free-report] invalid AI content:", content.slice(0, 3000));
      console.error("[generate-free-report] parsed AI keys:", parsed && Object.keys(parsed));
    }
    throw new Error("AI returned invalid report JSON");
  }
  return report;
}

function listOf(input, count, maxLength, fallback) {
  const source = Array.isArray(input) ? input : [];
  const output = source.map((item) => clampText(item, maxLength)).filter((item) => item.length >= 3);
  for (let index = output.length; index < count; index += 1) {
    output.push(fallback[index] || fallback[fallback.length - 1] || "");
  }
  return output.slice(0, count);
}

function normalizePaidReport(input, fallback, context) {
  if (!input || typeof input !== "object") return null;
  const safe = fallback || buildPaidFallbackReport({});
  const sevenDayPlan = Array.isArray(input.sevenDayPlan) ? input.sevenDayPlan : [];

  const report = {
    intro: {
      text: clampText(input.intro && input.intro.text, 700) || safe.intro.text,
    },
    annaBlock: {
      lifePathMeaning: clampText(input.annaBlock && input.annaBlock.lifePathMeaning, 900) || safe.annaBlock.lifePathMeaning,
      strongSide: clampText(input.annaBlock && input.annaBlock.strongSide, 300) || safe.annaBlock.strongSide,
      weakPoint: clampText(input.annaBlock && input.annaBlock.weakPoint, 300) || safe.annaBlock.weakPoint,
      typicalMistake: clampText(input.annaBlock && input.annaBlock.typicalMistake, 300) || safe.annaBlock.typicalMistake,
      example: clampText(input.annaBlock && input.annaBlock.example, 300) || safe.annaBlock.example,
      recommendation: clampText(input.annaBlock && input.annaBlock.recommendation, 300) || safe.annaBlock.recommendation,
    },
    alexanderBlock: {
      cycleExplanation: clampText(input.alexanderBlock && input.alexanderBlock.cycleExplanation, 900) || safe.alexanderBlock.cycleExplanation,
      mainMechanism: clampText(input.alexanderBlock && input.alexanderBlock.mainMechanism, 800) || safe.alexanderBlock.mainMechanism,
      howUserAmplifiesProblem: listOf(
        input.alexanderBlock && input.alexanderBlock.howUserAmplifiesProblem,
        3,
        180,
        safe.alexanderBlock.howUserAmplifiesProblem
      ),
      innerFeeling: clampText(input.alexanderBlock && input.alexanderBlock.innerFeeling, 400) || safe.alexanderBlock.innerFeeling,
      mainMistake: clampText(input.alexanderBlock && input.alexanderBlock.mainMistake, 500) || safe.alexanderBlock.mainMistake,
      whatToUnderstand: clampText(input.alexanderBlock && input.alexanderBlock.whatToUnderstand, 600) || safe.alexanderBlock.whatToUnderstand,
      recommendation: clampText(input.alexanderBlock && input.alexanderBlock.recommendation, 400) || safe.alexanderBlock.recommendation,
    },
    communicationBlock: {
      badDialogueExample: {
        userPhrase: clampText(input.communicationBlock && input.communicationBlock.badDialogueExample && input.communicationBlock.badDialogueExample.userPhrase, 180) || safe.communicationBlock.badDialogueExample.userPhrase,
        partnerPhrase: clampText(input.communicationBlock && input.communicationBlock.badDialogueExample && input.communicationBlock.badDialogueExample.partnerPhrase, 180) || safe.communicationBlock.badDialogueExample.partnerPhrase,
        userSecondPhrase: clampText(input.communicationBlock && input.communicationBlock.badDialogueExample && input.communicationBlock.badDialogueExample.userSecondPhrase, 180) || safe.communicationBlock.badDialogueExample.userSecondPhrase,
        explanation: clampText(input.communicationBlock && input.communicationBlock.badDialogueExample && input.communicationBlock.badDialogueExample.explanation, 450) || safe.communicationBlock.badDialogueExample.explanation,
      },
      betterPhrases: listOf(input.communicationBlock && input.communicationBlock.betterPhrases, 3, 180, safe.communicationBlock.betterPhrases),
      whatToStop: listOf(input.communicationBlock && input.communicationBlock.whatToStop, 4, 180, safe.communicationBlock.whatToStop),
      whatToStart: listOf(input.communicationBlock && input.communicationBlock.whatToStart, 4, 180, safe.communicationBlock.whatToStart),
    },
    sevenDayPlan: Array.from({ length: 7 }, (_, index) => {
      const source = sevenDayPlan[index] || {};
      const fallbackDay = safe.sevenDayPlan[index];
      return {
        day: index + 1,
        title: clampText(source.title, 120) || fallbackDay.title,
        whyItMatters: clampText(source.whyItMatters, 450) || fallbackDay.whyItMatters,
        actions: listOf(source.actions, 2, 180, fallbackDay.actions),
        phraseOfDay: clampText(source.phraseOfDay, 160) || fallbackDay.phraseOfDay,
        expectedResult: clampText(source.expectedResult, 220) || fallbackDay.expectedResult,
      };
    }),
    finalMemo: {
      mistakes: listOf(input.finalMemo && input.finalMemo.mistakes, 3, 180, safe.finalMemo.mistakes),
      usefulActions: listOf(input.finalMemo && input.finalMemo.usefulActions, 3, 180, safe.finalMemo.usefulActions),
      whenToBookDiagnosis: clampText(input.finalMemo && input.finalMemo.whenToBookDiagnosis, 450) || safe.finalMemo.whenToBookDiagnosis,
      finalText: clampText(input.finalMemo && input.finalMemo.finalText, 700) || safe.finalMemo.finalText,
    },
  };

  enforcePaidContextRules(report, context);

  if (report.intro.text.length < 20 || report.alexanderBlock.cycleExplanation.length < 20) {
    return null;
  }
  return report;
}

function buildPaidFallbackReport(context) {
  const name = context.name || "вас";
  const cycle = context.mainScenario || context.cycleTitle || "поиск ясности без давления";
  const lifePath = context.lifePathTitle || "ваш личный код";
  const durationNote = context.rules && context.rules.threeToSixDistancePhrase
    ? `${THREE_TO_SIX_DISTANCE_PHRASE}.`
    : "Ситуация уже влияет на ваше состояние, поэтому важно действовать спокойнее и точнее.";
  const report = {
    intro: {
      text: `Этот разбор собран вокруг вашей ситуации: ${cycle}. ${durationNote} Здесь важны не общие советы, а понятная карта того, что усиливает напряжение и какие первые шаги помогут говорить спокойнее.`,
    },
    annaBlock: {
      lifePathMeaning: `По цифровому анализу ${lifePath} показывает не ярлык, а привычный способ реагировать в близости. Это видно в том, как вы ищете ясность, тепло и подтверждение контакта.`,
      strongSide: "Ваша сильная сторона — способность замечать нюансы и не оставаться равнодушным к тому, что происходит между вами.",
      weakPoint: "Слабое место появляется там, где желание быстрее понять ситуацию превращается во внутреннее напряжение.",
      typicalMistake: "Типичная ошибка — пытаться получить ясность именно в тот момент, когда разговор уже перегружен эмоциями.",
      example: "Например, вопрос о чувствах партнёра может звучать как просьба о близости, но восприниматься как давление.",
      recommendation: "Сначала верните спокойный тон и короткий контакт, а уже потом переходите к сложным темам.",
    },
    alexanderBlock: {
      cycleExplanation: `Сценарий «${cycle}» держится на тревоге, ожидании и попытке быстрее получить ясность. Чем меньше тепла и понятных сигналов, тем сильнее хочется ускорить разговор. Но именно спешка может усиливать дистанцию.`,
      mainMechanism: "Главный механизм здесь — не только сама проблема, а способ реагировать на неё. Когда внутри много неопределённости, хочется быстрого ответа. В такой ситуации партнёр может закрываться сильнее, если слышит давление.",
      howUserAmplifiesProblem: [
        "Слишком быстро переходите к серьёзному разговору, когда контакт ещё не восстановлен.",
        "Пытаетесь получить точный ответ там, где партнёр может быть готов только к короткому обмену.",
        "Накручиваете себя паузами и начинаете говорить из тревоги, а не из спокойной позиции.",
      ],
      innerFeeling: `Внутри у ${name} может быть ощущение, что время уходит и нужно срочно что-то решать. Это чувство понятно, но именно оно часто делает тон тяжелее.`,
      mainMistake: "Главная ошибка — считать, что сильный разговор сразу вернёт близость. Иногда сначала нужно сделать общение спокойнее.",
      whatToUnderstand: "Сейчас важно отделить реальную ситуацию от тревожной догадки. Тогда действие становится точнее, а разговор — мягче.",
      recommendation: "Выберите один короткий и спокойный шаг, который не требует от партнёра немедленного решения.",
    },
    communicationBlock: {
      badDialogueExample: {
        userPhrase: "Почему ты опять холодно отвечаешь?",
        partnerPhrase: "Я нормально отвечаю.",
        userSecondPhrase: "Нет, я же вижу, что тебе всё равно.",
        explanation: "Такой диалог быстро переводит разговор в защиту. Вместо близости появляется спор о том, кто прав.",
      },
      betterPhrases: [
        "Мне важно понять, можем ли мы спокойно поговорить сегодня или лучше выбрать другое время.",
        "Я не хочу давить, но хочу вернуть между нами более тёплый контакт.",
        "Мне сейчас важнее услышать тебя, чем спорить о том, кто виноват.",
      ],
      whatToStop: [
        "Не начинать разговор с обвинения или проверки.",
        "Не требовать немедленного ответа на сложный вопрос.",
        "Не увеличивать количество сообщений из тревоги.",
        "Не додумывать за партнёра его чувства и мотивы.",
      ],
      whatToStart: [
        "Говорить коротко и конкретно.",
        "Сначала обозначать своё состояние, а не претензию.",
        "Давать партнёру пространство для ответа.",
        "Отслеживать момент, когда разговор становится слишком тяжёлым.",
      ],
    },
    sevenDayPlan: [
      {
        day: 1,
        title: "Снизить внутренний накал",
        whyItMatters: "Первый день нужен не для большого разговора, а для возвращения спокойной позиции. Без этого любые слова звучат резче.",
        actions: ["Запишите, что вы точно знаете, а что только предполагаете.", "Не начинайте сложный разговор в момент тревоги."],
        phraseOfDay: "Я хочу сначала успокоиться, чтобы говорить бережнее.",
        expectedResult: "Станет меньше импульса срочно что-то доказывать.",
      },
      {
        day: 2,
        title: "Вернуть короткий контакт",
        whyItMatters: "Близость часто возвращается через простые спокойные касания, а не через тяжёлый разговор обо всём сразу.",
        actions: ["Отправьте короткое нейтрально-тёплое сообщение.", "Не добавляйте второй вопрос, если ответа пока нет."],
        phraseOfDay: "Хочу просто пожелать тебе спокойного дня.",
        expectedResult: "Контакт станет менее напряжённым.",
      },
      {
        day: 3,
        title: "Убрать давление из формулировок",
        whyItMatters: "Даже верная мысль может закрыть партнёра, если звучит как требование.",
        actions: ["Замените обвинение на описание своего состояния.", "Сформулируйте один вопрос вместо нескольких."],
        phraseOfDay: "Мне важно поговорить спокойно, без претензий.",
        expectedResult: "Разговору будет легче начаться без защиты.",
      },
      {
        day: 4,
        title: "Проверить свои ожидания",
        whyItMatters: "Ожидание быстрого результата делает любой ответ партнёра недостаточным.",
        actions: ["Определите, какой минимальный шаг уже будет улучшением.", "Не оценивайте всю связь по одной реакции."],
        phraseOfDay: "Мне достаточно начать с маленького шага.",
        expectedResult: "Появится больше реалистичности и меньше внутренней гонки.",
      },
      {
        day: 5,
        title: "Подготовить разговор",
        whyItMatters: "Сложный разговор лучше начинать не с боли, а с цели: что вы хотите улучшить между вами.",
        actions: ["Запишите одну главную тему разговора.", "Выберите время, когда вы оба не перегружены."],
        phraseOfDay: "Я хочу не спорить, а понять, как нам стало бы спокойнее.",
        expectedResult: "Разговор получит рамку и не распадётся на претензии.",
      },
      {
        day: 6,
        title: "Слушать без немедленной защиты",
        whyItMatters: "Если партнёр начинает говорить, важно не перебить его своей тревогой.",
        actions: ["Повторите услышанное своими словами.", "Спросите, правильно ли вы поняли смысл."],
        phraseOfDay: "Я слышу, что для тебя это тоже непросто.",
        expectedResult: "Появится шанс на более честный и спокойный обмен.",
      },
      {
        day: 7,
        title: "Закрепить новый тон",
        whyItMatters: "Один разговор не решает всё, но может задать другой способ контакта.",
        actions: ["Отметьте, что сработало лучше прежнего.", "Договоритесь о следующем маленьком шаге без давления."],
        phraseOfDay: "Давай двигаться небольшими шагами, но без прежнего напряжения.",
        expectedResult: "Появится ощущение направления, а не только круг тревоги.",
      },
    ],
    finalMemo: {
      mistakes: [
        "Говорить из тревоги вместо более взрослой позиции.",
        "Требовать от партнёра немедленного ответа.",
        "Путать паузу в контакте с окончательным выводом.",
      ],
      usefulActions: [
        "Снижать накал перед разговором.",
        "Формулировать короткие и честные фразы.",
        "Отделять факты от догадок.",
      ],
      whenToBookDiagnosis: "Если вы хотите разобрать живую ситуацию глубже, можно прийти на диагностику.",
      finalText: "Главная задача на ближайшие дни — не заставить отношения резко измениться, а перестать усиливать тот сценарий, который уже делает контакт тяжелее. Когда меняется тон и последовательность действий, появляется больше пространства для ясности.",
    },
  };
  return enforcePaidContextRules(report, context);
}

function buildPaidSystemPrompt() {
  return [
    "You create a paid personal relationship report in Russian.",
    "Return only valid JSON. Do not return HTML, JSX, Markdown, code fences or explanations.",
    "All string values must be natural Russian Cyrillic text.",
    "Style: professional but simple. Write like a calm specialist explains the situation in a consultation.",
    "Use simple Russian, short sentences, clear explanations and practical steps.",
    "Do not write dry academic text. Do not write too emotionally or dramatically.",
    "No mysticism. No diagnoses. No fear. No promises to save a relationship.",
    "Never claim that the partner definitely feels, thinks, wants or needs something. Use cautious wording: может, похоже, в такой ситуации может быть.",
    "Avoid coaching phrases and generic praise. Do not write: Ваша устойчивость делает вас более привлекательным партнёром.",
    "Recommendations must be non-directive and precise. Do not write: Сократите количество сообщений и звонков до минимума.",
    "Instead explain: Не увеличивайте количество сообщений из тревоги. Оставьте только те контакты, которые действительно помогают прояснению, а не просто снимают напряжение на минуту.",
    "Avoid filler, repetitions and long paragraphs. Every paragraph should be no more than 3-4 short lines.",
    "Prefer sentences up to 18-22 words.",
    "Keep each field compact enough to fit the full JSON response. Do not over-expand explanations.",
    "The paid report must be deeper and more practical than a free preview.",
    "It must include: scenario map, where the user amplifies tension, how to speak with partner, exact phrases, what to stop, what to start, seven-day plan, final memo.",
    "Do not use these repeated phrases: Сейчас важно увидеть главное; Дополнительно ситуацию усиливает; Вы уже видите два слоя; Полный разбор нужен.",
    "Do not use heavy terms unless you immediately explain them simply.",
    "Avoid these phrases: динамика взаимодействия; эмоциональная автономность; деструктивный паттерн; сценарная конструкция; механизмы компенсации; процесс стабилизации контакта; переработка чувств; трансформация внутреннего состояния; структурировать текущую ситуацию.",
    "Use simple replacements: то, что сейчас происходит между вами; умение не зависеть полностью от реакции партнёра; повторяющийся способ реагировать, который ухудшает ситуацию; сделать общение спокойнее; время, чтобы разобраться в своих чувствах.",
    "Use 'внутренняя опора' only if you explain it right away as a state where the user depends less on every message or pause.",
    "Respect low scores: if a score is 1-2, do not make that theme central.",
    "If silence is 1-2, do not make silence, ignoring or avoidance the main scenario.",
    "If emotionalTiredness is low, do not say the user is exhausted.",
    "If repeatingScenario is low, write softly that a scenario may be forming, not that it constantly repeats.",
    `If duration is 3-6 months and the topic is distance, do not write 'давно'. Use this meaning: "${THREE_TO_SIX_DISTANCE_PHRASE}".`,
    "The final part may gently say: Если вы хотите разобрать живую ситуацию глубже, можно прийти на диагностику.",
    "But the report must not feel like a new sales pitch. It must feel complete and valuable on its own.",
    "The seven-day plan must have seven different days, different phrases and different expected results.",
    "JSON shape:",
    '{"intro":{"text":""},"annaBlock":{"lifePathMeaning":"","strongSide":"","weakPoint":"","typicalMistake":"","example":"","recommendation":""},"alexanderBlock":{"cycleExplanation":"","mainMechanism":"","howUserAmplifiesProblem":["","",""],"innerFeeling":"","mainMistake":"","whatToUnderstand":"","recommendation":""},"communicationBlock":{"badDialogueExample":{"userPhrase":"","partnerPhrase":"","userSecondPhrase":"","explanation":""},"betterPhrases":["","",""],"whatToStop":["","","",""],"whatToStart":["","","",""]},"sevenDayPlan":[{"day":1,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":2,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":3,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":4,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":5,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":6,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":7,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""}],"finalMemo":{"mistakes":["","",""],"usefulActions":["","",""],"whenToBookDiagnosis":"","finalText":""}}',
  ].join("\n");
}

function buildPaidUserPrompt(context) {
  return [
    "Create the paid report from this structured context. Generate only meaning texts inside the JSON fields.",
    "Do not repeat the free-report wording verbatim. Use the user scores and rules.",
    "Use context.mainScenario as the main scenario unless it directly contradicts the scores.",
    "Use the readable labels in the context: relationshipStatusLabel, mainProblemLabel, problemDurationLabel, goalLabel.",
    "If rules.doNotMakeSilenceCentral is true, do not build the report around silence, ignoring or avoidance.",
    "If rules.threeToSixDistancePhrase is true, use the provided wording about distance no longer looking like a random episode. Do not say 'давно'.",
    "Write the communication section with exact phrases the user can say, not abstract advice.",
    "Write the seven-day plan as practical small steps. Each day should have a concrete action and a phrase.",
    "Keep the final memo useful. Do not turn it into a sales block.",
    JSON.stringify(context, null, 2),
  ].join("\n\n");
}

function buildAiProviderContext(context) {
  const safeContext = { ...context };
  delete safeContext.name;
  delete safeContext.birthDate;
  delete safeContext.contextNote;
  safeContext.dataMinimization = {
    directIdentifiersRemoved: true,
    freeTextRemoved: true,
  };
  return safeContext;
}

async function callPaidAi(context) {
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured");
  const providerContext = buildAiProviderContext(context);

  const response = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PAID_AI_MODEL,
      messages: [
        { role: "system", content: buildPaidSystemPrompt() },
        { role: "user", content: buildPaidUserPrompt(providerContext) },
      ],
      temperature: 0.35,
      max_tokens: 7000,
      response_format: { type: "json_object" },
    }),
  });

  const payloadText = await response.text();
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const message = payload && payload.error && payload.error.message ? payload.error.message : payloadText;
    throw new Error(`Paid AI API failed: ${message}`);
  }

  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : "";
  const fallback = buildPaidFallbackReport(context);
  const parsed = safeJsonParse(content);
  const report = normalizePaidReport(parsed, fallback, context);
  if (!report) {
    if (DEBUG_AI_REPORT) {
      console.error("[generate-paid-report] invalid AI content:", content.slice(0, 3000));
      console.error("[generate-paid-report] parsed AI keys:", parsed && Object.keys(parsed));
    }
    throw new Error("AI returned invalid paid report JSON");
  }
  return report;
}

async function handleGeneratePaidReport(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJson(req);
    const paymentAccess = readPaymentAccess(body.paymentAccess);
    if (!paymentAccess) {
      sendJson(res, 403, { error: "Paid access is required" });
      return;
    }
    const payment = paymentCache.get(paymentAccess.orderId);
    if (
      !payment ||
      payment.status !== "paid" ||
      payment.paymentId !== paymentAccess.paymentId ||
      payment.contextHash !== stableHash({
        answers: body.answers && typeof body.answers === "object" ? body.answers : {},
        result: body.result && typeof body.result === "object" ? body.result : {},
      })
    ) {
      sendJson(res, 403, { error: "Verified payment is required" });
      return;
    }

    const context = buildPaidContext(body);
    if (!context.name || !context.birthDate || !context.lifePathNumber || !context.cycleTitle) {
      sendJson(res, 400, { error: "Invalid paid report context" });
      return;
    }

    const clientHash = typeof body.hash === "string" && body.hash.length >= 12
      ? body.hash
      : stableHash({ context, paymentId: paymentAccess.paymentId, orderId: paymentAccess.orderId });
    const hash = stableHash({ clientHash, paidModel: PAID_AI_MODEL, reportVersion: "paid-ai-v3" });

    if (paidReportCache.has(hash)) {
      const cached = paidReportCache.get(hash);
      const report = enforcePaidContextRules(cached.report, context);
      sendJson(res, 200, { report, source: "paid_cache", hash, createdAt: cached.createdAt, model: cached.model });
      return;
    }

    let generation = paidReportInFlight.get(hash);
    if (!generation) {
      generation = (async () => {
        let source = "paid_ai";
        let report;
        const startedAt = Date.now();
        console.log("[paid-ai] started", {
          hash: hash.slice(0, 12),
          orderId: paymentAccess.orderId,
          model: PAID_AI_MODEL,
        });
        try {
          report = await callPaidAi(context);
        } catch (error) {
          source = "paid_fallback";
          report = buildPaidFallbackReport(context);
          console.error("[paid-ai] fallback", {
            hash: hash.slice(0, 12),
            orderId: paymentAccess.orderId,
            durationMs: Date.now() - startedAt,
            error: error.message,
          });
        }

        const generatedRecord = {
          report,
          source,
          model: source === "paid_ai" ? PAID_AI_MODEL : "fallback",
          createdAt: new Date().toISOString(),
        };
        paidReportCache.set(hash, generatedRecord);
        savePaidReportStore();
        console.log("[paid-ai] completed", {
          hash: hash.slice(0, 12),
          orderId: paymentAccess.orderId,
          source,
          durationMs: Date.now() - startedAt,
        });
        return generatedRecord;
      })();
      paidReportInFlight.set(hash, generation);
      generation.finally(() => {
        if (paidReportInFlight.get(hash) === generation) paidReportInFlight.delete(hash);
      });
    } else {
      console.log("[paid-ai] joined-in-flight", {
        hash: hash.slice(0, 12),
        orderId: paymentAccess.orderId,
      });
    }

    const record = await generation;
    const report = enforcePaidContextRules(record.report, context);
    const source = record.source;
    sendJson(res, 200, { report, source, hash, createdAt: record.createdAt, model: record.model });
  } catch (error) {
    console.error("[generate-paid-report]", error);
    sendJson(res, 503, { error: "Paid report is temporarily unavailable" });
  }
}

async function handleGenerateFreeReport(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJson(req);
    const legalConsent = body.legalConsent && typeof body.legalConsent === "object" ? body.legalConsent : {};
    if (
      legalConsent.version !== LEGAL_VERSION ||
      !consentAccepts(clampText(legalConsent.personalDataConsentId, 120), "personal_data")
    ) {
      sendJson(res, 400, { error: "Required personal data consent is missing" });
      return;
    }
    const context = validateContext(body.context);
    if (!context || !context.lifePathNumber || !context.detectedCycle) {
      sendJson(res, 400, { error: "Invalid report context" });
      return;
    }
    const hash = typeof body.hash === "string" && body.hash.length >= 12
      ? body.hash
      : stableHash({
        birthDate: context.birthDate,
        scores: context.scores,
        detectedCycle: context.detectedCycle,
        mainGoal: context.mainGoal,
      });

    if (reportCache.has(hash)) {
      sendJson(res, 200, { report: reportCache.get(hash), cached: true, source: "free_template" });
      return;
    }

    const report = buildPersonalizedFreeReport(context);
    reportCache.set(hash, report);
    sendJson(res, 200, { report, cached: false, source: "free_template" });
  } catch (error) {
    console.error("[generate-free-report]", error);
    sendJson(res, 503, { error: "Free report is temporarily unavailable", fallback: true });
  }
}

async function handleProductSettings(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { priceRub: PRODUCT_PRICE_RUB });
    return;
  }

  if (req.method === "POST") {
    if (!ADMIN_BASIC_AUTH || !timingSafeEqualExact(req.headers.authorization, ADMIN_BASIC_AUTH)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }
    const body = await readJson(req);
    const priceRub = Number(body.priceRub);
    if (!Number.isFinite(priceRub) || priceRub <= 0) {
      sendJson(res, 400, { error: "Invalid price" });
      return;
    }
    sendJson(res, 200, { priceRub });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

function handlePaymentStatus(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const paymentId = clampText(url.searchParams.get("paymentId"), 120);
  const orderId = clampText(url.searchParams.get("orderId"), 120);
  const payment = paymentCache.get(orderId || paymentId);
  if (!payment) {
    sendJson(res, 404, { status: "missing", paid: false, matchesOrderId: false });
    return;
  }
  sendJson(res, 200, {
    status: payment.status === "paid" ? "succeeded" : payment.status,
    paid: payment.status === "paid",
    matchesOrderId: payment.paymentId === paymentId && payment.orderId === orderId,
  });
}

function handlePaymentContext(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const orderId = clampText(url.searchParams.get("orderId"), 120);
  const accessToken = clampText(url.searchParams.get("accessToken"), 160);
  const paymentId = clampText(url.searchParams.get("paymentId"), 120);
  const payment = paymentCache.get(orderId);
  const tokenMatches = Boolean(
    payment &&
    accessToken &&
    payment.accessToken &&
    timingSafeEqualText(payment.accessToken, accessToken)
  );
  const paidPaymentMatches = Boolean(
    payment &&
    payment.status === "paid" &&
    paymentId &&
    timingSafeEqualText(payment.paymentId, paymentId)
  );
  if (!payment || (!tokenMatches && !paidPaymentMatches)) {
    sendJson(res, 404, { error: "Payment context not found" });
    return;
  }

  sendJson(res, 200, {
    state: {
      answers: payment.answers || {},
      result: payment.result || null,
    },
    payment: {
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status === "paid" ? "paid" : "pending",
      paidAt: payment.paidAt || "",
    },
  });
}

async function handleAttachPaymentContext(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const orderId = clampText(body.orderId, 120);
  const paymentId = clampText(body.paymentId, 120);
  const payment = paymentCache.get(orderId);
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const result = body.result && typeof body.result === "object" ? body.result : {};
  if (
    !payment ||
    payment.status !== "paid" ||
    payment.paymentId !== paymentId ||
    !Object.keys(answers).length ||
    !Object.keys(result).length
  ) {
    sendJson(res, 403, { error: "Verified paid order is required" });
    return;
  }

  payment.answers = answers;
  payment.result = result;
  payment.contextHash = stableHash({ answers, result });
  payment.contextAttachedAt = new Date().toISOString();
  savePaymentStore();
  sendJson(res, 200, { attached: true, paid: true });
}

async function handleCreateYookassaPayment(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    sendJson(res, 503, { error: "Payment service is not configured" });
    return;
  }

  const body = await readJson(req);
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const result = body.resultSnapshot && typeof body.resultSnapshot === "object" ? body.resultSnapshot : {};
  const legalConsent = body.legalConsent && typeof body.legalConsent === "object" ? body.legalConsent : {};
  const personalDataConsentId = clampText(legalConsent.personalDataConsentId, 120);
  const offerConsentId = clampText(legalConsent.offerConsentId, 120);
  if (!Object.keys(answers).length || !Object.keys(result).length) {
    sendJson(res, 400, { error: "Invalid payment context" });
    return;
  }
  if (
    legalConsent.version !== LEGAL_VERSION ||
    !consentAccepts(personalDataConsentId, "personal_data") ||
    !consentAccepts(offerConsentId, "offer")
  ) {
    sendJson(res, 400, { error: "Required legal consents are missing" });
    return;
  }

  const orderId = `kod-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const accessToken = crypto.randomBytes(32).toString("hex");
  const amount = PRODUCT_PRICE_RUB.toFixed(2);
  const returnUrl = `${PUBLIC_BASE_URL}/payment/return?orderId=${encodeURIComponent(orderId)}&accessToken=${encodeURIComponent(accessToken)}`;
  const providerPayment = await yookassaRequest("/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": orderId,
    },
    body: JSON.stringify({
      amount: { value: amount, currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: returnUrl },
      description: "Полный персональный отчёт",
      metadata: { orderId },
    }),
  });
  const confirmationUrl = providerPayment && providerPayment.confirmation
    ? providerPayment.confirmation.confirmation_url
    : "";
  if (!providerPayment || !providerPayment.id || !confirmationUrl) {
    throw new Error("YooKassa did not return a confirmation URL");
  }

  paymentCache.set(orderId, {
    provider: "yookassa",
    providerPaymentId: providerPayment.id,
    paymentId: providerPayment.id,
    orderId,
    amount,
    status: providerPayment.status || "pending",
    accessToken,
    answers,
    result,
    contextHash: stableHash({ answers, result }),
    legalConsent: {
      personalDataConsentId,
      offerConsentId,
      version: LEGAL_VERSION,
    },
    createdAt: new Date().toISOString(),
  });
  savePaymentStore();

  sendJson(res, 200, {
    paymentId: providerPayment.id,
    orderId,
    amount,
    accessToken,
    confirmationUrl,
  });
}

async function handleYookassaPaymentStatus(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const paymentId = clampText(url.searchParams.get("paymentId"), 120);
  const orderId = clampText(url.searchParams.get("orderId"), 120);
  const payment = paymentCache.get(orderId || paymentId);
  if (!payment) {
    sendJson(res, 404, { status: "missing", paid: false, matchesOrderId: false });
    return;
  }

  if (payment.provider === "yookassa" && payment.status !== "paid") {
    try {
      const providerPayment = await yookassaRequest(`/payments/${encodeURIComponent(payment.providerPaymentId || payment.paymentId)}`);
      applyYookassaPayment(payment, providerPayment);
      savePaymentStore();
    } catch (error) {
      console.warn("[yookassa-status]", { orderId: payment.orderId, error: error.message });
    }
  }

  sendJson(res, 200, {
    status: payment.status === "paid" ? "succeeded" : payment.status,
    paid: payment.status === "paid",
    matchesOrderId: payment.paymentId === paymentId && payment.orderId === orderId,
  });
}

async function handleYookassaNotification(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    sendJson(res, 503, { error: "Payment service is not configured" });
    return;
  }

  const payload = await readJson(req);
  const notificationPayment = payload && payload.object && typeof payload.object === "object"
    ? payload.object
    : null;
  const providerPaymentId = clampText(notificationPayment && notificationPayment.id, 120);
  if (!providerPaymentId) {
    sendJson(res, 400, { error: "Invalid notification" });
    return;
  }

  const verifiedPayment = await yookassaRequest(`/payments/${encodeURIComponent(providerPaymentId)}`);
  const orderId = clampText(verifiedPayment && verifiedPayment.metadata && verifiedPayment.metadata.orderId, 120);
  const payment = paymentCache.get(orderId);
  if (!payment || payment.providerPaymentId !== verifiedPayment.id) {
    console.warn("[yookassa-notification] unknown payment", { orderId, providerPaymentId });
    sendJson(res, 404, { error: "Unknown order" });
    return;
  }

  const verifiedAmount = verifiedPayment.amount && verifiedPayment.amount.value
    ? Number(verifiedPayment.amount.value)
    : NaN;
  if (!Number.isFinite(verifiedAmount) || verifiedAmount !== Number(payment.amount)) {
    sendJson(res, 409, { error: "Payment amount mismatch" });
    return;
  }

  applyYookassaPayment(payment, verifiedPayment);
  savePaymentStore();
  console.log("[yookassa-notification] processed", {
    orderId,
    status: payment.status,
    event: clampText(payload.event, 80),
  });
  sendJson(res, 200, { received: true });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const candidate = path.normalize(path.join(SITE_DIR, pathname));
  const relative = path.relative(SITE_DIR, candidate);
  const safePath = relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? candidate
    : path.join(SITE_DIR, "index.html");

  fs.stat(safePath, (statError, stat) => {
    const filePath = !statError && stat.isFile() ? safePath : path.join(SITE_DIR, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-store, no-cache, must-revalidate" : "public, immutable, max-age=2592000",
      ...securityHeaders(),
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

function renderLeadContactPage() {
  const settings = getSiteSettings();
  const telegramUrl = escapeHtml(settings.contactLinks.telegram);
  const vkUrl = escapeHtml(settings.contactLinks.vk);
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Оставить заявку — Код отношений</title>
    <link rel="stylesheet" href="/assets/local-fonts-v1.css?v=1" />
    <link rel="stylesheet" href="/assets/index-CSe4HaY7.css" />
    <link rel="stylesheet" href="/assets/final-contact-step-v1.css?v=1" />
  </head>
  <body class="final-contact-step-body">
    <div id="root">
      <main class="final-contact-step" aria-labelledby="final-contact-title">
        <section class="final-contact-card">
          <div class="final-contact-brand">
            <img src="/assets/logo-gold-DMOg8YAH.png" alt="" class="final-contact-logo" />
            <div>
              <p class="final-contact-eyebrow">Код отношений</p>
              <p class="final-contact-brandline">Александр и Анна Тимофеевы</p>
            </div>
          </div>
          <div class="final-contact-copy">
            <h1 id="final-contact-title">Где вам удобно оставить заявку?</h1>
            <p>Выберите удобный способ связи. Мы получим ваше сообщение и вернёмся с ответом, чтобы согласовать бесплатную диагностику отношений.</p>
          </div>
          <div class="final-contact-actions" aria-label="Способы связи">
            <a class="final-contact-button final-contact-button-telegram" href="${telegramUrl}" target="_blank" rel="noopener">
              <span class="final-contact-button-icon">TG</span>
              <span><strong>Telegram</strong><small>Оставить заявку в Telegram</small></span>
            </a>
            <a class="final-contact-button final-contact-button-vk" href="${vkUrl}" target="_blank" rel="noopener">
              <span class="final-contact-button-icon">VK</span>
              <span><strong>ВКонтакте</strong><small>Оставить заявку в VK</small></span>
            </a>
          </div>
          <p class="final-contact-note">Откроется выбранный мессенджер. Напишите коротко: «Хочу бесплатную диагностику».</p>
        </section>
      </main>
    </div>
  </body>
</html>`;
}

function renderAdminPage() {
  const settingsJson = JSON.stringify(getSiteSettings()).replace(/</g, "\\u003c");
  const documentPathsJson = JSON.stringify(Object.keys(DOCUMENTS)).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Админ-панель — Код отношений</title>
    <style>
      :root{--ink:#342219;--muted:#755f50;--gold:#b98a47;--line:rgba(185,138,71,.24);--paper:#fffdf8;--bg:#fbf7ef}
      *{box-sizing:border-box}body{margin:0;color:var(--ink);background:radial-gradient(circle at 12% 0,rgba(222,188,132,.18),transparent 34%),var(--bg);font-family:Inter,Arial,sans-serif}
      .admin-shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:32px 0 52px}
      .admin-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:22px}
      .admin-kicker{margin:0 0 8px;color:var(--gold);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
      h1{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(34px,5vw,58px);line-height:1}
      .admin-card{padding:24px;border:1px solid var(--line);border-radius:24px;background:rgba(255,253,248,.94);box-shadow:0 20px 60px rgba(80,52,29,.08)}
      .admin-grid{display:grid;grid-template-columns:320px minmax(0,1fr);gap:18px;align-items:start}
      .admin-stack{display:grid;gap:16px}.admin-card h2{margin:0 0 14px;font-family:Georgia,"Times New Roman",serif;font-size:26px}
      label{display:grid;gap:8px;color:var(--muted);font-size:13px;font-weight:700}
      input,textarea,select{width:100%;border:1px solid rgba(70,45,28,.16);border-radius:14px;background:#fff;color:var(--ink);font:inherit;font-size:15px;line-height:1.45;padding:12px 14px;outline:none}
      textarea{min-height:340px;resize:vertical;font-family:Consolas,"Courier New",monospace;font-size:13px}
      input:focus,textarea:focus,select:focus{border-color:rgba(185,138,71,.55);box-shadow:0 0 0 4px rgba(185,138,71,.12)}
      .doc-tabs{display:grid;gap:8px}.doc-tab{width:100%;min-height:42px;border:1px solid var(--line);border-radius:13px;background:#fffaf1;color:var(--ink);font:inherit;font-weight:700;text-align:left;padding:9px 12px;cursor:pointer}
      .doc-tab.is-active{background:linear-gradient(145deg,#d7aa64,#9b6a32);color:#fffaf2;border-color:transparent}
      .admin-actions{position:sticky;bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding:14px;border:1px solid var(--line);border-radius:18px;background:rgba(255,253,248,.94);backdrop-filter:blur(14px)}
      .admin-save{min-height:46px;border:0;border-radius:15px;background:linear-gradient(145deg,#d7aa64,#9b6a32);color:#fffaf2;font:inherit;font-weight:800;padding:0 22px;cursor:pointer;box-shadow:0 12px 28px rgba(110,72,34,.18)}
      .admin-status{color:var(--muted);font-size:14px}.admin-help{margin:10px 0 0;color:var(--muted);font-size:13px;line-height:1.55}.admin-preview-link{color:#765326;text-underline-offset:3px}
      @media(max-width:800px){.admin-shell{width:min(100% - 20px,1180px);padding-top:18px}.admin-grid{grid-template-columns:1fr}.admin-top{display:grid}.admin-actions{position:static;display:grid}.admin-save{width:100%}}
    </style>
  </head>
  <body>
    <main class="admin-shell">
      <header class="admin-top">
        <div>
          <p class="admin-kicker">KOD Admin</p>
          <h1>Админ-панель</h1>
        </div>
        <a class="admin-preview-link" href="/" target="_blank" rel="noopener">Открыть сайт</a>
      </header>
      <div class="admin-grid">
        <aside class="admin-stack">
          <section class="admin-card">
            <h2>Кнопки заявки</h2>
            <label>Telegram
              <input id="telegram" type="url" placeholder="https://t.me/..." />
            </label>
            <br />
            <label>ВКонтакте
              <input id="vk" type="url" placeholder="https://vk.com/..." />
            </label>
            <p class="admin-help">Эти ссылки используются на финальной странице заявки: <a href="/lead" target="_blank" rel="noopener">/lead</a>.</p>
          </section>
          <section class="admin-card">
            <h2>Документы</h2>
            <div class="doc-tabs" id="docTabs"></div>
            <p class="admin-help">HTML-содержимое можно редактировать вручную. Например: &lt;p&gt;Текст&lt;/p&gt;, &lt;ul&gt;&lt;li&gt;Пункт&lt;/li&gt;&lt;/ul&gt;.</p>
          </section>
        </aside>
        <section class="admin-card">
          <h2 id="docHeading">Документ</h2>
          <div class="admin-stack">
            <label>Заголовок
              <input id="docTitle" type="text" />
            </label>
            <label>Описание под заголовком
              <textarea id="docLead" style="min-height:110px;font-family:inherit;font-size:15px"></textarea>
            </label>
            <label>HTML-содержимое документа
              <textarea id="docContent"></textarea>
            </label>
          </div>
        </section>
      </div>
      <div class="admin-actions">
        <span class="admin-status" id="status">Изменения ещё не сохранялись.</span>
        <button class="admin-save" id="saveButton" type="button">Сохранить изменения</button>
      </div>
    </main>
    <script>
      window.__KOD_ADMIN_INITIAL__ = ${settingsJson};
      window.__KOD_ADMIN_DOC_PATHS__ = ${documentPathsJson};
    </script>
    <script>
      (function(){
        var settings = JSON.parse(JSON.stringify(window.__KOD_ADMIN_INITIAL__ || {}));
        var paths = window.__KOD_ADMIN_DOC_PATHS__ || [];
        var labels = {
          "/privacy": "Политика",
          "/personal-data-consent": "Персональные данные",
          "/marketing-consent": "Рассылка",
          "/cookies": "Cookies",
          "/contacts": "Контакты"
        };
        var activePath = paths[0] || "/privacy";
        var telegram = document.getElementById("telegram");
        var vk = document.getElementById("vk");
        var docTabs = document.getElementById("docTabs");
        var docHeading = document.getElementById("docHeading");
        var docTitle = document.getElementById("docTitle");
        var docLead = document.getElementById("docLead");
        var docContent = document.getElementById("docContent");
        var status = document.getElementById("status");
        var saveButton = document.getElementById("saveButton");

        function ensureDoc(path){
          settings.legalDocuments = settings.legalDocuments || {};
          settings.legalDocuments[path] = settings.legalDocuments[path] || { title:"", lead:"", content:"" };
          return settings.legalDocuments[path];
        }
        function persistActive(){
          var doc = ensureDoc(activePath);
          doc.title = docTitle.value;
          doc.lead = docLead.value;
          doc.content = docContent.value;
        }
        function renderTabs(){
          docTabs.innerHTML = "";
          paths.forEach(function(path){
            var button = document.createElement("button");
            button.type = "button";
            button.className = "doc-tab" + (path === activePath ? " is-active" : "");
            button.textContent = labels[path] || path;
            button.addEventListener("click", function(){
              persistActive();
              activePath = path;
              renderDocument();
              renderTabs();
            });
            docTabs.appendChild(button);
          });
        }
        function renderDocument(){
          var doc = ensureDoc(activePath);
          docHeading.textContent = labels[activePath] || activePath;
          docTitle.value = doc.title || "";
          docLead.value = doc.lead || "";
          docContent.value = doc.content || "";
        }
        async function loadLatest(){
          var response = await fetch("/api/admin-settings", { credentials: "same-origin" });
          if (!response.ok) throw new Error("Не удалось загрузить настройки");
          var payload = await response.json();
          settings = payload.settings || settings;
          paths = payload.documentPaths || paths;
          telegram.value = settings.contactLinks && settings.contactLinks.telegram || "";
          vk.value = settings.contactLinks && settings.contactLinks.vk || "";
          renderTabs();
          renderDocument();
        }
        saveButton.addEventListener("click", async function(){
          persistActive();
          settings.contactLinks = { telegram: telegram.value, vk: vk.value };
          saveButton.disabled = true;
          status.textContent = "Сохраняю...";
          try {
            var response = await fetch("/api/admin-settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify(settings)
            });
            if (!response.ok) throw new Error("Ошибка сохранения");
            var payload = await response.json();
            settings = payload.settings || settings;
            status.textContent = "Сохранено: " + new Date().toLocaleString("ru-RU");
          } catch (error) {
            status.textContent = error.message || "Не удалось сохранить";
          } finally {
            saveButton.disabled = false;
          }
        });
        telegram.value = settings.contactLinks && settings.contactLinks.telegram || "";
        vk.value = settings.contactLinks && settings.contactLinks.vk || "";
        renderTabs();
        renderDocument();
        loadLatest().catch(function(error){ status.textContent = error.message; });
      })();
    </script>
  </body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    const legalPath = url.pathname.replace(/\/+$/, "") || "/";
    if (legalPath === "/offer" || legalPath === "/refund") {
      res.writeHead(302, {
        Location: "/contacts",
        "Cache-Control": "no-store",
        ...securityHeaders(),
      });
      res.end();
      return;
    }
    if (legalPath === "/payment" || legalPath === "/payment/return" || legalPath === "/full-report") {
      res.writeHead(302, {
        Location: "/lead",
        "Cache-Control": "no-store",
        ...securityHeaders(),
      });
      res.end();
      return;
    }
    if (legalPath === "/lead") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        ...securityHeaders(),
      });
      res.end(renderLeadContactPage());
      return;
    }
    if (DOCUMENTS[legalPath]) {
      const html = renderLegalDocument(legalPath, {
        priceRub: PRODUCT_PRICE_RUB,
        legalDocuments: getSiteSettings().legalDocuments,
      });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        ...securityHeaders(),
      });
      res.end(html);
      return;
    }
    if (url.pathname === "/api/consents") {
      if (!requireRateLimit(req, res, "consents", 30)) return;
      await handleConsent(req, res);
      return;
    }
    if (url.pathname === "/api/admin-session") {
      if (!requireRateLimit(req, res, "admin-session", 10)) return;
      handleAdminSession(req, res);
      return;
    }
    if (url.pathname === "/api/admin-settings") {
      if (!requireRateLimit(req, res, "admin-settings", 60)) return;
      await handleAdminSettings(req, res);
      return;
    }
    if (url.pathname === "/api/generate-free-report") {
      if (!requireRateLimit(req, res, "free-report", 20)) return;
      await handleGenerateFreeReport(req, res);
      return;
    }
    if (url.pathname === "/api/generate-paid-report") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/product-settings") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/create-payment") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/payment-status") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/payment-context") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/attach-payment-context") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (url.pathname === "/api/yookassa-notification") {
      sendPaidFlowDisabled(res);
      return;
    }
    if (legalPath === "/admin") {
      if (!requireAdmin(req, res)) return;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        ...securityHeaders(),
      });
      res.end(renderAdminPage());
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error("[server]", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

loadPaidReportStore();
loadPaymentStore();
loadConsentStore();
loadSiteSettings();

server.listen(PORT, () => {
  console.log(`KOD site server listening on ${PORT}`);
});
