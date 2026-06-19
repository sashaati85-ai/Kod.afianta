(function () {
  "use strict";

  function polishPaymentText() {
    if (window.location.pathname.replace(/\/$/, "") === "/payment") {
      document.querySelectorAll("button").forEach(function (button) {
        if (button.textContent.trim() === "Купить") {
          button.textContent = "Оплатить полный расчёт";
        }
      });
    }

    if (window.location.pathname.replace(/\/$/, "") === "/payment/return") {
      document.querySelectorAll(".page-description, .full-report-paragraph").forEach(function (node) {
        node.textContent = node.textContent
          .replace(/ЮKassa/g, "Payform")
          .replace(/ЮКасса/g, "Payform");
      });
    }
  }

  var observer = new MutationObserver(polishPaymentText);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
      polishPaymentText();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    polishPaymentText();
  }

  window.addEventListener("popstate", function () {
    window.setTimeout(polishPaymentText, 100);
  });
})();
