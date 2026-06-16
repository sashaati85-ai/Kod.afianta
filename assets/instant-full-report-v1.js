(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var PAYMENT_KEY = "relationship-code-payment-access";
  window.__instantFullReportReady = true;

  function readFlowState() {
    try {
      return JSON.parse(sessionStorage.getItem(FLOW_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function hasReportSeed() {
    var state = readFlowState();
    return Boolean(state && state.answers && state.result);
  }

  function markReportPaid() {
    var now = new Date().toISOString();
    var id = "instant-full-report-" + Date.now();
    var access = {
      paymentId: id,
      orderId: id,
      amount: "0.00",
      status: "paid",
      createdAt: now,
      paidAt: now,
      instant: true
    };

    localStorage.setItem(PAYMENT_KEY, JSON.stringify(access));
    return access;
  }

  function findBuyButton(target) {
    var button = target && target.closest ? target.closest("button, [role='button'], a") : null;
    if (!button) return null;

    var text = (button.textContent || "").trim().toLowerCase();
    if (text.indexOf("купить") === -1 && text.indexOf("переходим к оплате") === -1) {
      return null;
    }

    return button;
  }

  function openFullReport(button) {
    markReportPaid();

    if (button) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }

    window.location.href = "/full-report?instant=1";
  }

  function createInstantPaymentResponse() {
    var id = "instant-full-report-" + Date.now();
    return {
      paymentId: id,
      orderId: id,
      amount: "0.00",
      confirmationUrl: "/payment/return?orderId=" + encodeURIComponent(id) + "&instant=1",
      instant: true
    };
  }

  function installFetchFallback() {
    if (typeof window.fetch !== "function" || window.__instantFullReportFetchInstalled) return;

    var originalFetch = window.fetch.bind(window);
    window.__instantFullReportFetchInstalled = true;

    window.fetch = function (input, init) {
      var rawUrl = typeof input === "string" ? input : input && input.url;
      var method = (init && init.method) || (input && input.method) || "GET";
      var url;

      try {
        url = new URL(rawUrl, window.location.origin);
      } catch (_) {
        return originalFetch(input, init);
      }

      if (url.pathname === "/api/create-payment" && String(method).toUpperCase() === "POST") {
        var payment = createInstantPaymentResponse();
        return Promise.resolve(new Response(JSON.stringify(payment), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }));
      }

      if (url.pathname === "/api/payment-status") {
        markReportPaid();
        return Promise.resolve(new Response(JSON.stringify({
          status: "succeeded",
          paid: true,
          matchesOrderId: true,
          instant: true
        }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }));
      }

      return originalFetch(input, init);
    };
  }

  installFetchFallback();

  if (window.location.pathname === "/full-report" && window.location.search.indexOf("instant=1") !== -1) {
    markReportPaid();
  }

  document.addEventListener("click", function (event) {
    if (window.location.pathname.replace(/\/$/, "") !== "/payment") return;

    var button = findBuyButton(event.target);
    if (!button || button.disabled || !hasReportSeed()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    openFullReport(button);
  }, true);
})();
