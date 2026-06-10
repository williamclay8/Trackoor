export const LOCAL_SIGNAL_STORAGE_KEY = "trackoor.localSignals";
export const LOCAL_SIGNAL_LIMIT = 50;
export const SIGNAL_VAULT_VERSION = 1;

const VALID_REDACTION_STATES = new Set(["pending", "not_needed", "redacted", "blocked"]);

export function createLocalSignal({ body, sourceType, threadId, now = new Date() }) {
  const text = String(body || "").trim();
  if (text.length < 12) {
    return { signal: null, errors: ["Signal needs at least 12 characters of context."] };
  }

  return {
    signal: {
      id: `local-${now.getTime()}`,
      title: text.length > 72 ? `${text.slice(0, 69)}...` : text,
      whyItMatters: "Captured locally. Attach proof before shaping this into a public artifact.",
      sourceType: sourceType || "build_note",
      threadId,
      heat: "new",
      capturedAt: now.toISOString(),
      redactionStatus: "pending",
      rawAssetLocalOnly: true,
      ownerReviewRequired: true
    },
    errors: []
  };
}

export function sanitizeLocalSignals(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const safe = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    if (seen.has(item.id)) continue;
    const redactionStatus = VALID_REDACTION_STATES.has(item.redactionStatus) ? item.redactionStatus : "pending";
    safe.push({
      id: item.id,
      title: item.title.slice(0, 240),
      whyItMatters: String(item.whyItMatters || "Captured locally. Attach proof before shaping this into a public artifact.").slice(0, 320),
      sourceType: String(item.sourceType || "build_note").slice(0, 80),
      threadId: String(item.threadId || "").slice(0, 120),
      heat: String(item.heat || "new").slice(0, 32),
      capturedAt: validDateOrNow(item.capturedAt),
      redactionStatus,
      rawAssetLocalOnly: item.rawAssetLocalOnly !== false,
      ownerReviewRequired: item.ownerReviewRequired !== false
    });
    seen.add(item.id);
    if (safe.length >= LOCAL_SIGNAL_LIMIT) break;
  }

  return safe;
}

export function loadSignalsFromStorage(storage) {
  try {
    const raw = storage.getItem(LOCAL_SIGNAL_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeLocalSignals(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveSignalsToStorage(storage, signals) {
  const safe = sanitizeLocalSignals(signals);
  storage.setItem(LOCAL_SIGNAL_STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

export function buildSignalVault(signals, { exportedAt = new Date().toISOString(), source = "trackoor-browser-localStorage" } = {}) {
  return {
    version: SIGNAL_VAULT_VERSION,
    exportedAt,
    source,
    retention: {
      localSignalLimit: LOCAL_SIGNAL_LIMIT,
      rawAssetsPolicy: "metadata-only; no screenshot/OCR/raw logs in this vault"
    },
    signals: sanitizeLocalSignals(signals)
  };
}

export function parseSignalVault(text) {
  const errors = [];
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { signals: [], errors: ["Vault JSON could not be parsed."] };
  }

  const signals = Array.isArray(parsed) ? parsed : parsed?.signals;
  if (!Array.isArray(signals)) {
    return { signals: [], errors: ["Vault must contain a signals array."] };
  }

  const safeSignals = sanitizeLocalSignals(signals);
  if (safeSignals.length === 0 && signals.length > 0) {
    errors.push("Vault contained records, but none matched the local signal contract.");
  }
  if (signals.length > LOCAL_SIGNAL_LIMIT) {
    errors.push(`Vault trimmed to ${LOCAL_SIGNAL_LIMIT} signals by retention policy.`);
  }

  return { signals: safeSignals, errors };
}

function validDateOrNow(value) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return new Date().toISOString();
}
