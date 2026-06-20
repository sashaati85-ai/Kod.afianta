(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var FLOW_BACKUP_KEY = "relationship-code-flow-backup";
  var PAYMENT_KEY = "relationship-code-payment-access";
  var CACHE_PREFIX = "kod-paid-report-ai-v3:";

  function readJsonStorage(storage, key) {
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function getState() {
    var state = readJsonStorage(window.sessionStorage, FLOW_KEY);
    if (!state || !state.answers || !state.result) {
      state = readJsonStorage(window.localStorage, FLOW_BACKUP_KEY);
      if (state && state.answers && state.result) {
        try {
          window.sessionStorage.setItem(FLOW_KEY, JSON.stringify(state));
        } catch (_) {}
      }
    }
    if (!state || !state.answers || !state.result) return null;
    return state;
  }

  function getPaymentAccess() {
    var access = readJsonStorage(window.localStorage, PAYMENT_KEY);
    if (!access || access.status !== "paid") return null;
    return access;
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
    for (var index = 0; index < input.length; index += 1) {
      hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
    }
    return "h" + (hash >>> 0).toString(16);
  }

  async function makeHash(state, access) {
    var source = stableStringify({
      answers: state.answers,
      result: state.result,
      orderId: access.orderId || "",
      paymentId: access.paymentId || ""
    });
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      var bytes = new TextEncoder().encode(source);
      var digest = await window.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest)).map(function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }
    return fallbackHash(source);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function appendText(parent, tag, className, text) {
    if (!text) return null;
    var node = el(tag, className, text);
    parent.appendChild(node);
    return node;
  }

  function appendList(parent, items) {
    var list = el("ul", "ai-paid-list");
    (items || []).forEach(function (item) {
      if (item) list.appendChild(el("li", "", item));
    });
    parent.appendChild(list);
    return list;
  }

  function mini(label, text) {
    var block = el("div", "ai-paid-mini");
    block.appendChild(el("strong", "", label));
    block.appendChild(el("p", "ai-paid-text", text));
    return block;
  }

  function setHeader(name) {
    var eyebrow = document.querySelector(".page-eyebrow");
    var title = document.querySelector(".page-title");
    var description = document.querySelector(".page-description");
    if (eyebrow) eyebrow.textContent = "Готовый платный отчёт";
    if (title) title.textContent = "Персональный отчёт: " + (name || "ваша ситуация");
    if (description) {
      description.textContent = "Глубокий разбор вашей ситуации, сценария, коммуникации и практических шагов на ближайшие 7 дней.";
    }
  }

  function isDebugMode() {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch (_) {
      return false;
    }
  }

  function renderStatus(main) {
    main.textContent = "";
    var shell = el("div", "ai-paid-report-status");
    var card = el("section", "ai-paid-report-status-card");
    card.appendChild(el("div", "ai-paid-status-kicker", "Подготовка отчёта"));
    card.appendChild(el("h1", "ai-paid-status-title", "Оформляем ваш персональный разбор"));
    card.appendChild(el("p", "ai-paid-status-text", "Собираем ответы анкеты, расчёты и рекомендации в единый полный отчёт. Обычно это занимает несколько секунд."));
    card.appendChild(el("div", "ai-paid-progress"));
    shell.appendChild(card);
    main.appendChild(shell);
  }

  function renderError(main) {
    var card = el("section", "ai-paid-error");
    card.textContent = "Подготовка заняла больше времени, чем обычно. Ваш доступ сохранён — обновите страницу через несколько секунд.";
    main.insertBefore(card, main.firstChild);
  }

  function renderReport(main, payload, state) {
    var report = payload.report;
    var answers = state.answers || {};
    var result = state.result || {};
    var anna = result.anna || {};
    var alexander = result.alexander || {};
    var source = payload.source || "paid_ai";

    setHeader(answers.name || "");
    main.textContent = "";

    var root = el("div", "ai-paid-report");
    root.setAttribute("data-paid-report-source", source);

    var hero = el("section", "ai-paid-hero");
    hero.appendChild(el("div", "ai-paid-kicker", "Персональный платный отчёт"));
    hero.appendChild(el("h1", "ai-paid-title", "Персональный отчёт: " + (answers.name || "ваша ситуация")));
    appendText(hero, "p", "ai-paid-lead", report.intro && report.intro.text);
    var meta = el("div", "ai-paid-meta");
    meta.appendChild(el("span", "", "Число пути: " + (anna.lifePathNumber || "—")));
    meta.appendChild(el("span", "", "Сценарий: " + (alexander.title || "текущий сценарий")));
    if (isDebugMode()) {
      meta.appendChild(el("span", "", "Источник: " + (source === "paid_cache" ? "сохранённый отчёт" : source === "paid_fallback" ? "резервный отчёт" : "AI-генерация")));
    }
    hero.appendChild(meta);
    root.appendChild(hero);

    var annaCard = el("section", "ai-paid-card");
    annaCard.appendChild(el("div", "ai-paid-kicker", "Блок от Анны"));
    annaCard.appendChild(el("h2", "", "Цифровой анализ личности"));
    appendText(annaCard, "p", "ai-paid-lead", report.annaBlock.lifePathMeaning);
    var annaGrid = el("div", "ai-paid-section-grid");
    annaGrid.appendChild(mini("Сильная сторона", report.annaBlock.strongSide));
    annaGrid.appendChild(mini("Уязвимое место", report.annaBlock.weakPoint));
    annaGrid.appendChild(mini("Типичная ошибка", report.annaBlock.typicalMistake));
    annaGrid.appendChild(mini("Пример", report.annaBlock.example));
    annaGrid.appendChild(mini("Рекомендация", report.annaBlock.recommendation));
    annaCard.appendChild(annaGrid);
    root.appendChild(annaCard);

    var alexCard = el("section", "ai-paid-card");
    alexCard.appendChild(el("div", "ai-paid-kicker", "Блок от Александра"));
    alexCard.appendChild(el("h2", "", "Психология вашего сценария"));
    appendText(alexCard, "p", "ai-paid-lead", report.alexanderBlock.cycleExplanation);
    alexCard.appendChild(mini("Главный механизм", report.alexanderBlock.mainMechanism));
    alexCard.appendChild(el("h3", "", "Где вы можете усиливать напряжение"));
    appendList(alexCard, report.alexanderBlock.howUserAmplifiesProblem);
    var alexGrid = el("div", "ai-paid-section-grid");
    alexGrid.appendChild(mini("Внутреннее ощущение", report.alexanderBlock.innerFeeling));
    alexGrid.appendChild(mini("Главная ошибка", report.alexanderBlock.mainMistake));
    alexGrid.appendChild(mini("Что важно понять", report.alexanderBlock.whatToUnderstand));
    alexGrid.appendChild(mini("Рекомендация", report.alexanderBlock.recommendation));
    alexCard.appendChild(alexGrid);
    root.appendChild(alexCard);

    var communication = el("section", "ai-paid-card");
    communication.appendChild(el("div", "ai-paid-kicker", "Коммуникация"));
    communication.appendChild(el("h2", "", "Как говорить, чтобы не усиливать дистанцию"));
    var dialogue = el("div", "ai-paid-dialogue");
    dialogue.appendChild(el("p", "", "Вы: " + report.communicationBlock.badDialogueExample.userPhrase));
    dialogue.appendChild(el("p", "", "Партнёр: " + report.communicationBlock.badDialogueExample.partnerPhrase));
    dialogue.appendChild(el("p", "", "Вы: " + report.communicationBlock.badDialogueExample.userSecondPhrase));
    dialogue.appendChild(el("p", "", report.communicationBlock.badDialogueExample.explanation));
    communication.appendChild(dialogue);
    communication.appendChild(el("h3", "", "Лучшие фразы"));
    appendList(communication, report.communicationBlock.betterPhrases);
    var communicationGrid = el("div", "ai-paid-section-grid");
    var stop = mini("Что прекратить", "");
    stop.querySelector("p").remove();
    appendList(stop, report.communicationBlock.whatToStop);
    var start = mini("Что начать", "");
    start.querySelector("p").remove();
    appendList(start, report.communicationBlock.whatToStart);
    communicationGrid.appendChild(stop);
    communicationGrid.appendChild(start);
    communication.appendChild(communicationGrid);
    root.appendChild(communication);

    var planCard = el("section", "ai-paid-card");
    planCard.appendChild(el("div", "ai-paid-kicker", "Практика"));
    planCard.appendChild(el("h2", "", "План на 7 дней"));
    var plan = el("div", "ai-paid-plan");
    (report.sevenDayPlan || []).forEach(function (day) {
      var dayCard = el("article", "ai-paid-day");
      dayCard.appendChild(el("div", "ai-paid-day-number", String(day.day).padStart(2, "0")));
      dayCard.appendChild(el("h3", "", day.title));
      appendText(dayCard, "p", "ai-paid-text", day.whyItMatters);
      appendList(dayCard, day.actions);
      appendText(dayCard, "p", "ai-paid-text", "Фраза дня: " + day.phraseOfDay);
      appendText(dayCard, "p", "ai-paid-text", "Ожидаемый результат: " + day.expectedResult);
      plan.appendChild(dayCard);
    });
    planCard.appendChild(plan);
    root.appendChild(planCard);

    var finalCard = el("section", "ai-paid-card");
    finalCard.appendChild(el("div", "ai-paid-kicker", "Финальная памятка"));
    finalCard.appendChild(el("h2", "", "Что удержать в фокусе"));
    var finalGrid = el("div", "ai-paid-section-grid");
    var mistakes = mini("Ошибки", "");
    mistakes.querySelector("p").remove();
    appendList(mistakes, report.finalMemo.mistakes);
    var useful = mini("Полезные действия", "");
    useful.querySelector("p").remove();
    appendList(useful, report.finalMemo.usefulActions);
    finalGrid.appendChild(mistakes);
    finalGrid.appendChild(useful);
    finalCard.appendChild(finalGrid);
    appendText(finalCard, "p", "ai-paid-lead", report.finalMemo.whenToBookDiagnosis);
    appendText(finalCard, "p", "ai-paid-text", report.finalMemo.finalText);
    root.appendChild(finalCard);

    main.appendChild(root);
    if (source === "paid_fallback" && isDebugMode()) renderError(main);
  }

  renderStatus = function (main) {
    main.textContent = "";
    var shell = el("div", "ai-paid-report-status");
    var card = el("section", "ai-paid-report-status-card ai-paid-preparing");
    var visual = el("div", "ai-paid-preparing-visual");
    var logo = document.createElement("img");
    logo.className = "ai-paid-preparing-logo";
    logo.src = "/assets/logo-gold-DMOg8YAH.png";
    logo.alt = "Александр и Анна";
    visual.appendChild(logo);
    ["♡", "♥", "♡", "♥", "♡", "♥"].forEach(function (heart, index) {
      var node = el("span", "ai-paid-preparing-heart ai-paid-preparing-heart-" + (index + 1), heart);
      node.setAttribute("aria-hidden", "true");
      visual.appendChild(node);
    });
    card.appendChild(visual);
    card.appendChild(el("div", "ai-paid-status-kicker", "Подготовка отчёта"));
    card.appendChild(el("h1", "ai-paid-status-title", "Оформляем ваш персональный разбор"));
    card.appendChild(el("p", "ai-paid-status-text", "Собираем ответы анкеты, расчёты и рекомендации в единый полный отчёт. Обычно это занимает несколько секунд."));
    card.appendChild(el("div", "ai-paid-progress"));
    shell.appendChild(card);
    main.appendChild(shell);
  };

  renderError = function (main) {
    var card = el("section", "ai-paid-error");
    card.textContent = "Подготовка заняла больше времени, чем обычно. Ваш доступ сохранён — обновите страницу через несколько секунд.";
    main.insertBefore(card, main.firstChild);
  };

  function isValidReportPayload(payload) {
    return Boolean(
      payload &&
      payload.report &&
      payload.report.intro &&
      payload.report.annaBlock &&
      payload.report.alexanderBlock &&
      payload.report.communicationBlock &&
      Array.isArray(payload.report.sevenDayPlan) &&
      payload.report.finalMemo
    );
  }

  async function fetchPaidReport(state, access, hash) {
    var cacheKey = CACHE_PREFIX + hash;
    try {
      var cached = readJsonStorage(window.localStorage, cacheKey);
      if (isValidReportPayload(cached)) return Object.assign({}, cached, { source: "paid_cache" });
    } catch (_) {}

    var response = await fetch("/api/generate-paid-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hash: hash,
        answers: state.answers,
        result: state.result,
        paymentAccess: access
      })
    });
    if (!response.ok) throw new Error("Paid report request failed");
    var payload = await response.json();
    if (!isValidReportPayload(payload)) throw new Error("Paid report JSON is invalid");
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch (_) {}
    return payload;
  }

  var runningHash = "";
  var runningPromise = null;
  async function run() {
    if (window.location.pathname.replace(/\/$/, "") !== "/full-report") return;
    var state = getState();
    var access = getPaymentAccess();
    var main = document.querySelector(".page-main");
    if (!state || !access || !main) return;

    var hash = await makeHash(state, access);
    if (runningHash === hash && runningPromise) return runningPromise;
    if (runningHash === hash && document.querySelector(".ai-paid-report")) return;
    runningHash = hash;

    renderStatus(main);
    runningPromise = (async function () {
      try {
        var payload = await fetchPaidReport(state, access, hash);
        renderReport(main, payload, state);
      } catch (error) {
        runningHash = "";
        console.warn("[KOD] paid AI report fallback:", error);
        renderError(main);
      } finally {
        runningPromise = null;
      }
    })();
    return runningPromise;
  }

  function scheduleRun() {
    window.setTimeout(run, 200);
    window.setTimeout(run, 900);
  }

  var observer = new MutationObserver(function () {
    if (window.location.pathname.replace(/\/$/, "") === "/full-report" && !document.querySelector(".ai-paid-report")) {
      scheduleRun();
    }
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
