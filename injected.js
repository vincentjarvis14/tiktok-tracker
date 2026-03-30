// ═══════════════════════════════════════════════════════════
//  TikTok → Airtable Tracker  |  injected.js  v1.4.0
//  Fix : isPostButton sélecteurs 2025 + fetch patterns élargis
//  Méthode 1 : clic sur bouton Post (DOM)
//  Méthode 2 : XHR monitoring TikTok (tiktokw.eu / tiktokv.com)
//  Méthode 3 : fetch sur URL contenant "comment" / "aweme" / "publish"
// ═══════════════════════════════════════════════════════════

(() => {
  // ─── Anti-doublon LOCAL ───────────────────────────────────
  // Évite d'envoyer le même commentaire plusieurs fois (TikTok fire
  // plusieurs requêtes monitoring pour un seul commentaire posté)
  let lastSentText = "";
  let lastSentTime = 0;
  const DEDUP_MS = 8000; // 8 secondes

  function isDuplicate(text) {
    const now = Date.now();
    if (text === lastSentText && now - lastSentTime < DEDUP_MS) return true;
    lastSentText = text;
    lastSentTime = now;
    return false;
  }

  // ─── On est sur une page vidéo ? ──────────────────────────
  function isVideoPage() {
    return /\/@[^/]+\/video\/\d+/.test(location.href);
  }

  // ─── Nettoyage du texte capturé ───────────────────────────
  // [DEBUG-FIX] Supprime le compteur de caractères TikTok ex: "24 /2200" ou "24/2200"
  function cleanText(text) {
    return (text || "").replace(/\s*\d+\s*\/\s*\d+\s*$/, "").trim();
  }

  // ─── Notification vers content.js ─────────────────────────
  function notifyComment(text, source) {
    text = cleanText(text);
    if (!text || text.length < 2) return;
    if (isDuplicate(text)) {
      console.log(`[TTTracker] ⏭️ Doublon ignoré (${source})`);
      return;
    }

    const m = location.href.match(/@([^/?#]+)\/video\//);
    const creator = m ? `@${m[1]}` : "";
    const title = document.title.replace(/\s*\|\s*TikTok\s*$/i, "").trim();

    console.log(`[TTTracker] 🚀 Envoi Airtable [${source}] :`, text.substring(0, 60));

    const ogImg = document.querySelector('meta[property="og:image"]');
    const thumbnail = ogImg?.content ? ogImg.content : "";

    const avatarSelectors = [
      '[data-e2e="video-author-avatar"] img',
      '[data-e2e="browse-video-author-avatar"] img',
      '[data-e2e="user-avatar"] img',
      'a[href*="/@"] [class*="avatar"] img',
    ];
    let avatarUrl = "";
    for (const sel of avatarSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el?.src?.startsWith("http")) {
          avatarUrl = el.src;
          break;
        }
      } catch {}
    }

    window.postMessage(
      {
        type: "TT_COMMENT_POSTED",
        source: "tt-tracker",
        payload: {
          content: text,
          url: location.href.split("?")[0],
          title,
          creator,
          thumbnail,
          avatarUrl,
          date: new Date().toISOString(),
        },
      },
      "*",
    );
  }

  // ════════════════════════════════════════════════════════
  //  MÉTHODE 1 — CLIC BOUTON POST (DOM)
  //  La plus fiable : on capte le texte au moment où l'utilisateur
  //  clique sur "Post" / "Publier", sans dépendre d'une URL réseau
  // ════════════════════════════════════════════════════════

  let pendingDomText = "";

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!isPostButton(e.target)) return;
      const text = readCommentInput();
      if (!text) return;

      pendingDomText = text;
      console.log("[TTTracker] 🖱️ Clic sur bouton Post détecté :", text.substring(0, 50));

      // Délai court pour laisser TikTok traiter la soumission
      setTimeout(() => {
        if (pendingDomText) {
          notifyComment(pendingDomText, "DOM");
          pendingDomText = "";
        }
      }, 400);
    },
    true,
  );

  // Vérifie si l'élément cliqué (ou un parent) est le bouton Post
  // [DEBUG-FIX] Sélecteurs élargis pour TikTok 2025 (DOM change fréquemment)
  function isPostButton(el) {
    for (let i = 0, cur = el; i < 6 && cur; i++, cur = cur.parentElement) {
      // Par attribut data-e2e (TikTok l'utilise souvent)
      const e2e = cur.getAttribute?.("data-e2e") || "";
      if (
        [
          "comment-post",
          "comment-submit",
          "comment-post-btn",
          "comment-submit-btn",
          "btn-post",
          "submit-btn",
          "comment-send",
          "post-comment-btn",
        ].some((v) => e2e.includes(v))
      )
        return true;

      // Par aria-label (TikTok 2025 utilise ça pour l'accessibilité)
      const aria = cur.getAttribute?.("aria-label") || "";
      if (["post", "publier", "poster", "submit", "envoyer"].includes(aria.toLowerCase()))
        return true;

      // Par nom de classe
      const cls = (typeof cur.className === "string" ? cur.className : "").toLowerCase();
      if (
        [
          "postbutton",
          "post-button",
          "comment-post",
          "submit-button",
          "tuxbutton",
          "btn-post",
          "sendbutton",
        ].some((v) => cls.includes(v))
      )
        return true;

      // Par texte (uniquement sur éléments feuilles sans enfants HTML)
      if (cur.childElementCount === 0) {
        const txt = (cur.textContent || "").trim().toLowerCase();
        if (["post", "publier", "poster", "submit", "envoyer"].includes(txt)) return true;
      }
    }
    return false;
  }

  // Textes placeholder TikTok à ignorer (pas des vrais commentaires)
  const PLACEHOLDER_PATTERNS = [
    /^voir ajouter un commentaire/i,
    /^ajouter un commentaire/i,
    /^ajouter une r[eé]ponse/i,
    /^add a comment/i,
    /^add a reply/i,
    /^leave a comment/i,
    /^écrire un commentaire/i,
    /^write a comment/i,
    /^reply\.\.\./i,
    /^répondre\.\.\./i,
  ];

  function isPlaceholder(txt) {
    return PLACEHOLDER_PATTERNS.some((re) => re.test(txt));
  }

  // Lit le texte de la zone de commentaire
  function readCommentInput() {
    const selectors = [
      '[data-e2e="comment-input"]',
      '[data-e2e="comment-textarea"]',
      ".public-DraftEditor-content",
      'div[contenteditable="true"][class*="omment"]',
    ];

    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el) {
          const txt = (el.innerText || el.textContent || "").trim();
          if (txt && !isPlaceholder(txt)) return txt;
        }
      } catch {}
    }

    // Fallback large : n'importe quel contenteditable avec du texte
    const all = document.querySelectorAll('div[contenteditable="true"]');
    for (const el of all) {
      const txt = (el.innerText || el.textContent || "").trim();
      if (txt && txt.length > 1 && !isPlaceholder(txt)) return txt;
    }
    return "";
  }

  // ════════════════════════════════════════════════════════
  //  MÉTHODE 2 — XHR (monitoring TikTok + API directe)
  //  TikTok envoie le texte du commentaire dans ses requêtes
  //  analytics (tiktokw.eu / tiktokv.com) → on les capte ici
  // ════════════════════════════════════════════════════════

  function extractText(body) {
    if (!body) return "";

    if (body instanceof FormData) {
      for (const f of ["text", "content", "comment", "comment_text"]) {
        const v = body.get(f);
        if (v && typeof v === "string" && v.trim()) return v.trim();
      }
    }

    if (typeof body === "string" && body.length > 0) {
      try {
        const p = new URLSearchParams(body);
        for (const f of ["text", "content", "comment", "comment_text"]) {
          const v = p.get(f);
          if (v?.trim()) return v.trim();
        }
      } catch {}

      try {
        const j = JSON.parse(body);
        for (const f of ["text", "content", "comment", "comment_text"]) {
          if (j[f] && typeof j[f] === "string") return j[f].trim();
        }
      } catch {}
    }

    return "";
  }

  const OrigXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = () => {
    const xhr = new OrigXHR();
    let xhrUrl = "";
    let xhrMethod = "";

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url) {
      xhrUrl = (url || "").split("?")[0];
      xhrMethod = (method || "").toUpperCase();
      return origOpen.apply(xhr, arguments);
    };

    const origSend = xhr.send.bind(xhr);
    xhr.send = function (body) {
      if (xhrMethod === "POST" && isVideoPage()) {
        const xhrBody = extractText(body);

        if (xhrBody) {
          const u = xhrUrl.toLowerCase();

          // API TikTok directe (comment/publish ou similaire)
          if (u.includes("comment")) {
            xhr.addEventListener("load", () => {
              if (xhr.status === 200) {
                console.log("[TTTracker] ✅ Détecté via XHR API comment");
                notifyComment(xhrBody, "XHR-api");
              }
            });
          }

          // Requêtes monitoring TikTok — contiennent le texte du commentaire
          // (confirmé par les logs : tiktokw.eu/v1/list)
          if (xhrUrl.includes("tiktokw.eu") || xhrUrl.includes("tiktokv.com")) {
            xhr.addEventListener("load", () => {
              if (xhr.status === 200) {
                console.log("[TTTracker] ✅ Détecté via monitoring TikTok");
                notifyComment(xhrBody, "XHR-monitoring");
              }
            });
          }
        }
      }

      return origSend.apply(xhr, arguments);
    };

    return xhr;
  };
  window.XMLHttpRequest.prototype = OrigXHR.prototype;

  // ════════════════════════════════════════════════════════
  //  MÉTHODE 3 — fetch (API directe uniquement)
  // ════════════════════════════════════════════════════════

  const origFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    init = init || {};
    const response = await origFetch(input, init);

    if (isVideoPage() && (init.method || "GET").toUpperCase() === "POST") {
      const url = (
        typeof input === "string" ? input : (input && (input.url || input.href)) || ""
      ).split("?")[0];
      const bodyText = extractText(init.body);

      // [DEBUG-FIX] Patterns élargis — TikTok route via différentes URLs selon la région/version
      const FETCH_PATTERNS = ["comment", "aweme/v1", "publish", "/api/"];
      if (bodyText && FETCH_PATTERNS.some((p) => url.toLowerCase().includes(p))) {
        console.log("[DEBUG-FIX] fetch intercepté :", url);
        notifyComment(bodyText, "fetch");
      }
    }

    return response;
  };

  console.log("[TTTracker] 🎵 v1.4.0 actif (DOM + XHR monitoring + fetch + dédup) ✅");
})();
