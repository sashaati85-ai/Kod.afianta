(() => {
  const leadText =
    "Мы смотрим не только на поведение в отношениях, но и на глубинные особенности личности, которые влияют на ваш сценарий.";

  const points = [
    {
      label: "Александр",
      title: "Психология отношений:",
      text: "сценарии поведения, границы, эмоциональная близость, кризисы и семейные роли.",
    },
    {
      label: "Анна",
      title: "Цифровой анализ личности:",
      text: "особенности характера, потребности и скрытые причины повторяющихся сценариев.",
    },
    {
      label: "Вместе",
      title: "Точный разбор:",
      text: "это даёт не общий совет, а более точное понимание вашей ситуации.",
    },
  ];

  function span(className, text) {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  }

  function structurePoint(paragraph, point, index) {
    if (paragraph.dataset.expertStructured === "true") {
      return;
    }

    paragraph.classList.add("premium-expert-point", "premium-experts-reveal-item");
    paragraph.style.setProperty("--card-reveal-delay", `${220 + index * 120}ms`);
    paragraph.replaceChildren(
      span("premium-expert-label", point.label),
      span("premium-expert-line", ""),
      span("premium-expert-title", point.title),
      span("premium-expert-text", point.text)
    );
    paragraph.dataset.expertStructured = "true";
  }

  function createVisual() {
    const visual = document.createElement("div");
    visual.className = "premium-experts-visual premium-experts-reveal-item";
    visual.style.setProperty("--card-reveal-delay", "160ms");

    const glow = document.createElement("div");
    glow.className = "premium-experts-photo-glow";

    const image = document.createElement("img");
    image.className = "premium-experts-photo";
    image.src = "/assets/founders-couple-cutout-v2.png";
    image.alt = "Александр и Анна Тимофеевы";
    image.loading = "lazy";
    image.decoding = "async";

    visual.append(glow, image);
    return visual;
  }

  function structureExpertsBlock() {
    const section = document.querySelector(".premium-experts-section");
    const heading = section?.querySelector(".premium-section-heading");
    const card = section?.querySelector(".premium-experts-card");
    const paragraphs = Array.from(card?.querySelectorAll("p") || []);

    if (!section || !heading || !card || paragraphs.length < points.length) {
      return false;
    }

    if (section.dataset.expertsEditorial === "true") {
      return true;
    }

    section.classList.add("premium-experts-editorial");
    heading.classList.add("premium-experts-reveal-item");
    heading.style.setProperty("--card-reveal-delay", "0ms");

    const layout = document.createElement("div");
    layout.className = "premium-experts-layout";

    const copy = document.createElement("div");
    copy.className = "premium-experts-copy";

    const lead = document.createElement("p");
    lead.className = "premium-experts-lead premium-experts-reveal-item";
    lead.textContent = leadText;
    lead.style.setProperty("--card-reveal-delay", "90ms");

    paragraphs.slice(0, points.length).forEach((paragraph, index) => {
      structurePoint(paragraph, points[index], index);
    });

    copy.append(heading, lead, card);
    layout.append(copy, createVisual());
    section.replaceChildren(layout);
    section.dataset.expertsEditorial = "true";

    return true;
  }

  function start() {
    if (structureExpertsBlock()) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (structureExpertsBlock()) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.setTimeout(structureExpertsBlock, 250);
    window.setTimeout(structureExpertsBlock, 900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
