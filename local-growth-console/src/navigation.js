(function () {
  function switchView(viewId) {
    if (!viewId) return;
    document.querySelectorAll(".module-tab[data-console-view]").forEach(item => {
      item.classList.toggle("active", item.dataset.consoleView === viewId);
    });
    document.querySelectorAll(".console-view").forEach(view => {
      view.classList.toggle("active", view.id === viewId);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", event => {
    const trigger = event.target.closest("[data-console-view]");
    if (!trigger) return;
    const viewId = trigger.dataset.consoleView;
    if (!document.getElementById(viewId)) return;
    event.preventDefault();
    switchView(viewId);
  }, true);

  window.GrowthConsoleNavigation = {
    switchView
  };
})();
