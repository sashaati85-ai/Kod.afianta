(function () {
  "use strict";

  var VERSION = "2026-06-21";
  var CONSENT_KEY = "kod-legal-consent-state";
  var COOKIE_KEY = "kod-cookie-choice";
  var FLOW_BACKUP_KEY = "relationship-code-flow-backup";
  var PAYMENT_KEY = "relationship-code-payment-access";
  var LOCAL_LEADS_KEY = "relationship-code-local-leads";
  var bypassClick = null;
  var updateQueued = false;

  var links = [
    ["/privacy", "Политика персональных данных"],
    ["/personal-data-consent", "Согласие на обработку данных"],
    ["/marketing-consent", "Согласие на рассылку"],
    ["/cookies", "Cookies"],
    ["/offer", "Публичная оферта"],
    ["/refund", "Возврат"],
    ["/contacts", "Контакты"]
  ];

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value || "") || fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readConsentState() {
    return parseJson(sessionStorage.getItem(CONSENT_KEY), {});
  }

  function writeConsentState(next) {
    sessionStorage.setItem(CONSENT_KEY, JSON.stringify(next));
  }

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "consent-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function isExpired(value, days) {
    if (!value || !value.savedAt) return false;
    var timestamp = Date.parse(value.savedAt);
    return Number.isFinite(timestamp) && Date.now() - timestamp > days * 86400000;
  }

  function cleanBrowserStorage() {
    try {
      var flow = parseJson(localStorage.getItem(FLOW_BACKUP_KEY), null);
      if (flow && isExpired(flow, 30)) localStorage.removeItem(FLOW_BACKUP_KEY);

      var payment = parseJson(localStorage.getItem(PAYMENT_KEY), null);
      var paymentDate = payment && (payment.paidAt || payment.createdAt);
      if (paymentDate && Date.now() - Date.parse(paymentDate) > 180 * 86400000) {
        localStorage.removeItem(PAYMENT_KEY);
      }

      var leads = parseJson(localStorage.getItem(LOCAL_LEADS_KEY), []);
      if (Array.isArray(leads)) {
        var cutoff = Date.now() - 180 * 86400000;
        var current = leads.filter(function (lead) {
          var created = Date.parse(lead && lead.created_at);
          return !Number.isFinite(created) || created >= cutoff;
        });
        if (current.length !== leads.length) {
          localStorage.setItem(LOCAL_LEADS_KEY, JSON.stringify(current));
        }
      }
    } catch (_) {}
  }

  function recordConsent(formId, entries) {
    var state = readConsentState();
    var consentId = makeId();
    var payload = {
      consentId: consentId,
      occurredAt: new Date().toISOString(),
      page: window.location.pathname,
      formId: formId,
      version: VERSION,
      documents: entries.map(function (entry) {
        return {
          type: entry.type,
          version: VERSION,
          accepted: Boolean(entry.accepted),
          textId: entry.textId
        };
      })
    };

    return fetch("/api/consents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).then(function (response) {
      if (!response.ok) throw new Error("Consent recording failed");
      return response.json();
    }).then(function () {
      entries.forEach(function (entry) {
        if (!entry.accepted) return;
        state[entry.type] = {
          id: consentId,
          version: VERSION,
          acceptedAt: payload.occurredAt,
          formId: formId
        };
      });
      writeConsentState(state);
      return consentId;
    });
  }

  function link(href, text) {
    return '<a href="' + href + '" target="_blank" rel="noopener">' + text + "</a>";
  }

  function consentPanel(id, includeMarketing) {
    var panel = document.createElement("div");
    panel.className = "legal-consent-panel";
    panel.dataset.legalPanel = id;
    panel.innerHTML =
      '<label class="legal-consent-row">' +
        '<input type="checkbox" data-legal-personal />' +
        '<span class="legal-consent-copy">Я ознакомлен(а) с ' +
          link("/privacy", "Политикой обработки персональных данных") +
          " и даю " +
          link("/personal-data-consent", "Согласие на обработку персональных данных") +
          ".</span>" +
      "</label>" +
      (includeMarketing
        ? '<label class="legal-consent-row">' +
            '<input type="checkbox" data-legal-marketing />' +
            '<span class="legal-consent-copy">Я согласен(на) получать информационные и рекламные сообщения. ' +
              link("/marketing-consent", "Подробнее") +
              ".</span>" +
          "</label>"
        : "") +
      '<p class="legal-consent-error">Для продолжения подтвердите обязательное согласие на обработку персональных данных.</p>';
    return panel;
  }

  function showPanelError(panel, text) {
    if (!panel) return;
    panel.classList.add("has-error");
    var error = panel.querySelector(".legal-consent-error");
    if (error && text) error.textContent = text;
    panel.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function buttonText(button) {
    return (button && button.textContent || "").trim().toLowerCase();
  }

  function findActionButton(texts) {
    var buttons = Array.prototype.slice.call(document.querySelectorAll("button"));
    return buttons.find(function (button) {
      return texts.indexOf(buttonText(button)) !== -1;
    }) || null;
  }

  function installQuestionnaireConsent() {
    if (window.location.pathname.replace(/\/$/, "") !== "/questionnaire") return;
    var action = findActionButton(["продолжить", "сформировать отчёт"]);
    if (!action) return;

    var state = readConsentState();
    if (state.personal_data && state.personal_data.version === VERSION) return;
    if (document.querySelector('[data-legal-panel="questionnaire"]')) return;

    var panel = consentPanel("questionnaire", false);
    var target = action.parentElement || action;
    target.parentElement.insertBefore(panel, target);
  }

  function installSensitiveFieldWarning() {
    if (window.location.pathname.replace(/\/$/, "") !== "/questionnaire") return;
    var textarea = document.querySelector("textarea");
    if (!textarea || document.querySelector("[data-legal-sensitive-note]")) return;
    var note = document.createElement("div");
    note.className = "legal-sensitive-note";
    note.dataset.legalSensitiveNote = "true";
    note.innerHTML =
      "<strong>Не указывайте чувствительные сведения.</strong> " +
      "Не пишите о диагнозах, здоровье, интимной жизни, религии или политических взглядах. " +
      "Не указывайте ФИО, контакты и иные данные партнёра, ребёнка или третьих лиц.";
    textarea.parentElement.appendChild(note);
  }

  function decorateLeadConsents() {
    if (window.location.pathname.replace(/\/$/, "") !== "/lead") return;
    var checks = document.querySelector(".form-checks");
    if (!checks || checks.dataset.legalDecorated === "true") return;
    var labels = checks.querySelectorAll("label");
    if (labels[0]) {
      var input0 = labels[0].querySelector("input");
      labels[0].innerHTML = "";
      if (input0) labels[0].appendChild(input0);
      labels[0].insertAdjacentHTML(
        "beforeend",
        '<span>Я ознакомлен(а) с ' + link("/privacy", "Политикой обработки персональных данных") +
        " и даю " + link("/personal-data-consent", "Согласие на обработку персональных данных") + ".</span>"
      );
    }
    if (labels[1]) {
      var input1 = labels[1].querySelector("input");
      labels[1].innerHTML = "";
      if (input1) labels[1].appendChild(input1);
      labels[1].insertAdjacentHTML(
        "beforeend",
        '<span>Я согласен(на) получать информационные и рекламные сообщения. ' +
        link("/marketing-consent", "Подробнее") + ".</span>"
      );
    }
    checks.dataset.legalDecorated = "true";

    var textarea = document.querySelector(".lead-form-card textarea");
    if (textarea && !document.querySelector("[data-legal-lead-warning]")) {
      var warning = document.createElement("div");
      warning.className = "legal-sensitive-note";
      warning.dataset.legalLeadWarning = "true";
      warning.textContent =
        "Комментарий необязателен. Не указывайте сведения о здоровье, интимной жизни и персональные данные других людей.";
      textarea.parentElement.appendChild(warning);
    }
  }

  function installPaymentConsent() {
    if (window.location.pathname.replace(/\/$/, "") !== "/payment") return;
    var action = findActionButton(["купить", "оплатить полный расчёт", "полный отчёт"]);
    if (!action || document.querySelector('[data-legal-panel="payment"]')) return;

    var summary = document.createElement("div");
    summary.className = "legal-payment-summary";
    summary.innerHTML =
      "<strong>Полный персональный отчёт</strong>" +
      "<p>Разовая оплата без подписки. Доступ открывается после подтверждения ЮKassa и формирования отчёта.</p>" +
      "<p>Условия услуги: " + link("/offer", "публичная оферта") +
      " · " + link("/refund", "условия возврата") +
      " · " + link("/contacts", "контакты исполнителя") + ".</p>";

    var panel = document.createElement("div");
    panel.className = "legal-consent-panel";
    panel.dataset.legalPanel = "payment";
    panel.innerHTML =
      '<label class="legal-consent-row">' +
        '<input type="checkbox" data-legal-offer />' +
        '<span class="legal-consent-copy">Я ознакомлен(а) и согласен(на) с условиями ' +
          link("/offer", "Публичной оферты") +
          " и " + link("/refund", "возврата денежных средств") + ".</span>" +
      "</label>" +
      '<p class="legal-consent-error">Для перехода к оплате подтвердите согласие с офертой.</p>';

    var target = action.parentElement || action;
    target.parentElement.insertBefore(summary, target);
    target.parentElement.insertBefore(panel, target);
  }

  function installDisclaimer() {
    var path = window.location.pathname.replace(/\/$/, "");
    if (["/result", "/full-report", "/payment", "/lead"].indexOf(path) === -1) return;
    if (document.querySelector("[data-legal-disclaimer]")) return;
    var disclaimer = document.createElement("aside");
    disclaimer.className = "legal-disclaimer";
    disclaimer.dataset.legalDisclaimer = "true";
    disclaimer.innerHTML =
      "Материалы носят информационно-консультационный характер, не являются медицинской, психиатрической, " +
      "юридической или финансовой помощью и не гарантируют конкретный результат. При угрозе жизни, насилии, " +
      "суицидальном риске или остром кризисе обратитесь в экстренные службы по номеру 112 и к профильному специалисту.";
    var root = document.getElementById("root");
    if (root) root.appendChild(disclaimer);
  }

  function installFooter() {
    if (document.querySelector(".site-legal-footer")) return;
    var footer = document.createElement("footer");
    footer.className = "site-legal-footer";
    footer.innerHTML =
      '<nav aria-label="Юридическая информация">' +
        links.map(function (item) {
          return '<a href="' + item[0] + '">' + item[1] + "</a>";
        }).join("") +
      "</nav>" +
      "<p>Информация на сайте не является медицинской, психиатрической, юридической или финансовой помощью. " +
      "Результат зависит от индивидуальной ситуации и действий пользователя. " +
      "Исполнитель: [УКАЗАТЬ ИСПОЛНИТЕЛЯ], ИНН [УКАЗАТЬ ИНН], email [УКАЗАТЬ EMAIL].</p>";
    document.body.appendChild(footer);
  }

  function installCookieBanner() {
    if (localStorage.getItem(COOKIE_KEY) || document.querySelector(".cookie-consent-banner")) return;
    var banner = document.createElement("section");
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Настройки cookies");
    banner.innerHTML =
      "<p>Мы используем необходимые технологии браузера, чтобы сохранить ответы анкеты и вернуть доступ после оплаты. " +
      link("/cookies", "Политика cookies") + ".</p>" +
      '<div class="cookie-consent-actions">' +
        '<button type="button" class="cookie-consent-necessary">Только необходимые</button>' +
        '<button type="button" class="cookie-consent-accept">Принять</button>' +
      "</div>";
    banner.querySelector(".cookie-consent-necessary").addEventListener("click", function () {
      localStorage.setItem(COOKIE_KEY, JSON.stringify({ choice: "necessary", version: VERSION, savedAt: new Date().toISOString() }));
      recordConsent("cookies", [
        { type: "cookies", accepted: false, textId: "cookies-necessary-only" }
      ]).catch(function () {});
      banner.remove();
    });
    banner.querySelector(".cookie-consent-accept").addEventListener("click", function () {
      localStorage.setItem(COOKIE_KEY, JSON.stringify({ choice: "all", version: VERSION, savedAt: new Date().toISOString() }));
      recordConsent("cookies", [
        { type: "cookies", accepted: true, textId: "cookies-all" }
      ]).catch(function () {});
      banner.remove();
    });
    document.body.appendChild(banner);
  }

  function syncFlowTimestamp() {
    try {
      var flow = parseJson(localStorage.getItem(FLOW_BACKUP_KEY), null);
      if (flow && flow.answers && !flow.savedAt) {
        flow.savedAt = new Date().toISOString();
        localStorage.setItem(FLOW_BACKUP_KEY, JSON.stringify(flow));
      }
    } catch (_) {}
  }

  function handleQuestionnaireClick(event, button) {
    var text = buttonText(button);
    if (text !== "продолжить" && text !== "сформировать отчёт") return false;
    var state = readConsentState();
    if (state.personal_data && state.personal_data.version === VERSION) return false;
    var panel = document.querySelector('[data-legal-panel="questionnaire"]');
    var checkbox = panel && panel.querySelector("[data-legal-personal]");
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!checkbox || !checkbox.checked) {
      showPanelError(panel);
      return true;
    }
    panel.classList.remove("has-error");
    recordConsent("questionnaire", [
      { type: "personal_data", accepted: true, textId: "personal-data-consent" }
    ]).then(function () {
      bypassClick = button;
      button.click();
    }).catch(function () {
      showPanelError(panel, "Не удалось зафиксировать согласие. Проверьте соединение и попробуйте ещё раз.");
    });
    return true;
  }

  function handleLeadClick(event, button) {
    if (buttonText(button) !== "отправить заявку") return false;
    var card = button.closest(".lead-form-card");
    if (!card) return false;
    var checks = card.querySelectorAll('.form-checks input[type="checkbox"]');
    var personal = checks[0];
    var marketing = checks[1];
    if (!personal || !personal.checked) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    recordConsent("lead", [
      { type: "personal_data", accepted: true, textId: "personal-data-consent" },
      { type: "marketing", accepted: Boolean(marketing && marketing.checked), textId: "marketing-consent" }
    ]).then(function () {
      bypassClick = button;
      button.click();
    }).catch(function () {
      var existing = card.querySelector(".legal-submit-error");
      if (!existing) {
        existing = document.createElement("div");
        existing.className = "error-box legal-submit-error";
        button.parentElement.insertBefore(existing, button);
      }
      existing.textContent = "Не удалось зафиксировать согласие. Попробуйте ещё раз.";
    });
    return true;
  }

  function handlePaymentClick(event, button) {
    var text = buttonText(button);
    if (["купить", "оплатить полный расчёт"].indexOf(text) === -1) return false;
    var panel = document.querySelector('[data-legal-panel="payment"]');
    var offer = panel && panel.querySelector("[data-legal-offer]");
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!offer || !offer.checked) {
      showPanelError(panel, "Для перехода к оплате подтвердите согласие с офертой.");
      return true;
    }
    var state = readConsentState();
    if (!state.personal_data) {
      showPanelError(panel, "Не найдено согласие на обработку данных. Вернитесь к анкете и подтвердите его.");
      return true;
    }
    panel.classList.remove("has-error");
    if (state.offer && state.offer.version === VERSION) {
      bypassClick = button;
      button.click();
      return true;
    }
    recordConsent("payment", [
      { type: "offer", accepted: true, textId: "public-offer" }
    ]).then(function () {
      bypassClick = button;
      button.click();
    }).catch(function () {
      showPanelError(panel, "Не удалось зафиксировать согласие с офертой. Попробуйте ещё раз.");
    });
    return true;
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest("button");
    if (!button) return;
    if (bypassClick === button) {
      bypassClick = null;
      return;
    }
    var path = window.location.pathname.replace(/\/$/, "");
    if (path === "/questionnaire" && handleQuestionnaireClick(event, button)) return;
    if (path === "/lead" && handleLeadClick(event, button)) return;
    if (path === "/payment") handlePaymentClick(event, button);
  }, true);

  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url || "";
    if (
      (url.indexOf("/api/create-payment") !== -1 || url.indexOf("/api/generate-free-report") !== -1) &&
      init &&
      typeof init.body === "string"
    ) {
      try {
        var body = JSON.parse(init.body);
        var consent = readConsentState();
        body.legalConsent = url.indexOf("/api/create-payment") !== -1
          ? {
              personalDataConsentId: consent.personal_data && consent.personal_data.id || "",
              offerConsentId: consent.offer && consent.offer.id || "",
              version: VERSION
            }
          : {
              personalDataConsentId: consent.personal_data && consent.personal_data.id || "",
              version: VERSION
            };
        init = Object.assign({}, init, { body: JSON.stringify(body) });
      } catch (_) {}
    }
    return originalFetch.call(window, input, init);
  };

  function update() {
    updateQueued = false;
    installQuestionnaireConsent();
    installSensitiveFieldWarning();
    decorateLeadConsents();
    installPaymentConsent();
    installDisclaimer();
    installFooter();
    installCookieBanner();
    syncFlowTimestamp();
  }

  function queueUpdate() {
    if (updateQueued) return;
    updateQueued = true;
    window.requestAnimationFrame(update);
  }

  cleanBrowserStorage();
  var observer = new MutationObserver(queueUpdate);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
      queueUpdate();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    queueUpdate();
  }
  window.addEventListener("popstate", queueUpdate);
})();
