const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, "site");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const AI_API_BASE_URL = (process.env.AI_API_BASE_URL || "https://polza.ai/api/v1").replace(/\/$/, "");
const PRODUCT_PRICE_RUB = Number(process.env.PRODUCT_PRICE_RUB || 490);
const ADMIN_BASIC_AUTH = process.env.ADMIN_BASIC_AUTH || "";
const DEBUG_AI_REPORT = process.env.DEBUG_AI_REPORT === "1";
const reportCache = new Map();

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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
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
  const body = await readBody(req);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function clampText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ").slice(0, maxLength);
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
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
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
      doNotSayEmotionalExhaustion: Boolean(context.rules && context.rules.doNotSayEmotionalExhaustion),
      doNotMakeClaimsAboutPartner: true,
    },
  };
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

async function handleGenerateFreeReport(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJson(req);
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
      sendJson(res, 200, { report: reportCache.get(hash), cached: true });
      return;
    }

    const report = await callAi(context);
    reportCache.set(hash, report);
    sendJson(res, 200, { report, cached: false });
  } catch (error) {
    console.error("[generate-free-report]", error);
    sendJson(res, 503, { error: "AI report is temporarily unavailable", fallback: true });
  }
}

async function handleProductSettings(req, res) {
  if (req.method === "GET") {
    sendJson(res, 200, { priceRub: PRODUCT_PRICE_RUB });
    return;
  }

  if (req.method === "POST") {
    if (ADMIN_BASIC_AUTH && req.headers.authorization !== ADMIN_BASIC_AUTH) {
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

async function handleCreatePayment(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    await readJson(req);
  } catch (_) {
    // The instant report flow does not depend on payment payload details.
  }

  const orderId = `instant-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  sendJson(res, 200, {
    paymentId: orderId,
    orderId,
    amount: "0.00",
    confirmationUrl: `/payment/return?orderId=${encodeURIComponent(orderId)}&instant=1`,
    instant: true,
  });
}

function handlePaymentStatus(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  sendJson(res, 200, {
    status: "succeeded",
    paid: true,
    matchesOrderId: true,
    instant: true,
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const candidate = path.normalize(path.join(SITE_DIR, pathname));
  const safePath = candidate.startsWith(SITE_DIR) ? candidate : path.join(SITE_DIR, "index.html");

  fs.stat(safePath, (statError, stat) => {
    const filePath = !statError && stat.isFile() ? safePath : path.join(SITE_DIR, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-store, no-cache, must-revalidate" : "public, immutable, max-age=2592000",
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/api/generate-free-report") {
      await handleGenerateFreeReport(req, res);
      return;
    }
    if (url.pathname === "/api/product-settings") {
      await handleProductSettings(req, res);
      return;
    }
    if (url.pathname === "/api/create-payment") {
      await handleCreatePayment(req, res);
      return;
    }
    if (url.pathname === "/api/payment-status") {
      handlePaymentStatus(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    console.error("[server]", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`KOD site server listening on ${PORT}`);
});
