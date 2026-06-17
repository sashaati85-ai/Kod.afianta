const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const SITE_DIR = process.env.SITE_DIR || path.join(__dirname, "site");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "google/gemini-3.1-flash-lite-preview";
const PAID_AI_MODEL = process.env.PAID_AI_MODEL || process.env.AI_MODEL || "google/gemini-3-flash-preview";
const AI_API_BASE_URL = (process.env.AI_API_BASE_URL || "https://polza.ai/api/v1").replace(/\/$/, "");
const PAID_REPORT_STORE = process.env.PAID_REPORT_STORE || path.join(__dirname, "paid-reports.json");
const PRODUCT_PRICE_RUB = Number(process.env.PRODUCT_PRICE_RUB || 490);
const ADMIN_BASIC_AUTH = process.env.ADMIN_BASIC_AUTH || "";
const DEBUG_AI_REPORT = process.env.DEBUG_AI_REPORT === "1";
const reportCache = new Map();
const paidReportCache = new Map();

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

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.max(1, Math.min(5, Math.round(number)));
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

  return {
    name: clampText(answers.name, 80),
    birthDate: clampText(answers.birthDate, 40),
    relationshipStatus: clampText(answers.relationshipStatus, 80),
    mainProblem: clampText(answers.mainProblem, 80),
    problemDuration: clampText(answers.problemDuration, 80),
    goal: clampText(answers.goal, 80),
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
    scores,
    rules: {
      doNotEmphasizeRepeatingScenario: scores.repeatingScenario <= 2,
      doNotSayLongTime: answers.problemDuration === "less_than_month" || answers.problemDuration === "one_to_three_months",
      doNotSayEmotionalExhaustion: scores.emotionalTiredness <= 2,
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

function listOf(input, count, maxLength, fallback) {
  const source = Array.isArray(input) ? input : [];
  const output = source.map((item) => clampText(item, maxLength)).filter((item) => item.length >= 3);
  for (let index = output.length; index < count; index += 1) {
    output.push(fallback[index] || fallback[fallback.length - 1] || "");
  }
  return output.slice(0, count);
}

function normalizePaidReport(input, fallback) {
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

  if (report.intro.text.length < 20 || report.alexanderBlock.cycleExplanation.length < 20) {
    return null;
  }
  return report;
}

function buildPaidFallbackReport(context) {
  const name = context.name || "вас";
  const cycle = context.cycleTitle || "текущий сценарий отношений";
  const lifePath = context.lifePathTitle || "ваш личный код";
  return {
    intro: {
      text: `Этот разбор собран вокруг вашей текущей ситуации: ${cycle}. В нём важны не общие советы, а то, как именно напряжение запускается, чем поддерживается и какие первые действия помогут вернуть больше ясности без давления на партнёра.`,
    },
    annaBlock: {
      lifePathMeaning: `По цифровому анализу сейчас важно смотреть на ${lifePath} не как на ярлык, а как на способ реагировать в близости. В отношениях это проявляется в том, как вы ищете опору, ясность и подтверждение контакта.`,
      strongSide: "Ваша сильная сторона — способность замечать нюансы и не оставаться равнодушным к тому, что происходит между вами.",
      weakPoint: "Слабое место появляется там, где желание быстрее понять ситуацию превращается во внутреннее напряжение.",
      typicalMistake: "Типичная ошибка — пытаться получить ясность именно в тот момент, когда разговор уже перегружен эмоциями.",
      example: "Например, вопрос о чувствах партнёра может звучать как просьба о близости, но восприниматься как давление.",
      recommendation: "Сначала верните спокойный тон и короткий контакт, а уже потом переходите к сложным темам.",
    },
    alexanderBlock: {
      cycleExplanation: `Сценарий «${cycle}» чаще всего держится на связке тревоги, ожидания и попытки вернуть управляемость. Чем меньше тепла и ясности, тем сильнее хочется ускорить разговор, но именно ускорение может усиливать дистанцию.`,
      mainMechanism: "Главный механизм здесь — не сама проблема, а способ реагирования на неё. Когда внутри много неопределённости, человек начинает искать быстрый ответ, а партнёр может закрываться ещё сильнее.",
      howUserAmplifiesProblem: [
        "Слишком быстро переходите к серьёзному разговору, когда контакт ещё не восстановлен.",
        "Пытаетесь получить точный ответ там, где партнёр пока готов только к короткому обмену.",
        "Накручиваете себя паузами и начинаете говорить из тревоги, а не из спокойной позиции.",
      ],
      innerFeeling: `Внутри у ${name} может быть ощущение, что время уходит и нужно срочно что-то решать. Это чувство понятно, но именно оно часто делает тон тяжелее.`,
      mainMistake: "Главная ошибка — считать, что сильный разговор сразу вернёт близость. Иногда сначала нужно вернуть безопасность контакта.",
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
        "Не писать длинные сообщения из тревоги.",
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
        whyItMatters: "Близость часто возвращается через простые безопасные касания, а не через тяжёлый анализ отношений.",
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
        "Говорить из тревоги вместо ясной позиции.",
        "Требовать от партнёра немедленного ответа.",
        "Путать паузу в контакте с окончательным выводом.",
      ],
      usefulActions: [
        "Снижать накал перед разговором.",
        "Формулировать короткие и честные фразы.",
        "Отделять факты от догадок.",
      ],
      whenToBookDiagnosis: "Если ситуация повторяется, а ваши разговоры снова приходят к одному и тому же напряжению, полезно разобрать живой контекст глубже.",
      finalText: "Главная задача на ближайшие дни — не заставить отношения резко измениться, а перестать усиливать тот сценарий, который уже делает контакт тяжелее. Когда меняется тон и последовательность действий, появляется больше пространства для ясности.",
    },
  };
}

function buildPaidSystemPrompt() {
  return [
    "You create a paid personal relationship report in Russian.",
    "Return only valid JSON. Do not return HTML, JSX, Markdown, code fences or explanations.",
    "All string values must be natural Russian Cyrillic text.",
    "Style: mature, calm, precise, warm, practical. No mysticism. No diagnoses. No fear. No promises to save a relationship.",
    "Do not claim what the partner definitely thinks or feels. Use cautious wording.",
    "Avoid filler, repetitions and long paragraphs. The paid report must be deeper and more practical than a free preview.",
    "Do not use these repeated phrases: Сейчас важно увидеть главное; Дополнительно ситуацию усиливает; Вы уже видите два слоя; Полный разбор нужен.",
    "Respect low scores: if a score is 1-2, do not make that theme central.",
    "If emotionalTiredness is low, do not say the user is exhausted.",
    "If repeatingScenario is low, write softly that a scenario may be forming, not that it constantly repeats.",
    "The seven-day plan must have seven different days, different phrases and different expected results.",
    "JSON shape:",
    '{"intro":{"text":""},"annaBlock":{"lifePathMeaning":"","strongSide":"","weakPoint":"","typicalMistake":"","example":"","recommendation":""},"alexanderBlock":{"cycleExplanation":"","mainMechanism":"","howUserAmplifiesProblem":["","",""],"innerFeeling":"","mainMistake":"","whatToUnderstand":"","recommendation":""},"communicationBlock":{"badDialogueExample":{"userPhrase":"","partnerPhrase":"","userSecondPhrase":"","explanation":""},"betterPhrases":["","",""],"whatToStop":["","","",""],"whatToStart":["","","",""]},"sevenDayPlan":[{"day":1,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":2,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":3,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":4,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":5,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":6,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""},{"day":7,"title":"","whyItMatters":"","actions":["",""],"phraseOfDay":"","expectedResult":""}],"finalMemo":{"mistakes":["","",""],"usefulActions":["","",""],"whenToBookDiagnosis":"","finalText":""}}',
  ].join("\n");
}

function buildPaidUserPrompt(context) {
  return [
    "Create the paid report from this structured context. Generate only meaning texts inside the JSON fields.",
    "Do not repeat the free-report wording verbatim. Use the user scores and rules.",
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
      max_tokens: 4200,
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
  const report = normalizePaidReport(parsed, fallback);
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

    const context = buildPaidContext(body);
    if (!context.name || !context.birthDate || !context.lifePathNumber || !context.cycleTitle) {
      sendJson(res, 400, { error: "Invalid paid report context" });
      return;
    }

    const hash = typeof body.hash === "string" && body.hash.length >= 12
      ? body.hash
      : stableHash({ context, paymentId: paymentAccess.paymentId, orderId: paymentAccess.orderId });

    if (paidReportCache.has(hash)) {
      const cached = paidReportCache.get(hash);
      sendJson(res, 200, { report: cached.report, source: "paid_cache", hash, createdAt: cached.createdAt, model: cached.model });
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
    serveStatic(req, res);
  } catch (error) {
    console.error("[server]", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

loadPaidReportStore();

server.listen(PORT, () => {
  console.log(`KOD site server listening on ${PORT}`);
});
