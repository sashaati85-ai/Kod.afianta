(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var BLOCKED_PAID_PATHS = ["/payment", "/payment/return", "/full-report"];
  var diagnosisItems = [
    "что сейчас сильнее всего влияет на дистанцию между вами",
    "где тревога может превращаться в давление или срочность",
    "какой первый шаг поможет говорить спокойнее",
    "что важно не усиливать, чтобы не ухудшить контакт",
    "подходит ли вам личная диагностика с Александром и Анной"
  ];

  function path() {
    return window.location.pathname.replace(/\/+$/, "") || "/";
  }

  function hasFlowState() {
    try {
      var state = JSON.parse(window.sessionStorage.getItem(FLOW_KEY) || "null");
      return Boolean(state && state.answers && state.result);
    } catch (_) {
      return false;
    }
  }

  function goToDiagnosis() {
    window.location.href = hasFlowState() ? "/lead" : "/questionnaire";
  }

  function replaceText(selector, text, root) {
    var node = (root || document).querySelector(selector);
    if (node && node.textContent !== text) node.textContent = text;
  }

  function findPaidOfferStack() {
    var button = document.querySelector(".result-paid-button");
    if (!button) return null;
    return button.closest(".result-preview-stack") || button.closest(".result-detail-block");
  }

  function patchPaidOffer() {
    if (path() !== "/result") return;
    var stack = findPaidOfferStack();
    if (!stack) return;

    stack.dataset.freeDiagnosisPatched = "true";
    stack.classList.add("free-diagnosis-offer");

    var lead = stack.querySelector(".report-lead");
    if (lead) {
      var leadText = "Ваш результат уже показывает важные точки напряжения. Следующий бережный шаг — бесплатная диагностика отношений с Александром и Анной.";
      if (lead.textContent !== leadText) lead.textContent = leadText;
    }

    var paragraphs = Array.from(stack.querySelectorAll(".report-paragraph"));
    paragraphs.forEach(function (paragraph) {
      var text = (paragraph.textContent || "").toLowerCase();
      if (text.indexOf("полный разбор") !== -1 || text.indexOf("полном разборе") !== -1) {
        paragraph.textContent = "На диагностике можно спокойно разобрать вашу живую ситуацию, увидеть, где теряется контакт, и понять ближайший шаг без давления и поспешных решений.";
      }
      if (text.indexOf("интерес") !== -1 || text.indexOf("15") !== -1 || text.indexOf("точного разбора") !== -1) {
        paragraph.textContent = "Если откликается то, что вы увидели в тесте, запишитесь на бесплатную диагностику. Это поможет понять, какой формат поддержки вам сейчас действительно подходит.";
      }
    });

    var items = Array.from(stack.querySelectorAll(".report-list-item"));
    diagnosisItems.forEach(function (text, index) {
      if (items[index] && items[index].textContent !== text) items[index].textContent = text;
    });

    replaceText(".result-paid-button-text", "Записаться на бесплатную диагностику", stack);
    replaceText(".action-subhint", "Бесплатно · спокойно · без давления", stack);
    replaceText(".offer-hint", "После заявки с вами свяжутся, чтобы согласовать удобное время диагностики.", stack);
    replaceText(".text-link-button", "Оставить заявку на диагностику", stack);

    var mainButton = stack.querySelector(".result-paid-button");
    var clickable = mainButton && mainButton.closest("button");
    if (clickable) {
      clickable.setAttribute("type", "button");
      clickable.setAttribute("data-free-diagnosis-action", "true");
      clickable.setAttribute("aria-label", "Записаться на бесплатную диагностику отношений");
    }

    var textLink = stack.querySelector(".text-link-button");
    if (textLink) textLink.setAttribute("data-free-diagnosis-action", "true");
  }

  function patchResultPaidMentions() {
    if (path() !== "/result") return;
    Array.from(document.querySelectorAll(".result-preview-stack .report-lead, .result-preview-stack .report-paragraph, .result-detail-block .report-lead, .result-detail-block .report-paragraph")).forEach(function (node) {
      var text = (node.textContent || "").toLowerCase();
      if (text.indexOf("полном разборе") !== -1 || text.indexOf("полный разбор") !== -1) {
        node.textContent = "Этот бесплатный результат показывает верхний слой вашей ситуации. Следующий шаг — бесплатная диагностика, где можно спокойнее разобрать вашу живую ситуацию и понять, какие слова и действия сейчас будут бережнее.";
      }
    });
  }

  function redirectPaidRoutes() {
    if (BLOCKED_PAID_PATHS.indexOf(path()) === -1) return;
    goToDiagnosis();
  }

  function update() {
    redirectPaidRoutes();
    patchResultPaidMentions();
    patchPaidOffer();
  }

  function scheduleUpdate() {
    update();
    window.setTimeout(update, 300);
    window.setTimeout(update, 900);
    window.setTimeout(update, 1600);
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest('[data-free-diagnosis-action], .result-paid-button, button, a')
      : null;
    if (!target) return;
    var text = (target.textContent || "").trim().toLowerCase();
    var isPaidAction =
      target.matches("[data-free-diagnosis-action]") ||
      target.classList.contains("result-paid-button") ||
      text === "купить" ||
      text === "оплатить полный расчёт" ||
      text === "оплатить полный расчет" ||
      text === "полный отчёт" ||
      text === "полный отчет";
    var href = target.getAttribute && target.getAttribute("href");
    if (!isPaidAction && href !== "/payment" && href !== "/full-report") return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    goToDiagnosis();
  }, true);

  var observer = new MutationObserver(update);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      scheduleUpdate();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    scheduleUpdate();
  }
  window.addEventListener("popstate", function () { window.setTimeout(scheduleUpdate, 100); });
})();
