const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, "site");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const PAID_AI_MODEL = process.env.PAID_AI_MODEL || process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const AI_API_BASE_URL = (process.env.AI_API_BASE_URL || "https://polza.ai/api/v1").replace(/\/$/, "");
const PAID_REPORT_STORE = process.env.PAID_REPORT_STORE || path.join(__dirname, "paid-reports.json");
const PAYMENT_STORE = process.env.PAYMENT_STORE || path.join(__dirname, "payments.json");
const PRODUCT_PRICE_RUB = Number(process.env.PRODUCT_PRICE_RUB || 490);
const PAYFORM_URL = (process.env.PAYFORM_URL || "https://yaity.payform.ru/").replace(/\/?$/, "/");
const PAYFORM_SECRET_KEY = process.env.PAYFORM_SECRET_KEY || "";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://kod.afianta.ru").replace(/\/$/, "");
const ADMIN_BASIC_AUTH = process.env.ADMIN_BASIC_AUTH || "";
const DEBUG_AI_REPORT = process.env.DEBUG_AI_REPORT === "1";
const reportCache = new Map();
const paidReportCache = new Map();
const paymentCache = new Map();

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

function stringifyPayformValues(value) {
  if (Array.isArray(value)) return value.map(stringifyPayformValues);
  if (value && typeof value === "object") {
    return Object.keys(value).reduce((result, key) => {
      result[key] = stringifyPayformValues(value[key]);
      return result;
    }, {});
  }
  return value === undefined || value === null ? "" : String(value);
}

function payformSignatureJson(value) {
  return JSON.stringify(canonicalize(stringifyPayformValues(value))).replace(/\//g, "\\/");
}

function createPayformSignature(payload) {
  return crypto
    .createHmac("sha256", PAYFORM_SECRET_KEY)
    .update(payformSignatureJson(payload))
    .digest("hex");
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || "").toLowerCase(), "utf8");
  const rightBuffer = Buffer.from(String(right || "").toLowerCase(), "utf8");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function appendQueryValue(params, key, value) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQueryValue(params, `${key}[${index}]`, item));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => {
      appendQueryValue(params, key ? `${key}[${childKey}]` : childKey, childValue);
    });
    return;
  }
  params.append(key, value === undefined || value === null ? "" : String(value));
}

function mergeNestedValue(target, keys, value) {
  const key = keys[0];
  const isIndex = /^\d+$/.test(key);
  const normalizedKey = isIndex ? Number(key) : key;
  if (keys.length === 1) {
    target[normalizedKey] = value;
    return;
  }
  const nextIsIndex = /^\d+$/.test(keys[1]);
  if (!target[normalizedKey] || typeof target[normalizedKey] !== "object") {
    target[normalizedKey] = nextIsIndex ? [] : {};
  }
  mergeNestedValue(target[normalizedKey], keys.slice(1), value);
}

function parseFormPayload(rawBody) {
  const result = {};
  new URLSearchParams(rawBody).forEach((value, rawKey) => {
    const keys = rawKey.match(/[^[\]]+/g) || [rawKey];
    mergeNestedValue(result, keys, value);
  });
  return result;
}

function buildPayformUrl(payload) {
  const signedPayload = { ...payload, signature: createPayformSignature(payload) };
  const params = new URLSearchParams();
  Object.entries(signedPayload).forEach(([key, value]) => appendQueryValue(params, key, value));
  return `${PAYFORM_URL}?${params.toString()}`;
}

function loadPaidReportStore() {
  try {
    if (!fs.existsSync(PAID_REPORT_STORE)) return;
    const parsed = JSON.parse(fs.readFileSync(PAID_REPORT_STORE, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    Object.entries(parsed).forEach(([key, value]) => {
      if (key && value && typeof value === "object") {
        paidReportCache.set(key, value);
      }
    });
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
    Object.entries(parsed).forEach(([key, value]) => {
      if (key && value && typeof value === "object") paymentCache.set(key, value);
    });
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

async function callPaidAi(context) {
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured");

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
        { role: "user", content: buildPaidUserPrompt(context) },
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

    let source = "paid_ai";
    let report;
    try {
      report = await callPaidAi(context);
    } catch (error) {
      source = "paid_fallback";
      report = buildPaidFallbackReport(context);
      console.error("[generate-paid-report]", error.message);
    }

    const record = {
      report,
      source,
      model: source === "paid_ai" ? PAID_AI_MODEL : "fallback",
      createdAt: new Date().toISOString(),
    };
    paidReportCache.set(hash, record);
    savePaidReportStore();
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

  if (!PAYFORM_SECRET_KEY) {
    sendJson(res, 503, { error: "Payment service is not configured" });
    return;
  }

  const body = await readJson(req);
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const result = body.resultSnapshot && typeof body.resultSnapshot === "object" ? body.resultSnapshot : {};
  if (!Object.keys(answers).length || !Object.keys(result).length) {
    sendJson(res, 400, { error: "Invalid payment context" });
    return;
  }

  const orderId = `kod-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
  const accessToken = crypto.randomBytes(32).toString("hex");
  const amount = PRODUCT_PRICE_RUB.toFixed(2);
  const returnUrl = `${PUBLIC_BASE_URL}/payment/return?orderId=${encodeURIComponent(orderId)}&accessToken=${encodeURIComponent(accessToken)}`;
  const payload = {
    do: "pay",
    order_id: orderId,
    order_sum: amount,
    customer_extra: "Полный персональный расчёт отношений",
    products: [{
      name: "Полный персональный расчёт отношений",
      price: amount,
      quantity: "1",
      sum: amount,
    }],
    urlReturn: returnUrl,
    urlSuccess: returnUrl,
    urlNotification: `${PUBLIC_BASE_URL}/api/payform-notification`,
    callbackType: "json",
    // Payform requires this parameter for per-order notifications.
    // Self-built integrations must leave the provider-issued system code empty.
    sys: "kod.afianta.ru",
  };

  paymentCache.set(orderId, {
    paymentId: orderId,
    orderId,
    amount,
    status: "pending",
    accessToken,
    answers,
    result,
    contextHash: stableHash({ answers, result }),
    createdAt: new Date().toISOString(),
  });
  savePaymentStore();

  sendJson(res, 200, {
    paymentId: orderId,
    orderId,
    amount,
    accessToken,
    confirmationUrl: buildPayformUrl(payload),
  });
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

async function handlePayformNotification(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  if (!PAYFORM_SECRET_KEY) {
    sendJson(res, 503, { error: "Payment service is not configured" });
    return;
  }

  const rawBody = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    payload = parseFormPayload(rawBody);
  }

  const receivedSignature = req.headers.sign || req.headers.signature || payload.signature || "";
  if (payload && Object.prototype.hasOwnProperty.call(payload, "signature")) delete payload.signature;
  if (!receivedSignature || !timingSafeEqualText(createPayformSignature(payload), receivedSignature)) {
    console.warn("[payform-notification] rejected", {
      reason: receivedSignature ? "invalid_signature" : "missing_signature",
      contentType: req.headers["content-type"] || "",
      orderId: clampText(payload && (payload.order_num || payload.order_id), 120),
    });
    sendJson(res, 403, { error: "Invalid signature" });
    return;
  }

  // Payform uses order_id for its internal payment id and order_num for
  // the merchant order number passed in the payment link.
  const orderId = clampText(payload.order_num || payload.order_id, 120);
  const payment = paymentCache.get(orderId);
  if (!payment) {
    console.warn("[payform-notification] unknown order", { orderId });
    sendJson(res, 404, { error: "Unknown order" });
    return;
  }

  const status = String(payload.payment_status || payload.status || "").toLowerCase();
  const paid = ["success", "succeeded", "paid"].includes(status);
  payment.status = paid ? "paid" : (status || "pending");
  payment.providerPaymentId = clampText(payload.payment_id, 120);
  payment.updatedAt = new Date().toISOString();
  if (paid) payment.paidAt = payment.updatedAt;
  savePaymentStore();
  console.log("[payform-notification] processed", {
    orderId,
    status: payment.status,
    paid,
  });

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end("success");
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
    if (url.pathname === "/api/generate-paid-report") {
      await handleGeneratePaidReport(req, res);
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
    if (url.pathname === "/api/payment-context") {
      handlePaymentContext(req, res);
      return;
    }
    if (url.pathname === "/api/attach-payment-context") {
      await handleAttachPaymentContext(req, res);
      return;
    }
    if (url.pathname === "/api/payform-notification") {
      await handlePayformNotification(req, res);
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

server.listen(PORT, () => {
  console.log(`KOD site server listening on ${PORT}`);
});
