// ═══════════════════════════════════════════════════════════
//  TikTok → Airtable Tracker  |  content.js  v1.1.0
//  Bridge entre la page TikTok et le background
//  run_at: document_start (avant que la page charge)
// ═══════════════════════════════════════════════════════════

// ─── Injection du script intercepteur dans le contexte de la page ─
// On doit injecter un fichier séparé (injected.js) car le content script
// vit dans un "monde isolé" et ne peut pas modifier fetch/XHR directement
function injectScript() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = function () {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

injectScript();

// ─── Écouter les messages envoyés par injected.js ────────────────
window.addEventListener("message", (event) => {
  // Sécurité : on accepte uniquement nos propres messages
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "TT_COMMENT_POSTED") return;
  if (event.data.source !== "tt-tracker") return;

  const payload = event.data.payload;
  console.log("[TTTracker] 💬 Commentaire intercepté :", payload.content?.substring(0, 50));

  // Transmettre au background pour envoi à Airtable
  chrome.runtime
    .sendMessage({
      type: "COMMENT_POSTED",
      payload,
    })
    .then((res) => {
      if (res?.ok) {
        console.log(
          "[TTTracker] ✅ Enregistré dans Airtable",
          res.mention ? "(🔔 mot-clé détecté)" : "",
        );
      } else if (res?.reason === "duplicate") {
        console.log("[TTTracker] ⏭️ Doublon ignoré");
      } else {
        console.warn("[TTTracker] ⚠️ Erreur :", res?.msg || res?.reason);
      }
    })
    .catch(() => {
      // Background peut être momentanément inactif (service worker MV3)
      console.warn("[TTTracker] Background temporairement injoignable");
    });
});

// ─── Répondre aux pings du background ────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PING") console.log("[TTTracker] 🏓 Pong");
});

console.log("[TTTracker] v1.1.0 ✅ Content script chargé sur", location.hostname);
