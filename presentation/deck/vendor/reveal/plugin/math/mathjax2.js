/**
 * A plugin which enables rendering of math equations inside
 * of reveal.js slides. Essentially a thin wrapper for MathJax.
 *
 * @author Hakim El Hattab
 */
export const MathJax2 = () => {
  // The reveal.js instance this plugin is attached to
  let deck;

  const defaultOptions = {
    messageStyle: "none",
    tex2jax: {
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
      skipTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    },
    skipStartupTypeset: true,
  };

  function loadScript(url, callback) {
    const head = document.querySelector("head");
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;

    // Wrapper for callback to make sure it only fires once
    const finish = () => {
      if (typeof callback === "function") {
        callback.call();
        callback = null;
      }
    };

    script.onload = finish;

    // IE
    script.onreadystatechange = () => {
      if (this.readyState === "loaded") {
        finish();
      }
    };

    // Normal browsers
    head.appendChild(script);
  }

  return {
    id: "mathjax2",

    init: (reveal) => {
      deck = reveal;

      const revealOptions = deck.getConfig().mathjax2 || deck.getConfig().math || {};

      const options = { ...defaultOptions, ...revealOptions };
      const mathjax = options.mathjax || "https://cdn.jsdelivr.net/npm/mathjax@2/MathJax.js";
      const config = options.config || "TeX-AMS_HTML-full";
      const url = mathjax + "?config=" + config;

      options.tex2jax = { ...defaultOptions.tex2jax, ...revealOptions.tex2jax };

      options.mathjax = options.config = null;

      loadScript(url, () => {
        MathJax.Hub.Config(options);

        // Typeset followed by an immediate reveal.js layout since
        // the typesetting process could affect slide height
        MathJax.Hub.Queue(["Typeset", MathJax.Hub, deck.getRevealElement()]);
        MathJax.Hub.Queue(deck.layout);

        // Reprocess equations in slides when they turn visible
        deck.on("slidechanged", (event) => {
          MathJax.Hub.Queue(["Typeset", MathJax.Hub, event.currentSlide]);
        });
      });
    },
  };
};
