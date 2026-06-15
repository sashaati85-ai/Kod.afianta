(() => {
  const mobileQuery = window.matchMedia("(max-width: 680px)");
  const compactDescription =
    "Укажите имя и дату рождения — это поможет подготовить персональный разбор.";

  function updateBasicDescription() {
    const description = document.querySelector(
      ".questionnaire-mobile-fix .section-heading .section-description"
    );

    if (!description) {
      return;
    }

    if (!description.dataset.fullText) {
      description.dataset.fullText = description.textContent.trim();
    }

    const nextText = mobileQuery.matches
      ? compactDescription
      : description.dataset.fullText;

    if (description.textContent.trim() !== nextText) {
      description.textContent = nextText;
    }
  }

  function markQuestionnairePage() {
    const isQuestionnaire = window.location.pathname === "/questionnaire";
    document.documentElement.classList.toggle("questionnaire-mobile-fix", isQuestionnaire);
    updateBasicDescription();
  }

  markQuestionnairePage();
  window.addEventListener("popstate", markQuestionnairePage);
  mobileQuery.addEventListener("change", updateBasicDescription);

  const observer = new MutationObserver(updateBasicDescription);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    markQuestionnairePage();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    markQuestionnairePage();
    return result;
  };
})();
