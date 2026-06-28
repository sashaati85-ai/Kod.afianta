(function () {
  "use strict";

  var TELEGRAM_URL = "https://t.me/afianta";
  var VK_URL = "https://vk.com/afianta";
  var LOGO_URL = "/assets/logo-gold-DMOg8YAH.png";
  var rendered = false;
  var settingsLoadedAt = 0;
  var settingsLoading = false;

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
    refreshContactLinks();
    loadContactLinks();
  }

  function normalizeLink(value, fallback) {
    if (typeof value !== "string" || !value.trim()) return fallback;
    return value.trim();
  }

  function refreshContactLinks() {
    var telegram = document.querySelector(".final-contact-button-telegram");
    var vk = document.querySelector(".final-contact-button-vk");
    if (telegram) telegram.href = TELEGRAM_URL;
    if (vk) vk.href = VK_URL;
    document.querySelectorAll('a[href*="t.me"], a[href*="telegram"]').forEach(function (link) {
      if (link.closest(".final-contact-actions") || /telegram/i.test(link.textContent || "")) {
        link.href = TELEGRAM_URL;
      }
    });
    document.querySelectorAll('a[href*="vk.com"], a[href*="vk.ru"]').forEach(function (link) {
      if (link.closest(".final-contact-actions") || /vk|вконтакте/i.test(link.textContent || "")) {
        link.href = VK_URL;
      }
    });
  }

  async function loadContactLinks() {
    if (settingsLoading || Date.now() - settingsLoadedAt < 15000) return;
    settingsLoading = true;
    try {
      var response = await fetch("/api/site-settings?ts=" + Date.now(), {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Settings request failed");
      var payload = await response.json();
      var links = payload && payload.contactLinks ? payload.contactLinks : {};
      TELEGRAM_URL = normalizeLink(links.telegram, TELEGRAM_URL);
      VK_URL = normalizeLink(links.vk, VK_URL);
      settingsLoadedAt = Date.now();
      refreshContactLinks();
    } catch (error) {
      settingsLoadedAt = 0;
    } finally {
      settingsLoading = false;
    }
  }

  function scheduleRender() {
    renderFinalContactStep();
    loadContactLinks();
    window.setTimeout(renderFinalContactStep, 250);
    window.setTimeout(renderFinalContactStep, 900);
  }

  var observer = new MutationObserver(function () {
    refreshContactLinks();
    loadContactLinks();
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
