(function () {
  "use strict";

  var TELEGRAM_URL = "https://t.me/afianta";
  var VK_URL = "https://vk.com/afianta";
  var LOGO_URL = "/assets/logo-gold-DMOg8YAH.png";
  var rendered = false;

  function path() {
    return window.location.pathname.replace(/\/+$/, "") || "/";
  }

  function renderFinalContactStep() {
    if (path() !== "/lead") return;
    var root = document.getElementById("root");
    if (!root) return;
    if (rendered && root.querySelector(".final-contact-step")) return;

    rendered = true;
    document.body.classList.add("final-contact-step-body");
    root.innerHTML =
      '<main class="final-contact-step" aria-labelledby="final-contact-title">' +
        '<section class="final-contact-card">' +
          '<div class="final-contact-brand">' +
            '<img src="' + LOGO_URL + '" alt="" class="final-contact-logo" />' +
            '<div>' +
              '<p class="final-contact-eyebrow">Код отношений</p>' +
              '<p class="final-contact-brandline">Александр и Анна Тимофеевы</p>' +
            '</div>' +
          '</div>' +
          '<div class="final-contact-copy">' +
            '<h1 id="final-contact-title">Где вам удобно оставить заявку?</h1>' +
            '<p>Выберите удобный способ связи. Мы получим ваше сообщение и вернёмся с ответом, чтобы согласовать бесплатную диагностику отношений.</p>' +
          '</div>' +
          '<div class="final-contact-actions" aria-label="Способы связи">' +
            '<a class="final-contact-button final-contact-button-telegram" href="' + TELEGRAM_URL + '" target="_blank" rel="noopener">' +
              '<span class="final-contact-button-icon">TG</span>' +
              '<span><strong>Telegram</strong><small>Оставить заявку в Telegram</small></span>' +
            '</a>' +
            '<a class="final-contact-button final-contact-button-vk" href="' + VK_URL + '" target="_blank" rel="noopener">' +
              '<span class="final-contact-button-icon">VK</span>' +
              '<span><strong>ВКонтакте</strong><small>Оставить заявку в VK</small></span>' +
            '</a>' +
          '</div>' +
          '<p class="final-contact-note">Откроется выбранный мессенджер. Напишите коротко: «Хочу бесплатную диагностику».</p>' +
        '</section>' +
      '</main>';
  }

  function scheduleRender() {
    renderFinalContactStep();
    window.setTimeout(renderFinalContactStep, 250);
    window.setTimeout(renderFinalContactStep, 900);
  }

  var observer = new MutationObserver(function () {
    if (path() === "/lead" && !document.querySelector(".final-contact-step")) {
      rendered = false;
      renderFinalContactStep();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRender();
    });
  } else {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRender();
  }

  window.addEventListener("popstate", function () {
    rendered = false;
    window.setTimeout(scheduleRender, 100);
  });
})();
