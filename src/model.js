export const STATUS_LABELS = {
  publish_candidate: "Strong Candidate",
  revise: "Needs Review",
  archive_or_ignore: "Resting Shelf"
};

export const DEPLOYMENT_LABELS = {
  local_only: "Local only",
  committed: "Committed, not pushed",
  pushed: "Pushed, not deployed",
  deployed: "Deployed, not live-verified",
  live_verified: "Live verified",
  blocked: "Blocked: deployment truth unclear",
  not_applicable: "Not applicable",
  unknown: "Unknown"
};

export const REQUIRED_ROOT_KEYS = [
  "meta",
  "threads",
  "activityBlocks",
  "signals",
  "proofs",
  "candidates",
  "artifacts",
  "distributionLedger",
  "safetyRules"
];

export const CANDIDATE_SCORE_KEYS = [
  "proofStrength",
  "artifactQuality",
  "novelty",
  "audienceFit",
  "freshness",
  "copyRisk",
  "secretRisk",
  "deploymentTruth",
  "effortToShip"
];

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const UNSAFE_TEXT_PATTERNS = [
  /<script/i,
  /javascript:/i,
  /\son[a-z]+\s*=/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /\b(api[_-]?key|secret|password|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9._/-]{12,}/i
];

export function validateBuildSignal(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["root must be an object"];
  }

  for (const key of REQUIRED_ROOT_KEYS) {
    if (!(key in data)) errors.push(`root missing ${key}`);
  }

  if (data.meta?.manualOnly !== true) {
    errors.push("meta.manualOnly must be true");
  }

  for (const [collectionName, collection] of Object.entries({
    threads: data.threads,
    activityBlocks: data.activityBlocks,
    signals: data.signals,
    proofs: data.proofs,
    candidates: data.candidates,
    artifacts: data.artifacts,
    distributionLedger: data.distributionLedger
  })) {
    if (!Array.isArray(collection)) {
      errors.push(`${collectionName} must be an array`);
      continue;
    }
    assertUniqueIds(collectionName, collection, errors);
  }

  scanUnsafeStrings(data, "root", errors);

  const threadIds = new Set((data.threads || []).map((item) => item.id));
  const proofIds = new Set((data.proofs || []).map((item) => item.id));
  const artifactIds = new Set((data.artifacts || []).map((item) => item.id));

  for (const signal of data.signals || []) {
    requireFields(`signal ${signal.id || "unknown"}`, signal, [
      "id",
      "threadId",
      "sourceType",
      "sourceRef",
      "proofRef",
      "capturedAt",
      "ownerReviewRequired",
      "rawAssetLocalOnly",
      "redactionStatus",
      "reviewedBy",
      "title",
      "whyItMatters",
      "evidenceRefs"
    ], errors);
    checkId(`signal ${signal.id || "unknown"}`, signal.id, errors);
    if (!threadIds.has(signal.threadId)) errors.push(`signal ${signal.id} has unknown threadId ${signal.threadId}`);
    if (!proofIds.has(signal.proofRef)) errors.push(`signal ${signal.id} has unknown proofRef ${signal.proofRef}`);
    if (Number.isNaN(Date.parse(signal.capturedAt))) errors.push(`signal ${signal.id} has invalid capturedAt`);
    if (signal.ownerReviewRequired !== true) errors.push(`signal ${signal.id} must require owner review`);
    if (!["not_needed", "pending", "redacted", "blocked"].includes(signal.redactionStatus)) {
      errors.push(`signal ${signal.id} has invalid redactionStatus`);
    }
  }

  for (const block of data.activityBlocks || []) {
    requireFields(`activityBlock ${block.id || "unknown"}`, block, [
      "id",
      "intervalStart",
      "intervalEnd",
      "projects",
      "threads",
      "privacyClass",
      "activityMix",
      "narrative",
      "evidenceRefs"
    ], errors);
    checkId(`activityBlock ${block.id || "unknown"}`, block.id, errors);
    for (const threadId of block.threads || []) {
      if (!threadIds.has(threadId)) errors.push(`activityBlock ${block.id} has unknown threadId ${threadId}`);
    }
    for (const proofId of block.evidenceRefs || []) {
      if (!proofIds.has(proofId)) errors.push(`activityBlock ${block.id} has unknown proof ${proofId}`);
    }
  }

  for (const proof of data.proofs || []) {
    requireFields(`proof ${proof.id || "unknown"}`, proof, ["id", "name", "kind", "strength", "status", "publicSafe", "summary"], errors);
    checkId(`proof ${proof.id || "unknown"}`, proof.id, errors);
    if (!["weak", "usable", "strong"].includes(proof.strength)) errors.push(`proof ${proof.id} has invalid strength`);
  }

  for (const candidate of data.candidates || []) {
    requireFields(`candidate ${candidate.id || "unknown"}`, candidate, [
      "id",
      "threadId",
      "artifactId",
      "type",
      "status",
      "score",
      "scores",
      "risk",
      "deploymentTruth",
      "ownerReviewRequired",
      "manualApproval",
      "draft",
      "readerValue",
      "evidenceRefs",
      "riskNotes",
      "gates"
    ], errors);
    checkId(`candidate ${candidate.id || "unknown"}`, candidate.id, errors);
    if (!threadIds.has(candidate.threadId)) errors.push(`candidate ${candidate.id} has unknown threadId ${candidate.threadId}`);
    if (!artifactIds.has(candidate.artifactId)) errors.push(`candidate ${candidate.id} has unknown artifactId ${candidate.artifactId}`);
    for (const proofId of candidate.evidenceRefs || []) {
      if (!proofIds.has(proofId)) errors.push(`candidate ${candidate.id} has unknown proof ${proofId}`);
    }
    validateCandidateScores(candidate, errors);
    validateCandidateGate(candidate, errors);
  }

  return errors;
}

export function buildDashboardModel(data) {
  const proofById = indexById(data.proofs);
  const threadById = indexById(data.threads);
  const artifactById = indexById(data.artifacts);
  const candidates = [...data.candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const bestCandidate = candidates.find((candidate) => candidate.status === "publish_candidate") || candidates[0] || null;

  return {
    meta: data.meta,
    topOutcome: bestCandidate ? bestCandidate.readerValue : "No candidate has enough signal yet.",
    metrics: {
      signals: data.signals.length,
      proofs: data.proofs.length,
      candidates: data.candidates.length,
      publishCandidates: data.candidates.filter((candidate) => candidate.status === "publish_candidate").length
    },
    threads: data.threads.map((thread) => ({
      ...thread,
      signalCount: data.signals.filter((signal) => signal.threadId === thread.id).length,
      candidateCount: data.candidates.filter((candidate) => candidate.threadId === thread.id).length
    })),
    signals: data.signals.map((signal) => ({
      ...signal,
      thread: threadById.get(signal.threadId),
      proof: proofById.get(signal.proofRef)
    })),
    candidates: candidates.map((candidate) => ({
      ...candidate,
      statusLabel: STATUS_LABELS[candidate.status] || candidate.status,
      deploymentLabel: DEPLOYMENT_LABELS[candidate.deploymentTruth] || candidate.deploymentTruth,
      thread: threadById.get(candidate.threadId),
      artifact: artifactById.get(candidate.artifactId),
      proofs: candidate.evidenceRefs.map((id) => proofById.get(id)).filter(Boolean),
      blockedReasons: getCandidateBlockedReasons(candidate)
    })),
    artifacts: data.artifacts,
    proofs: data.proofs,
    distributionLedger: data.distributionLedger,
    safetyRules: data.safetyRules
  };
}

export function generateDailySummary(data) {
  const model = buildDashboardModel(data);
  const publishable = model.candidates.filter((candidate) => candidate.status === "publish_candidate");
  const blocked = model.candidates.filter((candidate) => candidate.blockedReasons.length > 0);
  return {
    date: data.meta.date,
    topOutcome: model.topOutcome,
    shipped: data.activityBlocks.map((block) => block.narrative.whatChanged),
    learned: data.activityBlocks.map((block) => block.narrative.lesson),
    blockedOn: blocked.map((candidate) => `${candidate.id}: ${candidate.blockedReasons.join(", ")}`),
    proofRefs: data.proofs.map((proof) => proof.id),
    bestTweetCandidates: publishable.map((candidate) => ({
      id: candidate.id,
      draft: candidate.draft,
      evidenceRefs: candidate.evidenceRefs,
      riskLevel: candidate.risk
    })),
    doNotPublish: model.candidates
      .filter((candidate) => candidate.status === "archive_or_ignore" || candidate.blockedReasons.length > 0)
      .map((candidate) => candidate.id)
  };
}

export function getCandidateBlockedReasons(candidate) {
  const reasons = [];
  if (!candidate.evidenceRefs?.length) reasons.push("Proof missing");
  if (candidate.ownerReviewRequired !== true) reasons.push("Manual approval required");
  if (candidate.manualApproval === "blocked") reasons.push("Manual approval blocked");
  if (candidate.gates?.secretScan !== "pass") reasons.push("Secret scan pending");
  if (!["pass", "weak"].includes(candidate.gates?.claimSupport)) reasons.push("Unsupported claim");
  if (["blocked", "unknown"].includes(candidate.deploymentTruth)) reasons.push("Blocked: deployment truth unclear");
  if (candidate.gates?.manualOnly !== "pass") reasons.push("Manual-only boundary failed");
  return reasons;
}

export function filterCandidates(candidates, filter) {
  if (!filter || filter === "all") return candidates;
  return candidates.filter((candidate) => candidate.status === filter);
}

export function scoreTotal(scores) {
  return CANDIDATE_SCORE_KEYS.reduce((total, key) => total + Number(scores?.[key] || 0), 0);
}

function assertUniqueIds(collectionName, collection, errors) {
  const seen = new Set();
  for (const item of collection) {
    if (!item || typeof item !== "object") {
      errors.push(`${collectionName} contains a non-object item`);
      continue;
    }
    checkId(`${collectionName} item`, item.id, errors);
    if (item.id && seen.has(item.id)) errors.push(`${collectionName} duplicate id ${item.id}`);
    if (item.id) seen.add(item.id);
  }
}

function checkId(label, id, errors) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) errors.push(`${label} has invalid id ${id}`);
}

function requireFields(label, item, fields, errors) {
  for (const field of fields) {
    if (!(field in item) || item[field] === null || item[field] === undefined || item[field] === "") {
      errors.push(`${label} missing ${field}`);
    }
  }
}

function validateCandidateScores(candidate, errors) {
  if (typeof candidate.score !== "number" || candidate.score < 0 || candidate.score > 100) {
    errors.push(`candidate ${candidate.id} score must be 0-100`);
  }
  for (const key of CANDIDATE_SCORE_KEYS) {
    const value = candidate.scores?.[key];
    if (typeof value !== "number" || value < 0 || value > 25) {
      errors.push(`candidate ${candidate.id} scores.${key} must be a bounded number`);
    }
  }
  const total = scoreTotal(candidate.scores);
  if (total !== candidate.score) {
    errors.push(`candidate ${candidate.id} score ${candidate.score} does not equal score parts ${total}`);
  }
}

function validateCandidateGate(candidate, errors) {
  const reasons = getCandidateBlockedReasons(candidate);
  if (candidate.status === "publish_candidate" && reasons.length > 0) {
    errors.push(`candidate ${candidate.id} is publish_candidate but blocked: ${reasons.join(", ")}`);
  }
  if (candidate.status === "publish_candidate" && candidate.score < 80) {
    errors.push(`candidate ${candidate.id} is publish_candidate below 80`);
  }
}

function scanUnsafeStrings(value, path, errors) {
  if (typeof value === "string") {
    for (const pattern of UNSAFE_TEXT_PATTERNS) {
      if (pattern.test(value)) errors.push(`${path} contains unsafe text pattern ${pattern}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanUnsafeStrings(item, `${path}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      scanUnsafeStrings(child, `${path}.${key}`, errors);
    }
  }
}

function indexById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}
