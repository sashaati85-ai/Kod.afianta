(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var CACHE_PREFIX = "kod-free-report-ai:";
  var THREE_TO_SIX_DISTANCE_PHRASE = "Тема отдаления уже перестала выглядеть как случайный эпизод и начала влиять на ваше внутреннее состояние";
  var REPORT_KEYS = [
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

  function getState() {
    try {
      var raw = window.sessionStorage.getItem(FLOW_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.answers || !parsed.result) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function normalizeScore(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return 3;
    return Math.max(1, Math.min(5, Math.round(number)));
  }

  function getDictionaryValue(group, key, fallback) {
    var dictionaries = window.KOD_REPORT_DICTIONARIES || {};
    var map = dictionaries[group] || {};
    return map[key] || fallback || "";
  }

  function getLifePathInfo(number) {
    var dictionaries = window.KOD_REPORT_DICTIONARIES || {};
    return (dictionaries.lifePath && dictionaries.lifePath[number]) || {
      archetype: "Индивидуальный код",
      shortMeaning: "важны ясность, бережность и понимание своего сценария",
    };
  }

  function buildContext(state) {
    var answers = state.answers || {};
    var result = state.result || {};
    var anna = result.anna || {};
    var alexander = result.alexander || {};
    var lifePathNumber = Number(anna.lifePathNumber) || 0;
    var lifePath = getLifePathInfo(lifePathNumber);
    var durationLabel = getDictionaryValue("duration", answers.problemDuration, answers.problemDuration);
    var scores = {
      distanceHard: normalizeScore(answers.scaleAnxiety),
      control: normalizeScore(answers.scaleControl),
      silence: normalizeScore(answers.scaleSilence),
      emotionalTiredness: normalizeScore(answers.scaleFatigue),
      needClarity: normalizeScore(answers.scaleWaiting),
      repeatingScenario: normalizeScore(answers.scaleRepetition),
    };

    return {
      name: String(answers.name || "").trim(),
      birthDate: String(answers.birthDate || "").trim(),
      lifePathNumber: lifePathNumber,
      lifePathArchetype: lifePath.archetype,
      lifePathMeaning: lifePath.shortMeaning,
      currentSituation: getDictionaryValue(
        "relationshipStatus",
        answers.relationshipStatus,
        answers.relationshipStatus
      ),
      mainRequest: getDictionaryValue("mainProblem", answers.mainProblem, answers.mainProblem),
      duration: durationLabel,
      mainGoal: getDictionaryValue("goal", answers.goal, answers.goal),
      detectedCycle: alexander.title || alexander.scenarioKey || "",
      scores: scores,
      contextNote: String(answers.contextNote || "").trim(),
      rules: {
        doNotEmphasizeRepeatingScenario: scores.repeatingScenario <= 2,
        doNotSayLongTime: answers.problemDuration === "less_than_month" ||
          answers.problemDuration === "one_to_three_months" ||
          answers.problemDuration === "three_to_six_months" ||
          durationLabel === "1-3 месяца",
        threeToSixDistancePhrase: answers.problemDuration === "three_to_six_months",
        doNotSayEmotionalExhaustion: scores.emotionalTiredness <= 2,
        doNotMakeClaimsAboutPartner: true,
      },
    };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + stableStringify(value[key]);
    }).join(",") + "}";
  }

  function fallbackHash(input) {
    var hash = 5381;
    for (var i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    }
    return "h" + (hash >>> 0).toString(16);
  }

  async function makeHash(context) {
    var hashSource = stableStringify({
      birthDate: context.birthDate,
      name: context.name,
      scores: context.scores,
      detectedCycle: context.detectedCycle,
      mainGoal: context.mainGoal,
      mainRequest: context.mainRequest,
      currentSituation: context.currentSituation,
      duration: context.duration,
      contextNote: context.contextNote,
    });
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      var bytes = new TextEncoder().encode(hashSource);
      var digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }
    return fallbackHash(hashSource);
  }

  function isValidText(value, maxLength) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
  }

  function normalizeReport(data) {
    if (!data || typeof data !== "object") return null;
    var limits = {
      introText: 650,
      annaMeaningText: 750,
      annaRecommendation: 300,
      alexanderIntroText: 500,
      alexanderScenarioText: 750,
      alexanderRiskText: 650,
      alexanderInnerFeelingText: 450,
      alexanderRecommendation: 400,
      nextStepText: 650,
    };
    var output = {};
    for (var i = 0; i < REPORT_KEYS.length; i += 1) {
      var key = REPORT_KEYS[i];
      if (key === "paidReportTeaserItems") continue;
      if (!isValidText(data[key], limits[key])) return null;
      output[key] = data[key].trim();
    }
    if (!Array.isArray(data.paidReportTeaserItems) || data.paidReportTeaserItems.length !== 5) {
      return null;
    }
    output.paidReportTeaserItems = data.paidReportTeaserItems.map(function (item) {
      return String(item || "").trim();
    });
    if (output.paidReportTeaserItems.some(function (item) {
      return item.length === 0 || item.length > 140;
    })) {
      return null;
    }
    return output;
  }

  function replaceThreeToSixLongTime(text) {
    if (typeof text !== "string" || !/давно/i.test(text)) return text;
    return text
      .replace(/[^.!?]*давно[^.!?]*[.!?]?/gi, THREE_TO_SIX_DISTANCE_PHRASE + ".")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function applyThreeToSixRule(report, context) {
    if (!report || !context || !context.rules || !context.rules.threeToSixDistancePhrase) return report;
    Object.keys(report).forEach(function (key) {
      if (typeof report[key] === "string") {
        report[key] = replaceThreeToSixLongTime(report[key]);
      } else if (Array.isArray(report[key])) {
        report[key] = report[key].map(replaceThreeToSixLongTime);
      }
    });
    return report;
  }

  function findBlockByLabel(label) {
    var labels = Array.from(document.querySelectorAll(".result-section-label"));
    for (var i = 0; i < labels.length; i += 1) {
      if ((labels[i].textContent || "").trim() === label) {
        return labels[i].closest(".result-detail-block");
      }
    }
    return null;
  }

  function setText(element, text) {
    if (!element || !text) return;
    element.textContent = text;
    element.setAttribute("data-ai-free-report", "true");
  }

  function setInlineStrongText(container, prefix, text) {
    if (!container || !text) return;
    var strong = container.querySelector(".result-inline-strong");
    container.textContent = "";
    if (strong) {
      strong.textContent = prefix;
      container.appendChild(strong);
      container.appendChild(document.createTextNode(" " + text));
    } else {
      container.textContent = prefix + " " + text;
    }
    container.setAttribute("data-ai-free-report", "true");
  }

  function hideExtraParagraphs(container, keepFirst) {
    if (!container) return;
    var paragraphs = Array.from(container.querySelectorAll(".report-paragraph"));
    paragraphs.slice(keepFirst ? 1 : 0).forEach(function (paragraph) {
      paragraph.style.display = "none";
      paragraph.setAttribute("data-ai-free-report-hidden", "true");
    });
  }

  function applyReport(aiReport) {
    var hero = document.querySelector(".result-hero-card");
    if (hero) {
      var box = hero.querySelector(".result-emphasis-box");
      setText(box && box.querySelector(".report-lead"), aiReport.introText);
      hideExtraParagraphs(box, false);
    }

    var annaIntro = findBlockByLabel("Блок от Анны");
    setText(annaIntro && annaIntro.querySelector(".report-lead"), aiReport.annaMeaningText);
    hideExtraParagraphs(annaIntro, true);

    var annaRecommendation = Array.from(document.querySelectorAll(".result-emphasis-box .report-paragraph"))
      .find(function (node) {
        return (node.textContent || "").indexOf("Рекомендация от Анны:") !== -1;
      });
    setInlineStrongText(annaRecommendation, "Рекомендация от Анны:", aiReport.annaRecommendation);

    var alexIntro = findBlockByLabel("Вступление");
    setText(alexIntro && alexIntro.querySelector(".report-lead"), aiReport.alexanderIntroText);

    var alexScenario = findBlockByLabel("Основной сценарий");
    setText(alexScenario && alexScenario.querySelector(".report-paragraph"), aiReport.alexanderScenarioText);

    var alexRisk = findBlockByLabel("Где ситуация усиливается");
    setInlineStrongText(
      alexRisk && alexRisk.querySelector(".report-paragraph"),
      "Неочевидная ошибка:",
      aiReport.alexanderRiskText
    );

    var alexFeeling = findBlockByLabel("Внутреннее ощущение");
    setText(alexFeeling && alexFeeling.querySelector(".report-paragraph"), aiReport.alexanderInnerFeelingText);

    var alexRecommendation = Array.from(document.querySelectorAll(".result-emphasis-box .report-paragraph"))
      .find(function (node) {
        return (node.textContent || "").indexOf("Рекомендация от Александра:") !== -1;
      });
    setInlineStrongText(
      alexRecommendation,
      "Рекомендация от Александра:",
      aiReport.alexanderRecommendation
    );

    var reportCards = Array.from(document.querySelectorAll(".report-grid > *"));
    var nextStepCard = reportCards[2];
    setText(nextStepCard && nextStepCard.querySelector(".report-lead"), aiReport.nextStepText);
    hideExtraParagraphs(nextStepCard, true);

    var paidCard = reportCards[3];
    var teaserItems = paidCard ? Array.from(paidCard.querySelectorAll(".report-list-item")) : [];
    aiReport.paidReportTeaserItems.forEach(function (item, index) {
      setText(teaserItems[index], item);
    });

    document.documentElement.classList.add("ai-free-report-applied");
  }

  async function getAiReport(context, hash) {
    var cacheKey = CACHE_PREFIX + hash;
    try {
      var cached = window.localStorage.getItem(cacheKey);
      var parsed = cached ? normalizeReport(JSON.parse(cached)) : null;
      if (parsed) return applyThreeToSixRule(parsed, context);
    } catch (_) {}

    var response = await fetch("/api/generate-free-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: hash, context: context }),
    });
    if (!response.ok) throw new Error("AI report request failed");
    var payload = await response.json();
    var report = normalizeReport(payload.report || payload);
    if (!report) throw new Error("AI report JSON is invalid");
    report = applyThreeToSixRule(report, context);
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(report));
    } catch (_) {}
    return report;
  }

  var runningHash = "";
  async function run() {
    if (window.location.pathname !== "/result") return;
    var state = getState();
    if (!state) return;
    var context = buildContext(state);
    if (!context.lifePathNumber || !context.detectedCycle) return;
    var hash = await makeHash(context);
    if (runningHash === hash && document.documentElement.classList.contains("ai-free-report-applied")) {
      return;
    }
    runningHash = hash;
    try {
      var aiReport = await getAiReport(context, hash);
      applyReport(aiReport);
    } catch (error) {
      console.warn("[KOD] AI free report fallback:", error);
    }
  }

  function scheduleRun() {
    window.setTimeout(run, 250);
    window.setTimeout(run, 900);
  }

  var observer = new MutationObserver(function () {
    if (window.location.pathname === "/result") scheduleRun();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRun();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRun();
  }

  window.addEventListener("popstate", scheduleRun);
  window.addEventListener("hashchange", scheduleRun);
})();
