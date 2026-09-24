(function () {
  "use strict";

  var FLOW_KEY = "kod-diagnostic-format-flow-v1";
  var CONSENT_VERSION = "2026-06-21";
  var MANAGED_PATHS = ["/diagnostic-format", "/questionnaire", "/result"];
  var DEFAULT_ANSWERS = {
    name: "",
    birthDate: "",
    relationshipStatus: "",
    mainProblem: "",
    problemDuration: "",
    goal: ""
  };
  var QUESTIONS = [
    {
      key: "relationshipStatus",
      title: "Что сейчас происходит в ваших отношениях?",
      options: [
        ["in_relationship", "В отношениях", "Контакт есть, но в нём много напряжения"],
        ["on_the_edge", "На грани расставания", "Связь ослабла, разговоры даются тяжело"],
        ["after_breakup", "После расставания", "Отношения завершились, но эмоционально тема не закрыта"],
        ["unclear", "Сложная неопределённость", "Нет ясности, что между вами происходит"],
        ["no_contact", "Общение прервалось", "Связь резко сократилась или исчезла"]
      ]
    },
    {
      key: "mainProblem",
      title: "Что беспокоит вас больше всего?",
      options: [
        ["distance", "Отдаление", "Стало меньше тепла, внимания или инициативы"],
        ["conflicts", "Повторяющиеся конфликты", "Одни и те же темы возвращаются снова"],
        ["uncertainty", "Отсутствие ясности", "Непонятно, как трактовать ситуацию"],
        ["jealousy", "Ревность и недоверие", "Много напряжения вокруг лояльности и сигналов"],
        ["repeating_pattern", "Один и тот же сценарий", "Связь как будто застряла в круге"],
        ["fear_of_loss", "Страх потери", "Тревога о расставании занимает слишком много места"]
      ]
    },
    {
      key: "problemDuration",
      title: "Как долго длится эта ситуация?",
      options: [
        ["lt_1m", "Меньше месяца", ""],
        ["1_3m", "1–3 месяца", ""],
        ["3_6m", "3–6 месяцев", ""],
        ["gt_6m", "Больше полугода", ""]
      ]
    },
    {
      key: "goal",
      title: "Что для вас сейчас важнее всего?",
      options: [
        ["restore_dialogue", "Восстановить диалог", "Вернуть спокойный контакт"],
        ["understand_perspective", "Понять перспективу", "Трезво оценить шансы и реальность"],
        ["reduce_tension", "Снизить напряжение", "Перестать усиливать конфликт"],
        ["break_pattern", "Выйти из сценария", "Перестать повторять один и тот же круг"],
        ["prepare_conversation", "Подготовиться к разговору", "Понять, как говорить без давления"]
      ]
    }
  ];
  var CODE_MEANINGS = {
    1: ["Инициатор", "Вам важны ясность, движение и ощущение, что отношения не стоят на месте."],
    2: ["Резонанс", "Вы тонко замечаете перемены в интонации, настроении и эмоциональном фоне."],
    3: ["Коммуникатор", "Для вас близость тесно связана с живым диалогом и ощущением контакта."],
    4: ["Опора", "Вам важны стабильность, предсказуемость и понятные правила взаимодействия."],
    5: ["Динамика", "Вы живо реагируете на изменения и трудно переносите эмоциональный застой."],
    6: ["Забота", "Вы склонны глубоко вкладываться и чувствовать ответственность за качество связи."],
    7: ["Глубина", "Вы проживаете чувства глубоко и часто сначала пытаетесь понять всё внутри себя."],
    8: ["Сила", "Вам важны серьёзность решений и ощущение управляемости ситуации."],
    9: ["Смысл", "Вы ищете в отношениях глубину, завершённость и особую значимость связи."],
    11: ["Интуитивная чувствительность", "Вы особенно тонко считываете эмоциональные сигналы и перемены в контакте."],
    22: ["Системный архитектор", "Вы видите отношения как систему, где важны устойчивость, взрослость и долгий результат."]
  };

  function path() {
    return window.location.pathname.replace(/\/+$/, "") || "/";
  }

  function isManagedPath() {
    return MANAGED_PATHS.indexOf(path()) !== -1;
  }

  function readJson(key, fallback) {
    try {
      var value = window.sessionStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getUtm() {
    var saved = readJson(FLOW_KEY, null);
    var params = new URLSearchParams(window.location.search);
    var utm = saved && saved.utm && typeof saved.utm === "object" ? Object.assign({}, saved.utm) : {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (key) {
      var value = params.get(key);
      if (value) utm[key] = value.slice(0, 180);
    });
    return utm;
  }

  function getState() {
    var saved = readJson(FLOW_KEY, {});
    return {
      format: saved.format === "code" || saved.format === "psychology" ? saved.format : "",
      stage: saved.stage || "format",
      answers: Object.assign({}, DEFAULT_ANSWERS, saved.answers || {}),
      questionIndex: Math.max(0, Math.min(QUESTIONS.length - 1, Number(saved.questionIndex) || 0)),
      code: Number(saved.code) || 0,
      completedQuestions: Boolean(saved.completedQuestions),
      utm: saved.utm && typeof saved.utm === "object" ? saved.utm : getUtm()
    };
  }

  function saveState(state) {
    state.utm = state.utm || getUtm();
    window.sessionStorage.setItem(FLOW_KEY, JSON.stringify(state));
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'\"]/g, function (symbol) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[symbol];
    });
  }

  function track(name, params) {
    var payload = Object.assign({ event: name, format: getState().format || undefined }, params || {});
    window.dispatchEvent(new CustomEvent("kod:analytics", { detail: payload }));
    if (Array.isArray(window.dataLayer)) window.dataLayer.push(payload);
  }

  function go(nextPath) {
    window.history.pushState({}, "", nextPath);
    render();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function getRoot() {
    var root = document.querySelector(".kod-diagnostic-funnel");
    if (!root) {
      root = document.createElement("main");
      root.className = "kod-diagnostic-funnel";
      root.setAttribute("aria-live", "polite");
      document.body.appendChild(root);
    }
    return root;
  }

  function setManagedMode(active) {
    document.documentElement.classList.toggle("kod-diagnostic-funnel-active", active);
    var root = getRoot();
    root.hidden = !active;
  }

  function pageShell(content, options) {
    options = options || {};
    var back = options.back
      ? '<button class="kod-flow-back" type="button" data-kod-action="back">← <span>Назад</span></button>'
      : "";
    return (
      '<div class="kod-flow-page">' +
        '<section class="kod-flow-shell">' +
          back +
          '<p class="kod-flow-eyebrow">' + escapeHtml(options.eyebrow || "Код отношений") + '</p>' +
          content +
        "</section>" +
      "</div>"
    );
  }

  function formatPage() {
    return pageShell(
      '<header class="kod-flow-heading">' +
        '<h1>Как вы хотите пройти диагностику?</h1>' +
        '<p>Выберите удобный формат. Вы сможете изменить решение позже.</p>' +
      '</header>' +
      '<div class="kod-format-options">' +
        '<article class="kod-format-option">' +
          '<span class="kod-format-number">01</span>' +
          '<h2>Психологический разбор</h2>' +
          '<p>Ответьте на несколько вопросов о ваших отношениях и получите психологический разбор вашей ситуации.</p>' +
          '<small>Имя и дата рождения не нужны.</small>' +
          '<button class="kod-flow-button kod-flow-button-secondary" type="button" data-kod-format="psychology">Пройти психологический разбор</button>' +
        '</article>' +
        '<article class="kod-format-option">' +
          '<span class="kod-format-number">02</span>' +
          '<h2>Психология + персональный код</h2>' +
          '<p>К психологическому разбору добавим цифровой анализ личности и сформируем ваш персональный код.</p>' +
          '<small>Для расчёта понадобятся имя и дата рождения.</small>' +
          '<button class="kod-flow-button kod-flow-button-secondary" type="button" data-kod-format="code">Рассчитать мой код</button>' +
        '</article>' +
      '</div>',
      { back: true, eyebrow: "Диагностика" }
    );
  }

  function profilePage(state) {
    var error = state.profileError || "";
    return pageShell(
      '<header class="kod-flow-heading">' +
        '<h1>Сформируем ваш персональный код</h1>' +
        '<p>Для дополнительного цифрового анализа личности понадобятся ваше имя и дата рождения. Эти данные используются для формирования персонального кода, который будет сопоставлен с результатами психологической диагностики.</p>' +
        '<small class="kod-flow-duration">Это займёт меньше минуты.</small>' +
      '</header>' +
      '<form class="kod-profile-form" novalidate>' +
        '<label><span>Как к вам обращаться?</span><input name="name" autocomplete="name" value="' + escapeHtml(state.answers.name) + '" placeholder="Имя" /></label>' +
        '<label><span>Дата рождения</span><input name="birthDate" inputmode="numeric" autocomplete="bday" value="' + escapeHtml(state.answers.birthDate) + '" placeholder="ДД.ММ.ГГГГ" maxlength="10" /></label>' +
        '<p class="kod-profile-help">Укажите имя, чтобы мы могли обращаться к вам в персональном разборе.</p>' +
        '<label class="kod-consent-row"><input name="consent" type="checkbox" ' + (state.consent ? "checked" : "") + ' /><span>Я ознакомлен(а) с <a href="/privacy" target="_blank" rel="noopener">Политикой обработки персональных данных</a> и даю <a href="/personal-data-consent" target="_blank" rel="noopener">согласие на обработку персональных данных</a>.</span></label>' +
        (error ? '<p class="kod-form-error">' + escapeHtml(error) + "</p>" : "") +
        '<button class="kod-flow-button" type="submit">Сформировать код</button>' +
      '</form>',
      { back: true, eyebrow: "Персональный код" }
    );
  }

  function codeReadyPage(state) {
    var name = escapeHtml(state.answers.name || "Ваш");
    var nextLabel = state.completedQuestions ? "Добавить к разбору" : "Продолжить диагностику";
    return pageShell(
      '<section class="kod-code-ready">' +
        '<span class="kod-code-seal" aria-hidden="true">' + escapeHtml(state.code) + "</span>" +
        '<h1>' + name + ', ваш персональный код сформирован</h1>' +
        '<p>Теперь уточним, что происходит именно в ваших отношениях. Это позволит сопоставить особенности личности с вашей текущей ситуацией.</p>' +
        '<button class="kod-flow-button" type="button" data-kod-action="continue-code">' + nextLabel + "</button>" +
      "</section>",
      { back: true, eyebrow: "Персональный код" }
    );
  }

  function questionPage(state) {
    var question = QUESTIONS[state.questionIndex];
    var progress = Math.round(((state.questionIndex + 1) / QUESTIONS.length) * 100);
    var options = question.options.map(function (option) {
      var selected = state.answers[question.key] === option[0];
      return (
        '<button class="kod-question-option' + (selected ? " is-selected" : "") + '" type="button" data-kod-choice="' + option[0] + '">' +
          '<strong>' + option[1] + "</strong>" +
          (option[2] ? "<span>" + option[2] + "</span>" : "") +
        "</button>"
      );
    }).join("");
    return pageShell(
      '<div class="kod-question-progress"><span>Вопрос ' + (state.questionIndex + 1) + " из " + QUESTIONS.length + '</span><div><i style="width:' + progress + '%"></i></div></div>' +
      '<header class="kod-flow-heading kod-question-heading"><h1>' + question.title + "</h1></header>" +
      '<div class="kod-question-options">' + options + "</div>",
      { back: true, eyebrow: "Психологический разбор" }
    );
  }

  function labelFor(key, value) {
    for (var i = 0; i < QUESTIONS.length; i += 1) {
      if (QUESTIONS[i].key !== key) continue;
      var option = QUESTIONS[i].options.find(function (item) { return item[0] === value; });
      return option ? option[1] : "";
    }
    return "";
  }

  function scoresFor(answers) {
    var status = answers.relationshipStatus;
    var problem = answers.mainProblem;
    var duration = answers.problemDuration;
    var goal = answers.goal;
    return {
      distanceHard: problem === "distance" || problem === "fear_of_loss" || status === "no_contact" ? 5 : status === "on_the_edge" ? 4 : 3,
      control: status === "unclear" || status === "on_the_edge" || goal === "understand_perspective" ? 4 : 2,
      silence: status === "no_contact" ? 4 : 2,
      emotionalTiredness: problem === "conflicts" || duration === "gt_6m" ? 4 : 2,
      needClarity: problem === "uncertainty" || goal === "understand_perspective" || status === "unclear" ? 5 : 3,
      repeatingScenario: problem === "repeating_pattern" || (problem === "conflicts" && duration === "gt_6m") ? 4 : 2
    };
  }

  function buildReport(state) {
    var answers = state.answers;
    var scores = scoresFor(answers);
    var scenario = "Тревога и потребность в ясности";
    var summary = "Когда в отношениях становится меньше ясности или тепла, хочется быстрее понять, что происходит. Эта срочность может делать разговор тяжелее ещё до того, как вы успеваете сказать главное.";
    if (answers.mainProblem === "distance" || answers.mainProblem === "fear_of_loss") {
      scenario = "Дистанция и поиск контакта";
      summary = "Дистанция воспринимается особенно болезненно, потому что теряется ощущение контакта. В такой момент легко искать подтверждение близости слишком срочно.";
    } else if (answers.mainProblem === "conflicts") {
      scenario = "Напряжение в повторяющихся конфликтах";
      summary = "В отношениях может закрепляться способ разговаривать, после которого остаётся больше напряжения, чем ясности. Важно заметить, в какой момент обсуждение уходит от сути.";
    } else if (answers.mainProblem === "jealousy") {
      scenario = "Тревога вокруг доверия";
      summary = "Неясные сигналы могут быстро превращаться в догадки. Это усиливает тревогу и мешает отделить реальные факты от того, чего вы боитесь.";
    } else if (answers.mainProblem === "repeating_pattern") {
      scenario = "Реакция, которая может закрепиться";
      summary = "Сейчас полезно увидеть, какая реакция постепенно становится привычной. Это даёт возможность выбрать другой шаг до того, как ситуация начнёт повторяться автоматически.";
    }
    var reasons = answers.relationshipStatus === "unclear"
      ? "Неопределённость оставляет слишком много места для догадок. Поэтому желание быстрее вернуть управляемость может ощущаться особенно сильно."
      : "На фоне сложной ситуации разговор может становиться короче, холоднее или осторожнее. Это не говорит точно о чувствах партнёра, но может усиливать вашу тревогу.";
    var loss = scores.control >= 4
      ? "В попытке быстро вернуть ясность можно начать действовать из тревоги. Тогда даже спокойный по смыслу вопрос может прозвучать как давление."
      : "Слишком много внутренней работы может уходить на ожидание и трактовку сигналов. Важно оставить место для фактов и собственного спокойствия.";
    var steps = [
      "Не превращайте каждую тревогу в срочное сообщение. Сначала выдохните и назовите себе, что именно вас задело.",
      "Перед разговором отделите факт от предположения: что вы знаете точно, а что пока только чувствуете.",
      "Сформулируйте один спокойный вопрос, который помогает прояснить ситуацию, а не снять напряжение на минуту."
    ];
    return { scenario: scenario, summary: summary, reasons: reasons, loss: loss, steps: steps, scores: scores };
  }

  function resultPage(state) {
    var report = buildReport(state);
    var codeBlock = "";
    if (state.format === "code" && state.code) {
      var meaning = CODE_MEANINGS[state.code] || CODE_MEANINGS[1];
      codeBlock =
        '<section class="kod-report-code">' +
          '<p class="kod-report-label">Что добавляет ваш персональный код</p>' +
          '<div class="kod-report-code-number">' + state.code + "</div>" +
          '<h2>' + meaning[0] + "</h2>" +
          '<p>' + meaning[1] + " Это дополнительный авторский инструмент, который помогает внимательнее посмотреть на личный стиль в отношениях.</p>" +
        "</section>";
    }
    var addCode = state.format === "psychology"
      ? '<section class="kod-report-add-code"><h2>Хотите дополнить разбор персональным кодом?</h2><p>Можно дополнительно сопоставить результат психологической диагностики с особенностями личности по цифровому анализу.</p><button class="kod-flow-button kod-flow-button-secondary" type="button" data-kod-action="add-code">Добавить персональный код</button></section>'
      : "";
    return pageShell(
      '<header class="kod-report-heading">' +
        '<p>Ваш психологический результат</p>' +
        '<h1>' + report.scenario + "</h1>" +
        '<div class="kod-report-summary">' + report.summary + "</div>" +
      "</header>" +
      '<div class="kod-report-grid">' +
        '<section><p class="kod-report-label">Что может происходить</p><p>' + report.reasons + "</p></section>" +
        '<section><p class="kod-report-label">Где усиливается напряжение</p><p>' + report.loss + "</p></section>" +
      "</div>" +
      '<section class="kod-report-steps"><p class="kod-report-label">Первые безопасные шаги</p><ol>' + report.steps.map(function (step) { return "<li>" + step + "</li>"; }).join("") + "</ol></section>" +
      codeBlock +
      addCode +
      '<section class="kod-report-invitation">' +
        '<h2>Хотите разобраться глубже?</h2>' +
        '<p>Этот результат показывает направление, но не может полностью определить, почему именно такой сценарий сформировался в вашей паре. На бесплатной диагностической встрече мы подробнее разберём вашу ситуацию и определим возможные следующие шаги.</p>' +
        '<button class="kod-flow-button" type="button" data-kod-action="lead">Записаться на бесплатную диагностику</button>' +
      "</section>",
      { back: true, eyebrow: "Код отношений" }
    );
  }

  function recordPersonalDataConsent() {
    var payload = {
      consentId: window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : "consent-" + Date.now(),
      occurredAt: new Date().toISOString(),
      page: "/questionnaire",
      formId: "diagnostic-format-code",
      version: CONSENT_VERSION,
      documents: [{ type: "personal_data", version: CONSENT_VERSION, accepted: true, textId: "personal-data-consent" }]
    };
    return fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () { return null; });
  }

  function normalizeDate(value) {
    var digits = String(value || "").replace(/\D/g, "").slice(0, 8);
    var parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
    return parts.join(".");
  }

  function validDate(value) {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return false;
    var parts = value.split(".").map(Number);
    var date = new Date(parts[2], parts[1] - 1, parts[0]);
    return date.getFullYear() === parts[2] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[0];
  }

  function calculateCode(birthDate) {
    var sum = String(birthDate || "").replace(/\D/g, "").split("").reduce(function (total, digit) { return total + Number(digit); }, 0);
    while (sum > 9 && sum !== 11 && sum !== 22) {
      sum = String(sum).split("").reduce(function (total, digit) { return total + Number(digit); }, 0);
    }
    return sum || 1;
  }

  function routeBack(state) {
    if (path() === "/diagnostic-format") {
      window.location.assign("/");
      return;
    }
    if (path() === "/result") {
      state.stage = "questions";
      state.questionIndex = QUESTIONS.length - 1;
      saveState(state);
      go("/questionnaire");
      return;
    }
    if (state.stage === "profile") {
      state.stage = "format";
      saveState(state);
      go("/diagnostic-format");
      return;
    }
    if (state.stage === "code-ready") {
      state.stage = state.completedQuestions ? "result" : "profile";
      saveState(state);
      go(state.completedQuestions ? "/result" : "/questionnaire");
      return;
    }
    if (state.questionIndex > 0) {
      state.questionIndex -= 1;
      saveState(state);
      render();
      return;
    }
    if (state.format === "code") {
      state.stage = "code-ready";
      saveState(state);
      render();
      return;
    }
    state.stage = "format";
    saveState(state);
    go("/diagnostic-format");
  }

  function openLead(state) {
    var report = buildReport(state);
    var params = new URLSearchParams();
    params.set("source", "diagnostic");
    params.set("format", state.format);
    params.set("scenario", report.scenario.slice(0, 72));
    Object.keys(state.utm || {}).forEach(function (key) { params.set(key, state.utm[key]); });
    window.sessionStorage.setItem("kod-diagnostic-contact-context", JSON.stringify({
      format: state.format,
      scenario: report.scenario,
      source: "diagnostic",
      utm: state.utm || {}
    }));
    track("diagnostic_booking_click", { scenario: report.scenario });
    window.location.assign("/lead?" + params.toString());
  }

  function bindEvents(root, state) {
    var formatButtons = root.querySelectorAll("[data-kod-format]");
    formatButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.format = button.getAttribute("data-kod-format");
        state.stage = state.format === "code" ? "profile" : "questions";
        state.questionIndex = 0;
        state.completedQuestions = false;
        state.answers = Object.assign({}, DEFAULT_ANSWERS);
        state.code = 0;
        state.profileError = "";
        state.consent = false;
        saveState(state);
        track(state.format === "code" ? "diagnostic_format_code_selected" : "diagnostic_format_psychology_selected");
        track("diagnostic_started", { format: state.format });
        go("/questionnaire");
      });
    });

    root.querySelectorAll("[data-kod-action='back']").forEach(function (button) {
      button.addEventListener("click", function () { routeBack(state); });
    });

    var profile = root.querySelector(".kod-profile-form");
    if (profile) {
      var dateInput = profile.elements.birthDate;
      dateInput.addEventListener("input", function () { dateInput.value = normalizeDate(dateInput.value); });
      profile.addEventListener("submit", function (event) {
        event.preventDefault();
        state.answers.name = String(profile.elements.name.value || "").trim().slice(0, 80);
        state.answers.birthDate = normalizeDate(profile.elements.birthDate.value);
        state.consent = Boolean(profile.elements.consent.checked);
        state.profileError = "";
        if (!state.answers.name) state.profileError = "Укажите имя, чтобы продолжить.";
        else if (!validDate(state.answers.birthDate)) state.profileError = "Введите дату в формате ДД.ММ.ГГГГ.";
        else if (!state.consent) state.profileError = "Подтвердите согласие на обработку персональных данных.";
        if (state.profileError) {
          saveState(state);
          render();
          return;
        }
        state.code = calculateCode(state.answers.birthDate);
        state.stage = "code-ready";
        saveState(state);
        track("diagnostic_name_entered");
        track("diagnostic_birth_date_entered");
        track("diagnostic_code_calculated", { code: state.code });
        recordPersonalDataConsent().finally(function () { render(); });
      });
    }

    root.querySelectorAll("[data-kod-action='continue-code']").forEach(function (button) {
      button.addEventListener("click", function () {
        state.stage = state.completedQuestions ? "result" : "questions";
        saveState(state);
        go(state.completedQuestions ? "/result" : "/questionnaire");
      });
    });

    root.querySelectorAll("[data-kod-choice]").forEach(function (button) {
      button.addEventListener("click", function () {
        var question = QUESTIONS[state.questionIndex];
        state.answers[question.key] = button.getAttribute("data-kod-choice");
        track("diagnostic_question_completed", { question: state.questionIndex + 1, key: question.key });
        if (state.questionIndex < QUESTIONS.length - 1) {
          state.questionIndex += 1;
          saveState(state);
          window.setTimeout(render, 140);
          return;
        }
        state.completedQuestions = true;
        state.stage = "result";
        saveState(state);
        track(state.format === "code" ? "diagnostic_result_with_code_opened" : "diagnostic_psychology_result_opened");
        window.setTimeout(function () { go("/result"); }, 140);
      });
    });

    root.querySelectorAll("[data-kod-action='add-code']").forEach(function (button) {
      button.addEventListener("click", function () {
        state.format = "code";
        state.stage = "profile";
        saveState(state);
        track("diagnostic_add_personal_code_clicked");
        go("/questionnaire");
      });
    });

    root.querySelectorAll("[data-kod-action='lead']").forEach(function (button) {
      button.addEventListener("click", function () { openLead(state); });
    });
  }

  function render() {
    var root = getRoot();
    if (!isManagedPath()) {
      setManagedMode(false);
      root.innerHTML = "";
      return;
    }
    var state = getState();
    if (path() === "/questionnaire" && !state.format) {
      state.stage = "format";
      saveState(state);
      window.history.replaceState({}, "", "/diagnostic-format");
    }
    if (path() === "/result" && (!state.format || !state.completedQuestions)) {
      state.stage = "format";
      saveState(state);
      window.history.replaceState({}, "", "/diagnostic-format");
    }
    setManagedMode(true);
    var activePath = path();
    if (activePath === "/diagnostic-format") root.innerHTML = formatPage();
    else if (activePath === "/result") root.innerHTML = resultPage(state);
    else if (state.stage === "profile") root.innerHTML = profilePage(state);
    else if (state.stage === "code-ready") root.innerHTML = codeReadyPage(state);
    else root.innerHTML = questionPage(state);
    bindEvents(root, state);
  }

  function interceptLandingStart(event) {
    var button = event.target.closest("button");
    if (!button || path() !== "/") return;
    var label = (button.textContent || "").trim();
    if (label.indexOf("Узнать свой сценарий") !== 0 && label.indexOf("Пройти тест") !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var state = getState();
    state.stage = "format";
    state.utm = getUtm();
    saveState(state);
    track("diagnostic_start_clicked");
    go("/diagnostic-format");
  }

  document.addEventListener("click", interceptLandingStart, true);
  window.addEventListener("popstate", render);
  window.addEventListener("kod:routechange", render);

  ["pushState", "replaceState"].forEach(function (method) {
    var original = window.history[method];
    window.history[method] = function () {
      var result = original.apply(this, arguments);
      window.setTimeout(render, 0);
      return result;
    };
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
