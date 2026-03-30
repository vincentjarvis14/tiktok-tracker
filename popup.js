// ═══════════════════════════════════════════════════════════
//  TikTok → NocoDB Tracker  |  popup.js  v2.1
//  Queue banner + countdown + GIF rotation
// ═══════════════════════════════════════════════════════════

function $(id) {
  return document.getElementById(id);
}

function showToast(msg, type) {
  type = type || "success";
  var t = $("toast");
  t.className = `show ${type}`;
  $("toastIcon").textContent = type === "success" ? "✅" : "❌";
  $("toastMsg").textContent = msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.className = t.className.replace("show", "").trim();
  }, 2500);
}

function timeAgo(ts) {
  if (!ts) return "—";
  var d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}j`;
}

// ──────────────────────────────────────────────
// TABS
// ──────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
      });
      document.querySelectorAll(".panel").forEach((p) => {
        p.classList.remove("active");
      });
      tab.classList.add("active");
      $(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });
}

// ──────────────────────────────────────────────
// QUEUE BANNER + COUNTDOWN
// ──────────────────────────────────────────────
var _countdownInterval = null;
var BATCH_THRESHOLD = 5;

function updateQueueBanner(logs) {
  var pending = (logs || []).filter((l) => l.status === null || l.status === undefined);
  var card = $("queueCard");
  var countEl = $("queuePendingCount");
  var cdEl = $("queueCountdown");
  var cdLabelEl = document.querySelector(".queue-countdown-label");
  var cdSubEl = document.querySelector(".queue-countdown-sub");
  var progBar = $("queueProgressBar");
  var TOTAL_MS = 30 * 60000;

  if (pending.length === 0) {
    card.classList.remove("visible");
    if (_countdownInterval) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
    }
    return;
  }

  card.classList.add("visible");
  countEl.textContent = pending.length;

  // Mode "en attente du seuil" : moins de BATCH_THRESHOLD commentaires
  if (pending.length < BATCH_THRESHOLD) {
    if (_countdownInterval) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
    }
    cdEl.classList.remove("paused");
    cdEl.textContent = `${pending.length}/${BATCH_THRESHOLD}`;
    if (cdLabelEl) cdLabelEl.textContent = "Seuil pour déclencher l'envoi";
    if (cdSubEl) cdSubEl.textContent = `L'envoi démarre à ${BATCH_THRESHOLD} commentaires`;
    var pauseBtn = $("queuePauseBtn");
    if (pauseBtn) pauseBtn.style.display = "none";
    if (progBar) progBar.style.width = `${Math.round((pending.length / BATCH_THRESHOLD) * 100)}%`;
    return;
  }

  // Mode "countdown actif" : BATCH_THRESHOLD+ commentaires, l'alarme tourne
  if (cdLabelEl) cdLabelEl.textContent = "Prochain envoi NocoDB dans";
  if (cdSubEl) cdSubEl.textContent = "Les commentaires seront groupés en 1 appel API";
  var pauseBtn2 = $("queuePauseBtn");
  if (pauseBtn2) pauseBtn2.style.display = "";

  function tick() {
    chrome.alarms.get("tt_flush_queue", (alarm) => {
      if (!alarm) {
        cdEl.textContent = "—";
        return;
      }
      var ms = alarm.scheduledTime - Date.now();
      if (ms <= 0) {
        cdEl.textContent = "00:00";
        if (progBar) progBar.style.width = "100%";
        return;
      }
      var m = Math.floor(ms / 60000);
      var s = Math.floor((ms % 60000) / 1000);
      cdEl.textContent = `${(m < 10 ? "0" : "") + m}:${s < 10 ? "0" : ""}${s}`;
      if (progBar) {
        var pct = Math.min(100, Math.round((1 - ms / TOTAL_MS) * 100));
        progBar.style.width = `${pct}%`;
      }
    });
  }

  // Applique l'état pause/resume selon le storage
  chrome.storage.local.get(["ttQueuePaused", "ttQueuePausedRemainingMs"], (data) => {
    var pauseBtn = $("queuePauseBtn");
    if (data.ttQueuePaused) {
      if (_countdownInterval) {
        clearInterval(_countdownInterval);
        _countdownInterval = null;
      }
      var frozenMs = data.ttQueuePausedRemainingMs || 0;
      var fm = Math.floor(frozenMs / 60000);
      var fs = Math.floor((frozenMs % 60000) / 1000);
      cdEl.textContent = `${(fm < 10 ? "0" : "") + fm}:${fs < 10 ? "0" : ""}${fs}`;
      cdEl.classList.add("paused");
      if (progBar) {
        var fpct = Math.min(100, Math.round((1 - frozenMs / TOTAL_MS) * 100));
        progBar.style.width = `${fpct}%`;
      }
      if (pauseBtn) {
        pauseBtn.textContent = "▶";
        pauseBtn.title = "Reprendre";
      }
    } else {
      cdEl.classList.remove("paused");
      if (pauseBtn) {
        pauseBtn.textContent = "⏸";
        pauseBtn.title = "Mettre en pause";
      }
      tick();
      if (!_countdownInterval) {
        _countdownInterval = setInterval(tick, 1000);
      }
    }

    if (pauseBtn) {
      pauseBtn.onclick = () => {
        var msgType = data.ttQueuePaused ? "RESUME_QUEUE" : "PAUSE_QUEUE";
        chrome.runtime.sendMessage({ type: msgType }, () => {
          loadAll();
        });
      };
    }
  });
}

// ──────────────────────────────────────────────
// CLIPART ALÉATOIRE (fallback miniature)
// ──────────────────────────────────────────────
var _CLIPART_BASE = "https://ia801809.us.archive.org/22/items/MS_Clipart_Collection_SVG/";
var _CLIPARTS = [
  "animals,bats,celebrations,Halloween,nature,special_occasions,MC900282616.svg",
  "animals,canines,dogs,Great_Dane,Great_Danes,mammals,nature,pets,MC900423928.svg",
  "animals,Balinese,cats,creatures,mammals,pets,MC900027358.svg",
  "animals,dragons,folklore,legends,magic,mystical_creatures,mysticism,symbols,MC900054152.svg",
  "animals,birds,bubbles,speech_balloons,speech_bubbles,talking,MC900418724.svg",
  "animals,ewes,farms,lambs,mammals,nature,sheep,MC900057355.svg",
  "animals,beaches,cartoons,crabs,crustaceans,seasons,summer,MC900227921.svg",
  "animals,Asian_astrology,Asian_zodiac,astrological_signs,astrology,Chinese_astrology,Chinese_zodiac,holidays,special_occasions,symbols,tigers,wild_animals,wildlife,zodiac_signs,zodiacs,MC900312228.svg",
  "celebrations,coins,currencies,holidays,metaphors,monies,pots_of_gold,riches,Saint_Patricks_Day,special_occasions,St_Patricks_Day,wealth,MC900027503.svg",
  "celebrations,Christmas,holidays,hollies,nature,plants,special_occasions,MC900242253.svg",
  "balloons,celebrations,confetti,parties,special_occasions,MC900311484.svg",
  "celebrations,crackers,parties,party,party_favors,special_occasions,MC900222536.svg",
  "celebrations,dining,food,glasses,goblets,holidays,New_Year_s_Eve,parties,hats,special_occasions,streamers,toasts,MC900059856.svg",
  "acting,cartoons,comedies,comedy_and_tragedy,Cybart,drama_masks,dramas,emotions,entertainment,masks,performances,performing_arts,plays,symbols,theater_masks,theaters,tragedies,MC900286096.svg",
  "cartoons,pregnancies,Screen_BeansÂ®,women,hands,hips,people,healthcare,MC900288991.svg",
  "cartoons,Cybart,households,magnifiers,magnifying_glasses,MC900338528.svg",
  "beverages,cartoons,coffees,creatures,cups,espressos,food,hot_beverages,households,steams,MC900355581.svg",
  "beverages,bottles,cartoons,colas,creatures,drinks,fantasy,foods,pop,pop_bottles,soda_bottles,soda_pops,sodas,soft_drinks,MC900364272.svg",
  "dandelions,flowers,nature,plants,seasons,spring,summer,MC900027437.svg",
  "Blues,floral,flowers,hydrangeas,lavender,plants,MC900420004.svg",
  "congratulations,flowers,nature,paper_fans,plants,special_occasions,text,MC900227909.svg",
  "flowers,India_Hawthorn,nature,plants,Raphiolepsis_indica,MC900281872.svg",
  "chiles,nature,peppers,plants,vegetables,MC900367710.svg",
  "coconuts,food,fruits,nature,plants,MC900423862.svg",
  "children,crowns,dining,fables,fairy_tales,fairytales,fantasy,females,food,fruits,girls,kids,persons,poison_apples,princesses,Snow_White_and_the_Seven_Dwarfs,stories,tiaras,MC900116074.svg",
  "acoustic_guitars,entertainment,guitars,music,musical_instruments,stringed_instruments,MC900354955.svg",
  "entertainment,music,musical_instruments,sitars,stringed_instruments,MC900001716.svg",
  "maracas,music,musical_instruments,percussions,rattles,shakers,MC900200101.svg",
  "CD_players,CDs,entertainment,headphones,home_electronics,households,music,music_notes,musical_notation,MC900370296.svg",
  "activities,athletes,athletics,balls,games,goals,kicks,people,persons,players,playing,scores,silhouettes,soccer,soccer_balls,soccer_fields,soccer_games,sports,MC900440201.svg",
  "athletes,competitions,joggers,leisure,people,races,running,sports,women,MC900281102.svg",
  "aiming,archery,arrows,athletes,bows,men,persons,sports,sports_equipment,MC900363084.svg",
  "divers,diving,leisure,males,men,people,persons,sports,swimmers,swimming,MC900188223.svg",
  "gymnastics,gymnasts,leisure,males,men,occupations,people,persons,pommel_horses,sports,MC900252587.svg",
  "architecture,buildings,landmarks,places,Seattle,Space_Needle,travel,Washington,MC900235135.svg",
  "aerospace,Mir,Mir_space_station,outer_space,research,science,space_missions,space_stations,spacecraft,technology,transportation,MC900083251.svg",
  "blowing,cartoons,households,persons,umbrellas,weather,windy,women,MC900334970.svg",
  "birthdays,birthstones,emeralds,gems,May,nature,precious,signs,special_occasions,symbols,MC900116436.svg",
  "boys,celebration,celebrations,childhood,children,clothes,cultures,festivals,girls,kids,people,smiling,togetherness,traditions,MC900445392.svg",
  "academic,celebrations,children,classes,classrooms,costumes,education,Halloween,kids,people,persons,schools,special_occasions,MC900285606.svg",
  "25th_anniversaries,affections,anniversaries,anniversary_cakes,cakes,celebrations,couples,husbands,marriages,men,persons,silver_anniversaries,special_occasions,spouses,toasts,wedding_anniversaries,wives,women,MC900398351.svg",
];

function _getClipartUrl(logId) {
  var idx = Math.abs(Math.floor((logId || 0) * 9301 + 49297)) % _CLIPARTS.length;
  return _CLIPART_BASE + encodeURI(_CLIPARTS[idx]);
}

// ──────────────────────────────────────────────
// LOGS
// ──────────────────────────────────────────────
function renderLogs(logs) {
  var el = $("logList");
  var badge = $("logsCount");
  badge.textContent = logs.length;

  updateQueueBanner(logs);

  // Smoke : visible quand aucun commentaire en file d'attente
  var pendingCount = (logs || []).filter((l) => l.status === null || l.status === undefined).length;
  var smokeEl = $("smokeOverlay");
  if (smokeEl) smokeEl.classList.toggle("visible", pendingCount === 0);

  if (!logs || logs.length === 0) {
    el.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🎵</div><p>En attente de vos<br>commentaires TikTok...</p></div>';
    return;
  }

  el.innerHTML = "";
  logs.slice(0, 50).forEach((log, i) => {
    var isError = log.status === "error" || log.success === false;
    var isOk = log.status === "ok" || log.success === true;
    var isPending = !isOk && !isError;

    var statusClass = isOk ? "success" : isError ? "error" : "pending";
    var item = document.createElement("div");
    item.className = `log-item ${statusClass}${i === 0 ? " new" : ""}`;

    var kwBadge = log.mention ? '<span class="kw-badge">🔔 mot-clé</span>' : "";

    var statusText = isOk
      ? "✓ NocoDB"
      : isError
        ? `✗ ${log.error || "erreur"}`
        : "⏳ En file d'attente";
    var statusCls = isOk ? "ok" : isError ? "err" : "wait";

    var deleteBtn = isPending
      ? '<button class="log-delete-btn" title="Supprimer de la file">✕</button>'
      : "";

    item.innerHTML =
      '<div class="log-item-right">' +
      '<div class="log-row1">' +
      '<span class="type-chip">commentaire</span>' +
      '<span class="log-creator">' +
      (log.creator || "?") +
      "</span>" +
      kwBadge +
      deleteBtn +
      "</div>" +
      '<div class="log-content">' +
      (log.content || "(vide)") +
      "</div>" +
      '<div class="log-row2">' +
      '<span class="log-time">' +
      timeAgo(log.time || log.timestamp) +
      "</span>" +
      '<span class="log-status ' +
      statusCls +
      '">' +
      statusText +
      "</span>" +
      "</div>" +
      "</div>";

    var delBtn = item.querySelector(".log-delete-btn");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: "REMOVE_FROM_QUEUE", logId: log.id }, () => {
          loadAll();
        });
      });
    }

    el.appendChild(item);
  });
}

// ──────────────────────────────────────────────
// CONNEXION STATUS
// ──────────────────────────────────────────────
function updateConnBadge(ok) {
  var badge = $("connBadge");
  var label = $("connLabel");
  if (ok) {
    badge.className = "conn-pill on";
    label.textContent = "connecté";
  } else {
    badge.className = "conn-pill";
    label.textContent = "offline";
  }
}

function updateStatusDot(state) {
  var dot = $("statusDot");
  var text = $("statusText");
  if (!dot) return;
  if (state === "ok") {
    dot.className = "dot green";
    text.textContent = "Connecté à NocoDB ✅";
  } else if (state === "error") {
    dot.className = "dot red";
    text.textContent = "Erreur de connexion ❌";
  } else {
    dot.className = "dot yellow";
    text.textContent = "Vérification…";
  }
}

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
var POPUP_DEFAULTS = {
  keywords: ["shine"],
  account: "",
};

function loadConfig() {
  chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (cfg) => {
    if (chrome.runtime.lastError || !cfg) return;
    $("keywords").value = (cfg.keywords?.length ? cfg.keywords : POPUP_DEFAULTS.keywords).join(
      ", ",
    );
    $("accountInput").value = cfg.account || "";
  });
}

function saveConfig() {
  var cfg = {
    keywords: $("keywords")
      .value.split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    account: $("accountInput").value.trim(),
  };
  chrome.runtime.sendMessage({ type: "SAVE_CONFIG", config: cfg }, () => {
    showAlert("alertBox", "✅ Configuration sauvegardée !", "success");
  });
}

function testConnection() {
  updateStatusDot("checking");
  chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, (r) => {
    if (chrome.runtime.lastError) {
      updateStatusDot("error");
      showAlert("alertBox", `❌ ${chrome.runtime.lastError.message}`, "error");
      return;
    }
    if (r?.ok) {
      updateStatusDot("ok");
      updateConnBadge(true);
      showAlert("alertBox", r.msg || "✅ Connexion NocoDB OK", "success");
    } else {
      updateStatusDot("error");
      showAlert("alertBox", r?.msg || "❌ Connexion NocoDB échouée", "error");
    }
  });
}

function showAlert(id, msg, type) {
  var el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `alert ${type} show`;
  setTimeout(() => {
    el.className = el.className.replace(" show", "");
  }, 3000);
}

// ──────────────────────────────────────────────
// CHARGEMENT GLOBAL
// ──────────────────────────────────────────────
function loadAll() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (chrome.runtime.lastError || !state) return;
    renderLogs(state.logs || []);
    updateConnBadge(true);
  });
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Restaure la taille sauvegardée
  chrome.storage.local.get("ttPopupSize", (data) => {
    if (data.ttPopupSize) {
      document.body.style.width = `${data.ttPopupSize.w}px`;
      document.body.style.height = `${data.ttPopupSize.h}px`;
    }
  });

  // Mémorise la taille 400ms après chaque redimensionnement
  var _resizeTimer = null;
  new ResizeObserver(() => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      chrome.storage.local.set({
        ttPopupSize: {
          w: document.body.offsetWidth,
          h: document.body.offsetHeight,
        },
      });
    }, 400);
  }).observe(document.body);

  // Smoke : toujours démarrer à 5s, même après chaque loop
  var smoke = $("smokeOverlay");
  if (smoke) {
    var SMOKE_START = 15;
    smoke.addEventListener("loadedmetadata", () => {
      smoke.currentTime = SMOKE_START;
    });
    smoke.addEventListener("ended", () => {
      smoke.currentTime = SMOKE_START;
      smoke.play();
    });
    smoke.currentTime = SMOKE_START;
  }

  initTabs();
  loadConfig();
  loadAll();

  $("btnSave").addEventListener("click", saveConfig);
  $("btnTest").addEventListener("click", testConnection);

  if ($("testBtn")) {
    $("testBtn").addEventListener("click", testConnection);
  }

  $("clearLogsBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "CLEAR_LOGS" }, () => {
      renderLogs([]);
      showToast("Historique vidé", "success");
    });
  });

  // Rafraîchissement auto toutes les 10s
  setInterval(loadAll, 10000);
});
