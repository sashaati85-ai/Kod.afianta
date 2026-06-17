(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var CACHE_PREFIX = "kod-free-report-template-v3:";
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

  function score(context, key) {
    return context && context.scores ? normalizeScore(context.scores[key]) : 3;
  }

  function strongestTheme(context) {
    var themes = relevantThemes(context);
    themes.sort(function (a, b) {
      return score(context, b.key) - score(context, a.key);
    });
    return themes[0];
  }

  function relevantThemes(context) {
    var themes = [
      { key: "needClarity", label: "потребность в ясности", text: "хочется быстрее понять перспективу отношений, но срочность может сделать разговор тяжелее" },
      { key: "distanceHard", label: "острая реакция на дистанцию", text: "дистанция воспринимается особенно болезненно, потому что теряется ощущение контакта" },
      { key: "control", label: "попытка вернуть управляемость", text: "в неопределённости появляется желание вернуть управляемость, но это может восприниматься как давление" },
      { key: "emotionalTiredness", label: "эмоциональная усталость", text: "накопилось внутреннее напряжение, и сил на неопределённость становится меньше" },
      { key: "repeatingScenario", label: "закрепляющаяся реакция", text: "какая-то реакция сейчас может постепенно стать привычной, если её не заметить вовремя" },
      { key: "silence", label: "паузы в контакте", text: "паузы в контакте могут оставлять слишком много пространства для догадок" },
    ].filter(function (theme) {
      return score(context, theme.key) >= 3;
    });
    if (!themes.length) {
      themes.push({ key: "needClarity", label: "потребность в ясности", text: "важно спокойнее понять, что между вами происходит на самом деле" });
    }
    return themes;
  }

  function secondaryTheme(context, primaryKey) {
    var themes = relevantThemes(context).filter(function (theme) {
      return theme.key !== primaryKey;
    });
    themes.sort(function (a, b) {
      return score(context, b.key) - score(context, a.key);
    });
    return themes[0] || { key: "distanceHard", text: "важно не усиливать напряжение резкими действиями" };
  }

  function durationInsight(context, request) {
    if (context && context.rules && context.rules.threeToSixDistancePhrase) {
      return "Тема " + request + " уже перестала выглядеть для вас случайным эпизодом и начала заметно влиять на внутреннее состояние.";
    }
    var duration = String((context && context.duration) || "").toLowerCase();
    if (duration.indexOf("меньше") !== -1 || duration.indexOf("less") !== -1) {
      return "Ситуация ещё не успела полностью закрепиться, поэтому сейчас особенно важно не усиливать её резкими действиями.";
    }
    if (duration.indexOf("1-3") !== -1 || duration.indexOf("тр") !== -1) {
      return "Напряжение уже начало повторяться, но его ещё можно разбирать без ощущения, что всё окончательно зашло в тупик.";
    }
    if (duration.indexOf("6") !== -1 || duration.indexOf("год") !== -1 || duration.indexOf("давно") !== -1) {
      return "Ситуация стала частью вашего эмоционального фона, поэтому важны не быстрые рывки, а более точное понимание сценария.";
    }
    return "По вашим ответам видно, что ситуация уже влияет не только на отношения, но и на ваше внутреннее состояние.";
  }

  function statusPhrase(context) {
    var status = String((context && context.currentSituation) || "").toLowerCase();
    if (status.indexOf("грани") !== -1) return "когда отношения ощущаются на грани";
    if (status.indexOf("расстав") !== -1 || status.indexOf("после") !== -1) return "когда формальный статус уже изменился, но внутренняя связь ещё не отпустила";
    if (status.indexOf("нет контакт") !== -1 || status.indexOf("контакта") !== -1) return "когда контакта мало и особенно трудно отделить факты от тревожных догадок";
    if (status.indexOf("неопредел") !== -1) return "когда статус связи остаётся неясным";
    return "когда связь ещё есть, но внутри неё стало больше напряжения";
  }

  function goalPhrase(context) {
    var goal = String((context && context.mainGoal) || "").toLowerCase();
    if (goal.indexOf("диалог") !== -1) return "вернуться к разговору без давления";
    if (goal.indexOf("понять") !== -1) return "лучше понять, что происходит между вами";
    if (goal.indexOf("напряж") !== -1) return "снизить напряжение и не ухудшать контакт";
    if (goal.indexOf("решен") !== -1 || goal.indexOf("решение") !== -1) return "принять решение из более спокойного состояния";
    if (goal.indexOf("контакт") !== -1) return "вернуть контакт бережно, без попытки дожать ситуацию";
    return "подойти к следующему шагу спокойнее и точнее";
  }

  function requestPhrase(context) {
    var request = String((context && context.mainRequest) || "").toLowerCase();
    if (request.indexOf("отдал") !== -1 || request.indexOf("холод") !== -1) return "отдаления и потери тепла";
    if (request.indexOf("конфликт") !== -1) return "повторяющихся конфликтов";
    if (request.indexOf("неяс") !== -1 || request.indexOf("подвеш") !== -1) return "неясности и подвешенности";
    if (request.indexOf("ревн") !== -1 || request.indexOf("недовер") !== -1) return "ревности и недоверия";
    if (request.indexOf("повтор") !== -1 || request.indexOf("сценар") !== -1) return "повторяющегося сценария";
    if (request.indexOf("потер") !== -1) return "страха потерять контакт";
    return String((context && context.mainRequest) || "вашей ситуации").toLowerCase();
  }

  function cycleTitle(context) {
    if (score(context, "needClarity") >= 4 && score(context, "distanceHard") >= 4) {
      return "ТРЕВОГА + ПОТРЕБНОСТЬ В ЯСНОСТИ";
    }
    if (score(context, "needClarity") >= 4) return "ЦИКЛ ТРЕВОГИ И ПОТРЕБНОСТИ В ЯСНОСТИ";
    if (score(context, "distanceHard") >= 4) return "ЦИКЛ ТРЕВОГИ НА ФОНЕ ДИСТАНЦИИ";
    if (score(context, "control") >= 4) return "ЦИКЛ ТРЕВОГИ И ПОПЫТКИ ВЕРНУТЬ КОНТРОЛЬ";
    return context.detectedCycle || "ТЕКУЩИЙ МЕХАНИЗМ НАПРЯЖЕНИЯ";
  }

  function controlNote(context) {
    if (score(context, "control") < 4) return "";
    return " На этом фоне может появляться желание быстрее вернуть управляемость, но именно срочность иногда делает разговор похожим на давление.";
  }

  function buildPersonalReport(context) {
    var name = context && context.name ? context.name + ", " : "";
    var primary = strongestTheme(context);
    var secondary = secondaryTheme(context, primary.key);
    var cycle = cycleTitle(context);
    var life = context.lifePathArchetype || "ваш личный код";
    var lifeMeaning = context.lifePathMeaning || "важны ясность, бережность и понимание своего сценария";
    var request = requestPhrase(context);
    var goal = goalPhrase(context);
    var duration = durationInsight(context, request);

    var introText = name + "по вашим ответам видно, что главная тема сейчас не просто в факте " + request + ". Важнее то, как эта ситуация действует на вас изнутри: " + primary.text + ". " + duration;

    var annaMeaningText = "По цифровой части разбора проявился код «" + life + "». Для вас в отношениях особенно значимо: " + lifeMeaning + ". Поэтому текущая ситуация может задевать не только чувства к партнёру, но и ощущение собственной устойчивости.";

    var annaRecommendation = "Сейчас полезно отделять реальный контакт от внутренних догадок. Сначала возвращайте себе спокойствие, а уже потом выбирайте слова и действия.";

    var alexanderIntroText = "Со стороны Александра эта ситуация читается как цикл: «" + cycle + "». Он может включаться, " + statusPhrase(context) + ".";

    var alexanderScenarioText = "Если коротко, внутри этого механизма есть два слоя. Первый: " + primary.text + ". Второй: " + secondary.text + "." + controlNote(context) + " Из-за этого разговор может становиться тяжелее ещё до того, как вы успеваете спокойно сказать главное.";

    var alexanderRiskText = score(context, "control") >= 4
      ? "пытаться получить ясность из тревоги. Тогда даже правильные слова могут звучать как давление, и партнёр может защищаться сильнее."
      : "слишком долго оставаться внутри ожидания и догадок. Тогда напряжение копится, а следующий разговор становится тяжелее, чем мог бы быть.";

    var alexanderInnerFeelingText = score(context, "emotionalTiredness") >= 4
      ? "Внутри это может ощущаться как усталость от неопределённости: хочется уже не красивых объяснений, а спокойного и честного понимания, что делать дальше."
      : "Внутри это может ощущаться как постоянное считывание сигналов: есть ли тепло, есть ли ответ, есть ли шанс на нормальный разговор.";

    var alexanderRecommendation = "Не превращайте каждую тревогу в срочное действие. Сначала сформулируйте, что именно вы хотите прояснить, и только потом выходите в контакт.";

    var nextStepText = "Этот бесплатный результат показывает верхний слой вашей ситуации. Такой цикл легче остановить, когда видно, в какой момент тревога превращается в давление. В полном разборе можно точнее увидеть, какие фразы помогут говорить спокойнее и как двигаться к цели: " + goal + ".";

    return applyThreeToSixRule({
      introText: introText,
      annaMeaningText: annaMeaningText,
      annaRecommendation: annaRecommendation,
      alexanderIntroText: alexanderIntroText,
      alexanderScenarioText: alexanderScenarioText,
      alexanderRiskText: alexanderRiskText,
      alexanderInnerFeelingText: alexanderInnerFeelingText,
      alexanderRecommendation: alexanderRecommendation,
      nextStepText: nextStepText,
      paidReportTeaserItems: [
        "Карта того, что сейчас происходит между вами",
        "Где вы непреднамеренно усиливаете напряжение",
        "Какие слова помогут говорить спокойнее",
        "Что лучше прекратить уже сейчас",
        "План действий на ближайшие 7 дней",
      ],
    }, context);
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

    var report = normalizeReport(buildPersonalReport(context));
    if (!report) throw new Error("AI report JSON is invalid");
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
