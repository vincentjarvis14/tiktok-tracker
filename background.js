// ═══════════════════════════════════════════════════════════
//  TikTok → NocoDB Tracker  |  background.js  v2.1
//  Batch queue + cache anti-doublon persisté
// ═══════════════════════════════════════════════════════════

var VERSION = "2.1";

// ─── Configuration NocoDB ─────────────────────────────────
var NC = {
  token: "YOUR_NOCODB_TOKEN",
  baseId: "pv95s0yyapcs378",
  baseUrl: "http://localhost:8080/api/v1/db/data/noco",
  tableId: "mpkwed8ehgmb37z", // Données TikTok
  fCreateurTT: "Créateur TikTok",
  fContenu: "Contenu",
  fUrl: "URL Vidéo",
  fTitre: "Titre Vidéo",
  fDate: "Date",
};

var DEFAULT_CONFIG = {
  tableId: NC.tableId,
  keywords: ["shine"],
  account: "",
};

var MAX_LOGS = 500;
var BATCH_SIZE = 5;

// ─── Cache anti-doublon persisté ──────────────────────────
var urlsSentToAirtable = {};

async function hydrateUrlCache() {
  try {
    var d = await new Promise((r) => {
      chrome.storage.local.get("urlsSentCache", (data) => {
        r(data);
      });
    });
    if (d.urlsSentCache && typeof d.urlsSentCache === "object") {
      urlsSentToAirtable = d.urlsSentCache;
      var cutoff = Date.now() - 24 * 3600000;
      var keys = Object.keys(urlsSentToAirtable);
      var purged = 0;
      keys.forEach((k) => {
        if (urlsSentToAirtable[k] < cutoff) {
          delete urlsSentToAirtable[k];
          purged++;
        }
      });
      console.log(
        "[TTTracker] Cache URLs hydraté : " +
          (keys.length - purged) +
          " entrées (purgé " +
          purged +
          " > 24h)",
      );
    }
  } catch (e) {
    console.warn("[TTTracker] hydrateUrlCache échoué:", e.message);
  }
}

function persistUrlCache() {
  chrome.storage.local.set({ urlsSentCache: urlsSentToAirtable });
}

// ─── Queue batch ──────────────────────────────────────────
var commentQueue = [];

async function hydrateQueue() {
  try {
    var d = await new Promise((r) => {
      chrome.storage.local.get("ttCommentQueue", (data) => {
        r(data);
      });
    });
    if (Array.isArray(d.ttCommentQueue) && d.ttCommentQueue.length > 0) {
      commentQueue = d.ttCommentQueue;
      console.log("[TTTracker] Queue hydratée :", commentQueue.length, "commentaire(s) en attente");
    }
  } catch (e) {
    console.warn("[TTTracker] hydrateQueue échoué:", e.message);
  }
}

function persistQueue() {
  chrome.storage.local.set({ ttCommentQueue: commentQueue });
}

async function flushQueue() {
  await hydrateQueue();
  if (commentQueue.length === 0) return;
  var cfg = await getConfig();
  if (!cfg) return;

  var items = commentQueue.splice(0, BATCH_SIZE);
  persistQueue();
  console.log(
    "[TTTracker] Flush —",
    items.length,
    `commentaire(s) à envoyer (${commentQueue.length} restant(s))`,
  );

  for (var i = 0; i < items.length; i += BATCH_SIZE) {
    var chunk = items.slice(i, i + BATCH_SIZE);
    var result = await sendBatchToNocoDB(cfg, chunk);
    if (result.success) {
      chunk.forEach((item) => {
        urlsSentToAirtable[item.dedupKey] = Date.now();
        updateLog(item.logId, { success: true, status: "ok" });
      });
      persistUrlCache();
    } else {
      console.warn("[TTTracker] Batch échoué, fallback individuel:", result.error);
      for (var j = 0; j < chunk.length; j++) {
        var single = chunk[j];
        var sRes = await sendBatchToNocoDB(cfg, [single]);
        if (sRes.success) {
          urlsSentToAirtable[single.dedupKey] = Date.now();
          updateLog(single.logId, { success: true, status: "ok" });
          persistUrlCache();
        } else {
          commentQueue.push(single);
          updateLog(single.logId, { success: false, status: "error", error: sRes.error });
          console.error("[TTTracker] Échec définitif pour 1 record:", sRes.error);
        }
      }
      persistQueue();
    }
  }
  if (commentQueue.length >= BATCH_SIZE) {
    chrome.alarms.get("tt_flush_queue", (a) => {
      if (!a) chrome.alarms.create("tt_flush_queue", { delayInMinutes: 30 });
    });
    console.log(
      `[TTTracker] ${commentQueue.length} commentaires restants — prochain batch programmé`,
    );
  }
  console.log("[TTTracker] Flush terminé");
}

// sendBatchToNocoDB — envoie jusqu'à 10 records en 1 appel POST bulk
async function sendBatchToNocoDB(cfg, items) {
  try {
    var keywords = cfg.keywords || DEFAULT_CONFIG.keywords || [];
    var rows = items.map((item) => {
      var data = item.data;
      var low = (
        (data.content || "") +
        " " +
        (data.title || "") +
        " " +
        (data.creator || "")
      ).toLowerCase();
      var _mentionsKeyword =
        keywords.length > 0 && keywords.some((k) => low.includes(k.toLowerCase()));
      var row = {};
      row[NC.fCreateurTT] = data.creator || "";
      row[NC.fContenu] = (data.content || "").substring(0, 10000);
      row[NC.fUrl] = data.url || "";
      row[NC.fTitre] = data.title || "";
      row[NC.fDate] = data.date || new Date().toISOString();
      return row;
    });

    if (rows.length === 1) {
      // Single insert
      var resp = await fetch(`${NC.baseUrl}/${NC.baseId}/${NC.tableId}`, {
        method: "POST",
        headers: { "xc-token": NC.token, "Content-Type": "application/json" },
        body: JSON.stringify(rows[0]),
      });
      var json = await resp.json();
      if (resp.ok) {
        console.log("[TTTracker] ✅ Envoyé :", 1, "record");
        return { success: true, count: 1 };
      }
      return { success: false, error: json.msg || json.message || `HTTP ${resp.status}` };
    }

    // Bulk insert
    var bulkResp = await fetch(
      `${NC.baseUrl.replace("/noco", "/bulk/noco")}/${NC.baseId}/${NC.tableId}`,
      {
        method: "POST",
        headers: { "xc-token": NC.token, "Content-Type": "application/json" },
        body: JSON.stringify(rows),
      },
    );
    if (bulkResp.ok) {
      console.log("[TTTracker] ✅ Batch envoyé :", rows.length, "records");
      return { success: true, count: rows.length };
    }
    var errJson = await bulkResp.json().catch(() => ({}));
    return { success: false, error: errJson.msg || `HTTP ${bulkResp.status}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Démarrage ────────────────────────────────────────────
chrome.alarms.get("tt_keepalive", (a) => {
  if (!a) chrome.alarms.create("tt_keepalive", { periodInMinutes: 1 });
});
chrome.alarms.get("tt_flush_queue", (a) => {
  chrome.storage.local.get("ttQueuePaused", (data) => {
    if (data.ttQueuePaused && a) chrome.alarms.clear("tt_flush_queue");
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tt_keepalive") return;
  if (alarm.name === "tt_flush_queue") flushQueue();
});

async function startup() {
  await sleep(300);
  await hydrateUrlCache();
  await hydrateQueue();
  await initConfig();
  if (commentQueue.length >= BATCH_SIZE) {
    chrome.alarms.get("tt_flush_queue", (a) => {
      chrome.storage.local.get("ttQueuePaused", (data) => {
        if (!a && !data.ttQueuePaused) {
          chrome.alarms.create("tt_flush_queue", { delayInMinutes: 30 });
          console.log(
            "[TTTracker] Démarrage — " +
              commentQueue.length +
              " commentaires en file → countdown démarré",
          );
        }
      });
    });
  }
  pingTikTokTabs();
}
startup();

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[TTTracker] v${VERSION} — ${details.reason}`);
  await initConfig();
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`[TTTracker] v${VERSION} démarré ✅`);
  pingTikTokTabs();
});

async function initConfig() {
  var data = await new Promise((r) => {
    chrome.storage.local.get("ttConfig", r);
  });
  if (!data.ttConfig) {
    await new Promise((r) => {
      chrome.storage.local.set({ ttConfig: DEFAULT_CONFIG }, r);
    });
  } else {
    var existing = data.ttConfig;
    var preserved = Object.assign({}, DEFAULT_CONFIG, existing, {
      tableId: NC.tableId,
      keywords:
        existing.keywords && existing.keywords.length > 0
          ? existing.keywords
          : DEFAULT_CONFIG.keywords,
    });
    await new Promise((r) => {
      chrome.storage.local.set({ ttConfig: preserved }, r);
    });
  }
  console.log("[TTTracker] Config initialisée ✅");
}

// ─── Ping les onglets TikTok ouverts ─────────────────────
async function pingTikTokTabs() {
  try {
    var tabs = await chrome.tabs.query({ url: "https://www.tiktok.com/*" });
    for (var t = 0; t < tabs.length; t++) {
      chrome.tabs.sendMessage(tabs[t].id, { type: "PING" }).catch(() => {});
    }
    if (tabs.length > 0) {
      console.log("[TTTracker] Ping envoyé à", tabs.length, "onglet(s) TikTok");
    }
  } catch (e) {
    console.warn("[TTTracker] Ping échoué:", e.message);
  }
}

// ─── Messages ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "COMMENT_POSTED":
        sendResponse(await handleComment(msg.payload));
        break;
      case "GET_STATE":
        sendResponse(await getState());
        break;
      case "GET_CONFIG":
        sendResponse(await getConfig());
        break;
      case "SAVE_CONFIG":
        sendResponse(await saveConfig(msg.config));
        break;
      case "TEST_CONNECTION":
        sendResponse(await testConnection());
        break;
      case "CLEAR_LOGS":
        sendResponse(await clearLogs());
        break;
      case "PAUSE_QUEUE":
        sendResponse(await pauseQueue());
        break;
      case "RESUME_QUEUE":
        sendResponse(await resumeQueue());
        break;
      case "REMOVE_FROM_QUEUE":
        sendResponse(await removeFromQueue(msg.logId));
        break;
      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

// ─── Config ───────────────────────────────────────────────
async function getConfig() {
  var d = await new Promise((r) => {
    chrome.storage.local.get("ttConfig", r);
  });
  return Object.assign({}, DEFAULT_CONFIG, d.ttConfig || {});
}

async function saveConfig(c) {
  var cur = await getConfig();
  await new Promise((r) => {
    chrome.storage.local.set({ ttConfig: Object.assign({}, cur, c) }, r);
  });
  return { ok: true };
}

// ─── État ─────────────────────────────────────────────────
async function getState() {
  var d = await new Promise((r) => {
    chrome.storage.local.get(["ttLogs", "ttConfig"], r);
  });
  var cfg = Object.assign({}, DEFAULT_CONFIG, d.ttConfig || {});
  return { logs: d.ttLogs || [], config: cfg, version: VERSION, queue: commentQueue.length };
}

async function clearLogs() {
  await new Promise((r) => {
    chrome.storage.local.set({ ttLogs: [] }, r);
  });
  return { ok: true };
}

// ─── Test connexion ───────────────────────────────────────
async function testConnection() {
  try {
    var r = await fetch(`${NC.baseUrl}/${NC.baseId}/${NC.tableId}?limit=1`, {
      headers: { "xc-token": NC.token },
    });
    if (r.ok)
      return { ok: true, msg: '✅ Connexion NocoDB OK — table "Données TikTok" accessible' };
    return { ok: false, msg: `❌ NocoDB erreur ${r.status}` };
  } catch (e) {
    return { ok: false, msg: `❌ ${e.message}` };
  }
}

// ─── Traitement d'un commentaire ─────────────────────────
async function handleComment(payload) {
  var content = payload.content;
  var url = payload.url;
  var title = payload.title;
  var creator = payload.creator;
  var date = payload.date;

  var dedupKey = `${url || ""}|${String(content || "").substring(0, 50)}`;
  if (urlsSentToAirtable[dedupKey]) {
    console.log("[TTTracker] ⏭ Doublon ignoré (cache local)");
    return { ok: false, reason: "duplicate" };
  }

  var avatarDataUrl = await fetchAsDataUrl(payload.avatarUrl || "");

  var logId = Date.now() + Math.random();
  await addLog({
    id: logId,
    creator: creator,
    content: (content || "").substring(0, 80),
    url: url,
    thumbnail: payload.thumbnail || "",
    avatarUrl: avatarDataUrl,
    mention: false,
    status: null,
    time: Date.now(),
  });

  commentQueue.push({
    data: { content: content, url: url, title: title, creator: creator, date: date },
    logId: logId,
    dedupKey: dedupKey,
  });
  persistQueue();

  if (commentQueue.length >= BATCH_SIZE) {
    chrome.alarms.get("tt_flush_queue", (a) => {
      if (!a) {
        chrome.storage.local.get("ttQueuePaused", (data) => {
          if (!data.ttQueuePaused) {
            chrome.alarms.create("tt_flush_queue", { delayInMinutes: 30 });
            console.log(`[TTTracker] 🚀 ${BATCH_SIZE} commentaires atteints — countdown démarré`);
          }
        });
      }
    });
  }

  console.log(
    "[TTTracker] 📥 En queue (" +
      commentQueue.length +
      "/" +
      BATCH_SIZE +
      ") — " +
      (content || "").substring(0, 40),
  );
  return { ok: true, queued: true };
}

// ─── Logs ─────────────────────────────────────────────────
async function getLogs() {
  return new Promise((r) => {
    chrome.storage.local.get("ttLogs", (d) => {
      r(d.ttLogs || []);
    });
  });
}

async function addLog(entry) {
  var logs = await getLogs();
  logs.unshift(entry);
  return new Promise((r) => {
    chrome.storage.local.set({ ttLogs: logs.slice(0, MAX_LOGS) }, r);
  });
}

async function updateLog(id, patch) {
  var logs = await getLogs();
  var idx = logs.findIndex((l) => l.id === id);
  if (idx !== -1) {
    Object.assign(logs[idx], patch);
    chrome.storage.local.set({ ttLogs: logs });
  }
}

// ─── Pause / Resume queue ──────────────────────────────────
async function pauseQueue() {
  return new Promise((resolve) => {
    chrome.alarms.get("tt_flush_queue", (alarm) => {
      var remainingMs = alarm ? Math.max(0, alarm.scheduledTime - Date.now()) : 0;
      chrome.alarms.clear("tt_flush_queue", () => {
        chrome.storage.local.set({ ttQueuePaused: true, ttQueuePausedRemainingMs: remainingMs });
        resolve({ ok: true, remainingMs: remainingMs });
      });
    });
  });
}

async function resumeQueue() {
  return new Promise((resolve) => {
    chrome.storage.local.get("ttQueuePausedRemainingMs", (data) => {
      chrome.storage.local.set({ ttQueuePaused: false, ttQueuePausedRemainingMs: null });
      if (commentQueue.length >= BATCH_SIZE) {
        var delayMs = data.ttQueuePausedRemainingMs || 30 * 60000;
        chrome.alarms.create("tt_flush_queue", { delayInMinutes: delayMs / 60000 });
      }
      resolve({ ok: true });
    });
  });
}

// ─── Supprimer un item de la file ─────────────────────────
async function removeFromQueue(logId) {
  commentQueue = commentQueue.filter((i) => i.logId !== logId);
  persistQueue();
  var logs = await getLogs();
  var filtered = logs.filter((l) => l.id !== logId);
  await new Promise((r) => {
    chrome.storage.local.set({ ttLogs: filtered }, r);
  });
  return { ok: true };
}

// ─── Image CDN → data URL ─────────────────────────────────
async function fetchAsDataUrl(url) {
  if (!url) return "";
  try {
    var resp = await fetch(url);
    if (!resp.ok) return "";
    var blob = await resp.blob();
    var ab = await blob.arrayBuffer();
    var bytes = new Uint8Array(ab);
    var binary = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  } catch (e) {
    console.warn("[TTTracker] fetchAsDataUrl échoué:", e.message);
    return "";
  }
}

function sleep(ms) {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

console.log(`[TTTracker] v${VERSION} démarré ✅`);
