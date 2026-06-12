import {
  buildDashboardModel,
  filterCandidates,
  generateDailySummary,
  validateBuildSignal
} from "./model.js";
import {
  buildSignalVault,
  createLocalSignal,
  loadSignalsFromStorage,
  parseSignalVault,
  saveSignalsToStorage
} from "./storage.js";
import {
  AUDIT_STORAGE_KEY,
  EVENT_KIND_LABELS,
  PLATFORMS,
  SESSION_GAP_MINUTES,
  buildDayCard,
  composePostDrafts,
  createAuditEvent,
  dayKey,
  detectMilestones,
  groupEventsByDay,
  mergeAuditEvents,
  parseAuditTrail,
  sanitizeAuditEvents,
  serializeAuditTrail
} from "./audit.js";

const state = {
  model: null,
  data: null,
  candidateFilter: "all",
  selectedArtifactId: null,
  localSignals: [],
  localAuditEvents: [],
  fileAuditEvents: [],
  auditEvents: [],
  draftPlatform: {}
};

const elements = {
  topOutcome: document.querySelector("#topOutcome"),
  statusMetrics: document.querySelector("#statusMetrics"),
  todayMove: document.querySelector("#todayMove"),
  threadRail: document.querySelector("#threadRail"),
  signalCanvas: document.querySelector("#signalCanvas"),
  candidateFilters: document.querySelector("#candidateFilters"),
  candidateGrid: document.querySelector("#candidateGrid"),
  redactionQueue: document.querySelector("#redactionQueue"),
  artifactChooser: document.querySelector("#artifactChooser"),
  artifactPreview: document.querySelector("#artifactPreview"),
  selectedArtifactName: document.querySelector("#selectedArtifactName"),
  proofShelf: document.querySelector("#proofShelf"),
  distributionLedger: document.querySelector("#distributionLedger"),
  captureForm: document.querySelector("#captureForm"),
  signalInput: document.querySelector("#signalInput"),
  sourceType: document.querySelector("#sourceType"),
  arcSelect: document.querySelector("#arcSelect"),
  clearLocalSignals: document.querySelector("#clearLocalSignals"),
  exportLocalSignals: document.querySelector("#exportLocalSignals"),
  importVault: document.querySelector("#importVault"),
  exportSummary: document.querySelector("#exportSummary"),
  dayCard: document.querySelector("#dayCard"),
  milestoneRow: document.querySelector("#milestoneRow"),
  postDrafts: document.querySelector("#postDrafts"),
  auditTimeline: document.querySelector("#auditTimeline"),
  exportAuditTrail: document.querySelector("#exportAuditTrail"),
  refreshAudit: document.querySelector("#refreshAudit"),
  toast: document.querySelector("#toast")
};

init().catch((error) => {
  document.body.classList.add("load-failed");
  elements.topOutcome.textContent = "Trackoor could not load local data.";
  elements.todayMove.innerHTML = `<article class="notice-card danger"><h3>Local data error</h3><p>${escapeHtml(error.message)}</p></article>`;
});

async function init() {
  const response = await fetch("data/sample-build-signal.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load sample data: ${response.status}`);
  state.data = await response.json();
  const errors = validateBuildSignal(state.data);
  if (errors.length > 0) throw new Error(errors.join("; "));
  state.model = buildDashboardModel(state.data);
  state.localSignals = loadSignalsFromStorage(window.localStorage);
  state.localAuditEvents = loadAuditEvents();
  state.fileAuditEvents = await fetchAuditTrail();
  maybeLogSessionStart();
  refreshMergedAudit();
  state.selectedArtifactId = state.model.candidates[0]?.artifactId || state.model.artifacts[0]?.id;
  bindEvents();
  render();
}

function bindEvents() {
  elements.captureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = elements.signalInput.value;
    const { signal, errors } = createLocalSignal({
      body,
      sourceType: elements.sourceType.value,
      threadId: elements.arcSelect.value || state.model.threads[0]?.id,
      now: new Date()
    });
    if (errors.length > 0) {
      showToast(errors[0]);
      return;
    }

    state.localSignals.unshift(signal);
    saveLocalSignals();
    elements.signalInput.value = "";
    logAction("signal_captured", `Captured signal: ${signal.title}`, { sourceType: signal.sourceType, threadId: signal.threadId });
    renderTopbar();
    renderSignalCanvas();
    renderRedactionQueue();
    showToast("Local signal captured. It still needs proof and review.");
  });

  elements.clearLocalSignals.addEventListener("click", () => {
    const cleared = state.localSignals.length;
    state.localSignals = [];
    saveLocalSignals();
    logAction("signals_cleared", `Cleared ${cleared} local signal${cleared === 1 ? "" : "s"} from this browser`, { cleared });
    renderTopbar();
    renderSignalCanvas();
    renderRedactionQueue();
    showToast("Local captures cleared from this browser.");
  });

  elements.exportLocalSignals.addEventListener("click", () => {
    const vault = buildSignalVault(state.localSignals);
    downloadJson(vault, `trackoor-local-vault-${new Date().toISOString().slice(0, 10)}.json`);
    logAction("vault_exported", `Exported vault with ${state.localSignals.length} signals`, { count: state.localSignals.length });
    showToast("Local vault export prepared. It contains metadata only.");
  });

  elements.importVault.addEventListener("change", async () => {
    const file = elements.importVault.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { signals, errors } = parseSignalVault(text);
    if (signals.length === 0) {
      showToast(errors[0] || "Vault had no importable signals.");
      elements.importVault.value = "";
      return;
    }
    state.localSignals = saveSignalsToStorage(window.localStorage, [...signals, ...state.localSignals]);
    elements.importVault.value = "";
    logAction("vault_imported", `Imported ${signals.length} signals from a vault file`, { count: signals.length });
    renderTopbar();
    renderSignalCanvas();
    renderRedactionQueue();
    showToast(errors[0] || `${signals.length} local signals imported.`);
  });

  elements.exportSummary.addEventListener("click", () => {
    const summary = generateDailySummary(state.data);
    downloadJson(summary, `trackoor-summary-${state.data.meta.date}.json`);
    logAction("summary_exported", "Exported the daily summary", {});
    showToast("Local summary export prepared.");
  });

  elements.exportAuditTrail.addEventListener("click", () => {
    const text = serializeAuditTrail(state.auditEvents);
    downloadText(`${text}\n`, `trackoor-audit-trail-${dayKey(new Date().toISOString())}.jsonl`);
    logAction("audit_exported", `Exported audit trail with ${state.auditEvents.length} events`, { count: state.auditEvents.length });
    showToast("Audit trail export prepared. Metadata only, review before sharing.");
  });

  elements.refreshAudit.addEventListener("click", async () => {
    state.fileAuditEvents = await fetchAuditTrail();
    refreshMergedAudit();
    renderShareStudio();
    renderAuditTimeline();
    showToast("Audit trail refreshed from disk and this browser.");
  });
}

function render() {
  renderArcSelect();
  renderTopbar();
  renderToday();
  renderThreads();
  renderShareStudio();
  renderAuditTimeline();
  renderSignalCanvas();
  renderCandidateFilters();
  renderCandidates();
  renderRedactionQueue();
  renderArtifacts();
  renderProofShelf();
  renderDistributionLedger();
}

function loadAuditEvents() {
  try {
    const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
    return raw ? sanitizeAuditEvents(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function saveAuditEvents() {
  try {
    state.localAuditEvents = sanitizeAuditEvents(state.localAuditEvents);
    window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(state.localAuditEvents));
  } catch {
    showToast("Local storage unavailable. Audit events kept only for this page session.");
  }
}

async function fetchAuditTrail() {
  try {
    const response = await fetch("dist/audit-trail.jsonl", { cache: "no-store" });
    if (!response.ok) return [];
    const { events } = parseAuditTrail(await response.text());
    return events;
  } catch {
    return [];
  }
}

function refreshMergedAudit() {
  state.auditEvents = mergeAuditEvents(state.fileAuditEvents, state.localAuditEvents);
}

function maybeLogSessionStart() {
  const last = state.localAuditEvents[state.localAuditEvents.length - 1];
  const gapMs = SESSION_GAP_MINUTES * 60_000;
  if (!last || Date.now() - Date.parse(last.ts) > gapMs) {
    const { event } = createAuditEvent({
      source: "session",
      kind: "session_started",
      summary: "Opened the Build Signal Desk",
      detail: {}
    });
    if (event) {
      state.localAuditEvents.push(event);
      saveAuditEvents();
    }
  }
}

function logAction(kind, summary, detail) {
  const { event, errors } = createAuditEvent({ source: "app", kind, summary, detail });
  if (errors.length > 0 || !event) return;
  state.localAuditEvents.push(event);
  saveAuditEvents();
  refreshMergedAudit();
  renderShareStudio();
  renderAuditTimeline();
}

function renderShareStudio() {
  const today = dayKey(new Date().toISOString());
  const card = buildDayCard({ events: state.auditEvents, today });
  const milestones = detectMilestones(state.auditEvents, { today });
  const drafts = composePostDrafts({ events: state.auditEvents, today });

  elements.dayCard.innerHTML = `
    <div class="day-card-head">
      <span>${escapeHtml(card.projectName)} build log</span>
      <span>${escapeHtml(card.day)}</span>
    </div>
    <p class="day-card-highlight">${escapeHtml(card.highlight)}</p>
    <div class="day-card-stats">
      <div><strong>${card.actions}</strong><span>actions</span></div>
      <div><strong>${card.commits}</strong><span>commits</span></div>
      <div><strong>${card.captures}</strong><span>signals</span></div>
      <div><strong>${card.streak}</strong><span>day streak</span></div>
      <div><strong>${card.focusMinutes}</strong><span>focus min</span></div>
      <div><strong>${card.sessions}</strong><span>sessions</span></div>
    </div>
    <div class="day-card-foot">
      <span>${card.span ? escapeHtml(card.span) : "tracked automatically"}</span>
      <span>posted manually, always</span>
    </div>
  `;

  elements.milestoneRow.innerHTML = milestones.length
    ? milestones.map((milestone) => `<span class="milestone-chip" title="${escapeHtml(milestone.detail)}">${escapeHtml(milestone.label)}</span>`).join("")
    : `<span class="milestone-chip quiet">Milestones unlock as the trail grows</span>`;

  elements.postDrafts.innerHTML = drafts.length
    ? drafts.map((draft) => renderDraftCard(draft)).join("")
    : `<div class="empty-state"><p>Capture a signal or let the watcher run and drafts will compose themselves here.</p></div>`;

  for (const button of elements.postDrafts.querySelectorAll("[data-platform]")) {
    button.addEventListener("click", () => {
      state.draftPlatform[button.dataset.draft] = button.dataset.platform;
      renderShareStudio();
    });
  }

  for (const button of elements.postDrafts.querySelectorAll("[data-draft-copy]")) {
    button.addEventListener("click", () => {
      const draft = drafts.find((item) => item.id === button.dataset.draftCopy);
      if (!draft) return;
      const platformId = state.draftPlatform[draft.id] || "x";
      const variant = draft.variants[platformId];
      const payload = variant.parts ? variant.parts.join("\n\n---\n\n") : variant.text;
      logAction("draft_copied", `Copied a ${draft.style.replaceAll("_", " ")} draft for ${PLATFORMS[platformId].label}`, { style: draft.style, platform: platformId });
      copyText(payload);
    });
  }
}

function renderDraftCard(draft) {
  const platformId = state.draftPlatform[draft.id] || "x";
  const variant = draft.variants[platformId];
  const limit = PLATFORMS[platformId].limit;
  const fitNote = variant.parts
    ? `thread of ${variant.parts.length}`
    : `${variant.text.length}/${limit} chars`;
  const body = variant.parts
    ? variant.parts.map((part) => `<p class="thread-part">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`).join("")
    : `<p>${escapeHtml(variant.text).replaceAll("\n", "<br>")}</p>`;

  return `
    <article class="draft-card">
      <div class="draft-meta">
        <span class="chip">${escapeHtml(draft.style.replaceAll("_", " "))}</span>
        <span class="${variant.parts || variant.text.length > limit ? "long" : "fits"}">${fitNote}</span>
      </div>
      <div class="platform-tabs">
        ${Object.entries(PLATFORMS).map(([id, platform]) => `
          <button class="platform-tab ${platformId === id ? "active" : ""}" type="button" data-draft="${escapeHtml(draft.id)}" data-platform="${id}">${platform.label}</button>
        `).join("")}
      </div>
      ${body}
      <div class="tile-actions">
        <button class="secondary-button" type="button" data-draft-copy="${escapeHtml(draft.id)}">Copy for ${PLATFORMS[platformId].label}</button>
      </div>
    </article>
  `;
}

function renderAuditTimeline() {
  if (state.auditEvents.length === 0) {
    elements.auditTimeline.innerHTML = `<div class="empty-state"><p>No tracked activity yet. Use the desk, or run <code>npm run track:watch</code> alongside your editor to follow git activity automatically.</p></div>`;
    return;
  }

  const groups = [...groupEventsByDay(state.auditEvents).entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3);

  elements.auditTimeline.innerHTML = groups
    .map(([day, events]) => {
      const recent = [...events].reverse();
      const shown = recent.slice(0, 25);
      const hidden = recent.length - shown.length;
      return `
        <div class="audit-day">
          <div class="audit-day-head">
            <h3>${escapeHtml(day)}</h3>
            <span>${events.length} events</span>
          </div>
          ${shown.map((event) => `
            <div class="audit-row">
              <span class="audit-time">${escapeHtml(clock(event.ts))}</span>
              <span class="audit-source ${escapeHtml(event.source)}">${escapeHtml(event.source)}</span>
              <div>
                <strong>${escapeHtml(EVENT_KIND_LABELS[event.kind] || event.kind.replaceAll("_", " "))}</strong>
                <p>${escapeHtml(event.summary)}</p>
              </div>
            </div>
          `).join("")}
          ${hidden > 0 ? `<p class="tiny-note">${hidden} earlier events in the export.</p>` : ""}
        </div>
      `;
    })
    .join("");
}

function clock(ts) {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderRedactionQueue() {
  const signalItems = [
    ...state.localSignals.map((signal) => ({
      id: signal.id,
      title: signal.title,
      status: signal.redactionStatus || "pending",
      source: signal.sourceType || "local_capture",
      reason: "Local capture needs proof and redaction review before it can become a candidate."
    })),
    ...state.model.signals
      .filter((signal) => signal.rawAssetLocalOnly || signal.redactionStatus !== "not_needed")
      .map((signal) => ({
        id: signal.id,
        title: signal.title,
        status: signal.redactionStatus,
        source: signal.sourceType,
        reason: signal.redactionNotes || "Review redaction status before public use."
      }))
  ];

  const candidateItems = state.model.candidates
    .filter((candidate) => candidate.blockedReasons.length > 0 || candidate.risk !== "low")
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.draft,
      status: candidate.manualApproval,
      source: candidate.type,
      reason: candidate.blockedReasons.concat(candidate.riskNotes).join(" ")
    }));

  const items = [...signalItems, ...candidateItems];
  elements.redactionQueue.innerHTML = items.length
    ? items.map((item) => `
      <article class="redaction-card ${escapeHtml(item.status)}">
        <div>
          <p class="eyebrow">${escapeHtml(item.source.replaceAll("_", " "))}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.reason)}</p>
        </div>
        <span>${escapeHtml(item.status.replaceAll("_", " "))}</span>
      </article>
    `).join("")
    : `<div class="empty-state"><p>No pending redaction work. New captures will appear here before they can become candidates.</p></div>`;
}

function renderArcSelect() {
  elements.arcSelect.innerHTML = state.model.threads
    .map((thread) => `<option value="${escapeHtml(thread.id)}">${escapeHtml(thread.name)}</option>`)
    .join("");
}

function renderTopbar() {
  elements.topOutcome.textContent = state.model.topOutcome;
  elements.statusMetrics.innerHTML = [
    ["Signals", state.model.metrics.signals + state.localSignals.length],
    ["Proofs", state.model.metrics.proofs],
    ["Candidates", state.model.metrics.candidates],
    ["Strong", state.model.metrics.publishCandidates]
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderToday() {
  const top = state.model.candidates[0];
  elements.todayMove.innerHTML = `
    <article class="today-card primary">
      <p class="eyebrow">Best public move</p>
      <h3>${escapeHtml(top.draft)}</h3>
      <p>${escapeHtml(top.readerValue)}</p>
      <div class="chip-row">
        <span class="chip">${escapeHtml(top.statusLabel)}</span>
        <span class="chip">${escapeHtml(top.deploymentLabel)}</span>
        <span class="chip">Manual approval required</span>
      </div>
    </article>
    <article class="today-card">
      <p class="eyebrow">Truth boundary</p>
      <h3>No post leaves Trackoor automatically.</h3>
      <p>${escapeHtml(state.model.meta.publishingBoundary)}</p>
      <div class="gate-list">
        <span>Proof attached</span>
        <span>Redaction checked</span>
        <span>Deployment truth visible</span>
        <span>Owner review required</span>
      </div>
    </article>
  `;
}

function renderThreads() {
  elements.threadRail.innerHTML = state.model.threads
    .map((thread) => `
      <button class="thread-pill ${thread.energy}" type="button" data-thread="${escapeHtml(thread.id)}">
        <span>${escapeHtml(thread.name)}</span>
        <small>${thread.signalCount} signals</small>
      </button>
    `)
    .join("");
}

function renderSignalCanvas() {
  const rawSignals = state.localSignals.map((signal) => ({ ...signal, stage: "Raw Signals", localOnly: true }));
  const storySeeds = state.model.signals
    .filter((signal) => signal.heat === "medium")
    .map((signal) => ({ ...signal, stage: "Story Seeds" }));
  const proofMoments = state.model.signals
    .filter((signal) => signal.heat === "high")
    .map((signal) => ({ ...signal, stage: "Proof Moments" }));
  const ready = state.model.candidates
    .filter((candidate) => candidate.status === "publish_candidate")
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.draft,
      whyItMatters: candidate.readerValue,
      sourceType: candidate.type,
      heat: "strong",
      artifactId: candidate.artifactId,
      stage: "Strong Candidates"
    }));

  const columns = [
    ["Raw Signals", rawSignals],
    ["Story Seeds", storySeeds],
    ["Proof Moments", proofMoments],
    ["Strong Candidates", ready]
  ];

  elements.signalCanvas.innerHTML = columns
    .map(([title, items]) => `
      <section class="canvas-column">
        <div class="column-heading">
          <h3>${title}</h3>
          <span>${items.length}</span>
        </div>
        ${items.length ? items.map(renderSignalTile).join("") : renderEmptyColumn(title)}
      </section>
    `)
    .join("");

  for (const button of elements.signalCanvas.querySelectorAll("[data-artifact]")) {
    button.addEventListener("click", () => {
      state.selectedArtifactId = button.dataset.artifact;
      renderArtifacts();
    });
  }
}

function renderSignalTile(item) {
  const artifactButton = item.artifactId
    ? `<button class="text-button" type="button" data-artifact="${escapeHtml(item.artifactId)}">Open artifact</button>`
    : `<button class="text-button" type="button" disabled>Attach proof first</button>`;

  return `
    <article class="signal-tile">
      <div class="tile-topline">
        <span class="source-badge">${escapeHtml(item.sourceType || item.source || "signal")}</span>
        <span class="energy-dot ${escapeHtml(item.heat || "medium")}"></span>
      </div>
      <h4>${escapeHtml(item.title)}</h4>
      <p>${escapeHtml(item.whyItMatters)}</p>
      <div class="tile-actions">
        <button class="text-button" type="button">Distill</button>
        <button class="text-button" type="button">Remix</button>
        ${artifactButton}
      </div>
      ${item.redactionStatus ? `<p class="tiny-note">Redaction: ${escapeHtml(item.redactionStatus)}</p>` : ""}
    </article>
  `;
}

function renderEmptyColumn(title) {
  const copy = {
    "Raw Signals": "Capture a build note, bug, proof, or open loop.",
    "Story Seeds": "Medium-heat signals will collect here.",
    "Proof Moments": "High-heat proof-backed moments will collect here.",
    "Strong Candidates": "Only proof-backed candidates appear here."
  };
  return `<div class="empty-state"><p>${escapeHtml(copy[title])}</p></div>`;
}

function renderCandidateFilters() {
  const filters = [
    ["all", "All"],
    ["publish_candidate", "Strong"],
    ["revise", "Review"],
    ["archive_or_ignore", "Resting"]
  ];

  elements.candidateFilters.innerHTML = filters
    .map(([id, label]) => `<button class="${state.candidateFilter === id ? "active" : ""}" type="button" data-filter="${id}">${label}</button>`)
    .join("");

  for (const button of elements.candidateFilters.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.candidateFilter = button.dataset.filter;
      renderCandidateFilters();
      renderCandidates();
    });
  }
}

function renderCandidates() {
  const candidates = filterCandidates(state.model.candidates, state.candidateFilter);
  elements.candidateGrid.innerHTML = candidates
    .map((candidate) => `
      <article class="candidate-card">
        <div class="card-header">
          <span class="score-ring">${candidate.score}</span>
          <div>
            <p class="eyebrow">${escapeHtml(candidate.type.replaceAll("_", " "))}</p>
            <h3>${escapeHtml(candidate.statusLabel)}</h3>
          </div>
        </div>
        <p class="draft-copy">${escapeHtml(candidate.draft)}</p>
        <p class="reader-value">${escapeHtml(candidate.readerValue)}</p>
        <div class="truth-grid">
          <span>${escapeHtml(candidate.deploymentLabel)}</span>
          <span>${escapeHtml(candidate.manualApproval.replaceAll("_", " "))}</span>
          <span>${escapeHtml(candidate.risk)} risk</span>
        </div>
        <div class="risk-list">
          ${(candidate.blockedReasons.length ? candidate.blockedReasons : candidate.riskNotes).map((note) => `<span>${escapeHtml(note)}</span>`).join("")}
        </div>
        <div class="tile-actions">
          <button class="secondary-button" type="button" data-artifact="${escapeHtml(candidate.artifactId)}">Preview</button>
          <button class="secondary-button" type="button" data-copy="${escapeHtml(candidate.id)}">Copy Draft</button>
        </div>
      </article>
    `)
    .join("");

  for (const button of elements.candidateGrid.querySelectorAll("[data-artifact]")) {
    button.addEventListener("click", () => {
      state.selectedArtifactId = button.dataset.artifact;
      renderArtifacts();
      document.querySelector("#artifactDrawer").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  for (const button of elements.candidateGrid.querySelectorAll("[data-copy]")) {
    button.addEventListener("click", () => {
      const candidate = state.model.candidates.find((item) => item.id === button.dataset.copy);
      logAction("draft_copied", `Copied candidate draft ${candidate.id}`, { candidateId: candidate.id });
      copyText(`${candidate.draft}\n\nProof refs: ${candidate.evidenceRefs.join(", ")}\nStatus: ${candidate.deploymentLabel}\nManual approval: ${candidate.manualApproval}`);
    });
  }
}

function renderArtifacts() {
  elements.artifactChooser.innerHTML = state.model.artifacts
    .map((artifact) => `
      <button class="${state.selectedArtifactId === artifact.id ? "active" : ""}" type="button" data-artifact="${escapeHtml(artifact.id)}">
        ${escapeHtml(artifact.name)}
      </button>
    `)
    .join("");

  for (const button of elements.artifactChooser.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      state.selectedArtifactId = button.dataset.artifact;
      logAction("artifact_viewed", `Opened the ${button.textContent.trim()} artifact`, { artifactId: button.dataset.artifact });
      renderArtifacts();
    });
  }

  const artifact = state.model.artifacts.find((item) => item.id === state.selectedArtifactId) || state.model.artifacts[0];
  elements.selectedArtifactName.textContent = artifact.name;
  elements.artifactPreview.innerHTML = renderArtifact(artifact);
}

function renderArtifact(artifact) {
  if (artifact.type === "ledger") {
    return `
      <div class="artifact-card">
        <p>${escapeHtml(artifact.summary)}</p>
        <div class="ledger-table">
          ${artifact.rows.map((row) => `
            <div class="ledger-row">
              <strong>${escapeHtml(row.project)}</strong>
              <span>${escapeHtml(row.local)}</span>
              <span>${escapeHtml(row.committed)}</span>
              <span>${escapeHtml(row.pushed)}</span>
              <span>${escapeHtml(row.live)}</span>
              <small>${escapeHtml(row.next)}</small>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (artifact.type === "storyboard") {
    return `
      <div class="storyboard">
        ${artifact.panels.map((panel, index) => `
          <article>
            <span>Panel ${index + 1}</span>
            <h3>${escapeHtml(panel.title)}</h3>
            <p>${escapeHtml(panel.body)}</p>
          </article>
        `).join("")}
      </div>
    `;
  }

  if (artifact.type === "constellation") {
    return `
      <div class="constellation">
        <p>${escapeHtml(artifact.summary)}</p>
        ${artifact.nodes.map((node) => `<span class="${escapeHtml(node.kind)}">${escapeHtml(node.label)}</span>`).join("")}
      </div>
    `;
  }

  return `
    <div class="artifact-card warning">
      <h3>${escapeHtml(artifact.name)}</h3>
      <p>${escapeHtml(artifact.summary)}</p>
      <p><strong>Gate:</strong> ${escapeHtml(artifact.gate || "Manual review required")}</p>
      <p><strong>Next:</strong> ${escapeHtml(artifact.next || "Attach proof before export.")}</p>
    </div>
  `;
}

function renderProofShelf() {
  elements.proofShelf.innerHTML = state.model.proofs
    .map((proof) => `
      <article class="proof-card ${proof.publicSafe ? "safe" : "private"}">
        <p class="eyebrow">${escapeHtml(proof.kind.replaceAll("_", " "))}</p>
        <h3>${escapeHtml(proof.name)}</h3>
        <p>${escapeHtml(proof.summary)}</p>
        <div class="chip-row">
          <span class="chip">${escapeHtml(proof.strength)} proof</span>
          <span class="chip">${escapeHtml(proof.status)}</span>
          <span class="chip">${proof.publicSafe ? "public-safe summary" : "local/private"}</span>
        </div>
      </article>
    `)
    .join("");
}

function renderDistributionLedger() {
  elements.distributionLedger.innerHTML = state.model.distributionLedger
    .map((entry) => `
      <article class="ledger-card">
        <strong>${escapeHtml(entry.status.replaceAll("_", " "))}</strong>
        <span>${escapeHtml(entry.channel)}</span>
        <p>${escapeHtml(entry.learning)}</p>
      </article>
    `)
    .join("");
}

function downloadJson(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Draft copied locally. Manual review still required before posting.");
  } catch {
    showToast("Clipboard unavailable. Select and copy the draft manually.");
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function saveLocalSignals() {
  try {
    state.localSignals = saveSignalsToStorage(window.localStorage, state.localSignals);
  } catch {
    showToast("Local storage unavailable. Signal kept only for this page session.");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
