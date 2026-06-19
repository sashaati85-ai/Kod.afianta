(function () {
  "use strict";

  var PAYMENT_KEY = "relationship-code-payment-access";
  var confirmingPayment = false;
  var returnTimer = 0;

  function readPayment() {
    try {
      return JSON.parse(localStorage.getItem(PAYMENT_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function markPaid(payment) {
    var next = Object.assign({}, payment, {
      status: "paid",
      paidAt: new Date().toISOString()
    });
    localStorage.setItem(PAYMENT_KEY, JSON.stringify(next));
    return next;
  }

  function createModal() {
    var overlay = document.createElement("div");
    overlay.className = "payment-notice-overlay";
    overlay.innerHTML =
      '<section class="payment-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-notice-title">' +
        '<button class="payment-notice-close" type="button" aria-label="Закрыть">×</button>' +
        '<div class="payment-notice-kicker">Перед оплатой</div>' +
        '<h2 id="payment-notice-title">Как получить полный отчёт</h2>' +
        '<p>После оплаты вернитесь на сайт по кнопке платёжной страницы. Здесь появится кнопка «Полный отчёт».</p>' +
        '<p>Подтверждение банка иногда занимает несколько минут. Страница проверит оплату автоматически.</p>' +
        '<button class="payment-notice-confirm" type="button">Перейти к оплате</button>' +
      '</section>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function showPaymentNotice(button) {
    var overlay = createModal();
    var close = function () { overlay.remove(); };
    overlay.querySelector(".payment-notice-close").addEventListener("click", close);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    overlay.querySelector(".payment-notice-confirm").addEventListener("click", function () {
      confirmingPayment = true;
      close();
      button.click();
      window.setTimeout(function () { confirmingPayment = false; }, 1000);
    });
  }

  function isBuyButton(button) {
    var text = (button.textContent || "").trim().toLowerCase();
    return text === "купить" || text === "оплатить полный расчёт" || text === "полный отчёт";
  }

  function polishPaymentButton() {
    if (window.location.pathname.replace(/\/$/, "") !== "/payment") return;
    var payment = readPayment();
    document.querySelectorAll("button").forEach(function (button) {
      if (button.textContent.trim() === "Купить") {
        button.textContent = payment && payment.status === "paid" ? "Полный отчёт" : "Оплатить полный расчёт";
      }
    });
  }

  async function checkPayment(status, button, message) {
    var payment = readPayment();
    if (!payment || !payment.paymentId || !payment.orderId) {
      status.textContent = "Не найден номер платежа. Вернитесь к оплате и попробуйте ещё раз.";
      button.disabled = true;
      return false;
    }

    try {
      var response = await fetch(
        "/api/payment-status?paymentId=" + encodeURIComponent(payment.paymentId) +
        "&orderId=" + encodeURIComponent(payment.orderId),
        { cache: "no-store" }
      );
      var result = await response.json();
      if (response.ok && result.paid && result.status === "succeeded") {
        markPaid(payment);
        status.textContent = "Оплата подтверждена. Ваш полный отчёт готов.";
        message.textContent = "Нажмите кнопку ниже, чтобы открыть персональный разбор.";
        button.disabled = false;
        button.classList.add("is-ready");
        return true;
      }
      status.textContent = "Ждём подтверждение оплаты от банка.";
      message.textContent = "Обычно это занимает до нескольких минут. Проверка идёт автоматически.";
      button.disabled = false;
      return false;
    } catch (_) {
      status.textContent = "Не удалось проверить оплату прямо сейчас.";
      message.textContent = "Нажмите «Полный отчёт», чтобы повторить проверку.";
      button.disabled = false;
      return false;
    }
  }

  function renderReturnPage() {
    if (window.location.pathname.replace(/\/$/, "") !== "/payment/return") return;
    var main = document.querySelector(".page-main");
    if (!main || main.querySelector(".payment-return-card")) return;

    main.textContent = "";
    var card = document.createElement("section");
    card.className = "payment-return-card";
    card.innerHTML =
      '<div class="payment-return-mark" aria-hidden="true">✓</div>' +
      '<div class="payment-return-kicker">Возвращение после оплаты</div>' +
      '<h1>Ваш полный отчёт</h1>' +
      '<p class="payment-return-status">Проверяем подтверждение оплаты...</p>' +
      '<p class="payment-return-message">Пожалуйста, не закрывайте страницу.</p>' +
      '<button class="payment-return-button" type="button">Полный отчёт</button>' +
      '<p class="payment-return-help">Если банк обрабатывает платёж дольше обычного, подождите немного и нажмите кнопку ещё раз.</p>';
    main.appendChild(card);

    var status = card.querySelector(".payment-return-status");
    var message = card.querySelector(".payment-return-message");
    var button = card.querySelector(".payment-return-button");

    button.addEventListener("click", async function () {
      button.disabled = true;
      var paid = await checkPayment(status, button, message);
      if (paid) window.location.href = "/full-report";
    });

    checkPayment(status, button, message);
    window.clearInterval(returnTimer);
    returnTimer = window.setInterval(async function () {
      var paid = await checkPayment(status, button, message);
      if (paid) window.clearInterval(returnTimer);
    }, 4000);
  }

  function update() {
    polishPaymentButton();
    renderReturnPage();
  }

  document.addEventListener("click", function (event) {
    if (confirmingPayment || window.location.pathname.replace(/\/$/, "") !== "/payment") return;
    var button = event.target.closest && event.target.closest("button");
    if (!button || !isBuyButton(button) || button.disabled) return;
    var payment = readPayment();
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (payment && payment.status === "paid") {
      window.location.href = "/full-report";
      return;
    }
    showPaymentNotice(button);
  }, true);

  var observer = new MutationObserver(update);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
      update();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    update();
  }
  window.addEventListener("popstate", function () { window.setTimeout(update, 100); });
})();
