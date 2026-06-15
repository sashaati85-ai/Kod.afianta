(() => {
  const selectors = [
    ".premium-page main > .premium-section:nth-of-type(3) .premium-info-card",
    ".premium-page main > .premium-section:nth-of-type(4) .premium-info-card",
    ".premium-books-grid .premium-book-card",
    ".premium-experts-card p",
    ".premium-final-cta",
  ];

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    return;
  }

  const selector = selectors.join(",");
  const observed = new WeakSet();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("is-card-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -10% 0px",
      threshold: 0.16,
    }
  );

  function revealDelayFor(element) {
    const group =
      element.closest(".premium-card-grid") ||
      element.closest(".premium-books-grid") ||
      element.closest(".premium-experts-card") ||
      element.parentElement;
    const siblings = Array.from(group.querySelectorAll(selector)).filter((item) =>
      group.contains(item)
    );
    const index = Math.max(0, siblings.indexOf(element));
    const step = window.matchMedia("(max-width: 680px)").matches ? 120 : 110;

    return `${Math.min(index * step, 560)}ms`;
  }

  function collectCards() {
    document.querySelectorAll(selector).forEach((element) => {
      if (observed.has(element)) {
        return;
      }

      observed.add(element);
      element.classList.add("premium-card-reveal");
      element.style.setProperty("--card-reveal-delay", revealDelayFor(element));
      observer.observe(element);
    });
  }

  function start() {
    document.documentElement.classList.add("card-reveal-enabled");
    collectCards();

    const mutationObserver = new MutationObserver(collectCards);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(collectCards, 250);
    window.setTimeout(collectCards, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
