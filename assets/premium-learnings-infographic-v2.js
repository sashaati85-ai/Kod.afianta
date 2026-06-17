(() => {
  const ITEMS = [
    {
      title: "Какой сценарий сейчас влияет на ваши отношения",
      description: "Поймёте скрытые сценарии, которые управляют вашими реакциями и создают повторяющиеся ситуации.",
    },
    {
      title: "Почему партнёр может отдаляться",
      description: "Увидите основные причины эмоциональной дистанции и охлаждения в отношениях.",
    },
    {
      title: "Где вы теряете себя в отношениях",
      description: "Определите моменты, в которых ваши потребности уходят на второй план.",
    },
    {
      title: "Какие шаги помогут вернуть контакт",
      description: "Получите конкретные шаги, которые помогут восстановить близость и вернуть эмоциональную связь.",
    },
    {
      title: "Нужна ли вам более глубокая диагностика",
      description: "Поймёте, достаточно ли вам самостоятельной работы или нужна поддержка специалиста.",
    },
  ];

  const LEAD = "Тест поможет вам увидеть важные аспекты ваших отношений и покажет направление, в котором можно двигаться дальше.";

  function findSection() {
    return Array.from(document.querySelectorAll(".premium-page main > .premium-section")).find((section) => {
      const title = section.querySelector(".premium-section-heading h2");
      return title && title.textContent.trim().toLowerCase().includes("что вы узнаете после теста");
    });
  }

  function enhance() {
    const section = findSection();
    if (!section || section.classList.contains("premium-learnings-map")) return;

    const heading = section.querySelector(".premium-section-heading");
    const title = heading && heading.querySelector("h2");
    const cards = Array.from(section.querySelectorAll(".premium-info-card"));
    if (!heading || !title || cards.length < ITEMS.length) return;

    section.classList.add("premium-learnings-map");
    title.innerHTML = "ЧТО ВЫ<br>УЗНАЕТЕ<br>ПОСЛЕ ТЕСТА";

    if (!heading.querySelector(".premium-learnings-ornament")) {
      const ornament = document.createElement("div");
      ornament.className = "premium-learnings-ornament";
      ornament.setAttribute("aria-hidden", "true");
      ornament.innerHTML = "<span></span><i></i><span></span>";
      title.insertAdjacentElement("afterend", ornament);
    }

    if (!heading.querySelector(".premium-learnings-lead")) {
      const lead = document.createElement("p");
      lead.className = "premium-learnings-lead";
      lead.textContent = LEAD;
      heading.appendChild(lead);
    }

    cards.slice(0, ITEMS.length).forEach((card, index) => {
      card.classList.add("premium-learning-step");
      card.textContent = "";

      const marker = document.createElement("div");
      marker.className = "premium-learning-marker";
      marker.setAttribute("aria-hidden", "true");

      const copy = document.createElement("div");
      copy.className = "premium-learning-copy";

      const itemTitle = document.createElement("h3");
      itemTitle.className = "premium-learning-title";
      itemTitle.textContent = ITEMS[index].title;

      const description = document.createElement("p");
      description.className = "premium-learning-description";
      description.textContent = ITEMS[index].description;

      copy.appendChild(itemTitle);
      copy.appendChild(description);
      card.appendChild(marker);
      card.appendChild(copy);
    });
  }

  function start() {
    enhance();
    window.setTimeout(enhance, 250);
    window.setTimeout(enhance, 900);

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
