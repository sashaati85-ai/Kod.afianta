(function () {
  "use strict";

  var FLOW_KEY = "relationship-code-flow-state";
  var FLOW_BACKUP_KEY = "relationship-code-flow-backup";
  var PAYMENT_KEY = "relationship-code-payment-access";

  function read(storage, key) {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch (_) {
      return null;
    }
  }

  function write(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function restoreLocalBackup() {
    var current = read(sessionStorage, FLOW_KEY);
    if (current && current.answers && current.result) return;
    var backup = read(localStorage, FLOW_BACKUP_KEY);
    if (backup && backup.answers && backup.result) write(sessionStorage, FLOW_KEY, backup);
  }

  function restoreFromReturnToken() {
    if (window.location.pathname.replace(/\/$/, "") !== "/payment/return") return;
    var params = new URLSearchParams(window.location.search);
    var orderId = params.get("orderId") || "";
    var accessToken = params.get("accessToken") || "";
    if (!orderId || !accessToken) return;

    try {
      var xhr = new XMLHttpRequest();
      xhr.open(
        "GET",
        "/api/payment-context?orderId=" + encodeURIComponent(orderId) +
          "&accessToken=" + encodeURIComponent(accessToken),
        false
      );
      xhr.send(null);
      if (xhr.status !== 200) return;
      var payload = JSON.parse(xhr.responseText);
      if (payload.state && payload.state.answers && payload.state.result) {
        write(sessionStorage, FLOW_KEY, payload.state);
        write(localStorage, FLOW_BACKUP_KEY, payload.state);
      }
      if (payload.payment) write(localStorage, PAYMENT_KEY, payload.payment);
    } catch (_) {}
  }

  function mirrorFlow() {
    var state = read(sessionStorage, FLOW_KEY);
    if (state && state.answers) write(localStorage, FLOW_BACKUP_KEY, state);
  }

  async function recoverPaidAccess() {
    var state = read(sessionStorage, FLOW_KEY) || read(localStorage, FLOW_BACKUP_KEY);
    var payment = read(localStorage, PAYMENT_KEY);
    if (!state || !state.answers || !state.result || !payment || !payment.orderId || !payment.paymentId) return;

    try {
      var statusResponse = await fetch(
        "/api/payment-status?paymentId=" + encodeURIComponent(payment.paymentId) +
          "&orderId=" + encodeURIComponent(payment.orderId),
        { cache: "no-store" }
      );
      var status = await statusResponse.json();
      if (!statusResponse.ok || !status.paid) return;

      payment.status = "paid";
      payment.paidAt = payment.paidAt || new Date().toISOString();
      write(localStorage, PAYMENT_KEY, payment);
      await fetch("/api/attach-payment-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: payment.orderId,
          paymentId: payment.paymentId,
          answers: state.answers,
          result: state.result
        })
      });
    } catch (_) {}
  }

  restoreLocalBackup();
  restoreFromReturnToken();
  mirrorFlow();
  window.setInterval(function () {
    mirrorFlow();
    recoverPaidAccess();
  }, 1200);
})();
