(() => {
  function markQuestionnairePage() {
    const isQuestionnaire = window.location.pathname === "/questionnaire";
    document.documentElement.classList.toggle("questionnaire-mobile-fix", isQuestionnaire);
  }

  markQuestionnairePage();
  window.addEventListener("popstate", markQuestionnairePage);

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
