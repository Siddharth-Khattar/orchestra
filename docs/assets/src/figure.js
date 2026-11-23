// ABOUTME: Applies the theme from the page URL (?theme=dark) and fixes the figure's height.
// ABOUTME: The height comes from the page's <meta name="figure-height">, which render.sh reads too.

(function () {
  "use strict";

  var root = document.documentElement;
  var theme = new URLSearchParams(window.location.search).get("theme");
  root.setAttribute("data-theme", theme === "dark" ? "dark" : "light");

  var meta = document.querySelector('meta[name="figure-height"]');
  var height = meta ? Number(meta.getAttribute("content")) : NaN;
  if (!Number.isFinite(height) || height <= 0) {
    throw new Error('figure.js: the page needs <meta name="figure-height" content="<px>">');
  }

  function fixHeight() {
    var body = document.body;
    root.style.height = height + "px";
    body.style.height = height + "px";
    // Mark the page when its content does not fit, so the rendered image shows the problem.
    if (body.scrollHeight > height) {
      body.setAttribute("data-overflow", String(body.scrollHeight));
    }
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fixHeight);
  } else {
    window.addEventListener("load", fixHeight);
  }
})();
