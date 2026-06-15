(() => {
  const cards = [
    {
      number: "01",
      title: "Психология отношений",
      text: "Александр разбирает сценарии поведения, границы, эмоциональную близость, кризисы и семейные роли.",
    },
    {
      number: "02",
      title: "Цифровой анализ личности",
      text: "Анна помогает увидеть особенности характера, потребности и скрытые причины повторяющихся сценариев.",
    },
    {
      number: "03",
      title: "Точный разбор вашей ситуации",
      text: "Вместе это даёт не общий совет, а более глубокое понимание того, что происходит именно у вас.",
    },
  ];

  function span(className, text) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function structureExpertsCards() {
    const paragraphs = Array.from(
      document.querySelectorAll(".premium-experts-section .premium-experts-card p")
    );

    if (paragraphs.length < cards.length) {
      return false;
    }

    paragraphs.slice(0, cards.length).forEach((paragraph, index) => {
      if (paragraph.dataset.expertStructured === "true") {
        return;
      }

      const card = cards[index];
      paragraph.replaceChildren(
        span("premium-expert-number", card.number),
        span("premium-expert-title", card.title),
        span("premium-expert-text", card.text)
      );
      paragraph.dataset.expertStructured = "true";
      paragraph.style.setProperty("--premium-card-y", index === 0 ? "-3px" : index === 1 ? "5px" : "1px");
    });

    return true;
  }

  function start() {
    if (structureExpertsCards()) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (structureExpertsCards()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(structureExpertsCards, 250);
    window.setTimeout(structureExpertsCards, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
