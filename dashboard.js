const LATEST_RESULT_KEY = "latestAnalysis";
const KW_STORAGE_KEY = "serviceKeywords";
const MAX_PAGE_BODY_CHARS = 700;
const MAX_SUMMARY_BODY_CHARS = 1000;

let latestResult = null;
let serviceKeywords = [];

const elements = {
  provider: document.getElementById("provider"),
  groqFields: document.getElementById("groqFields"),
  openrouterFields: document.getElementById("openrouterFields"),
  ollamaFields: document.getElementById("ollamaFields"),
  groqApiKey: document.getElementById("groqApiKey"),
  openrouterApiKey: document.getElementById("openrouterApiKey"),
  ollamaBaseUrl: document.getElementById("ollamaBaseUrl"),
  saveSettings: document.getElementById("saveSettings"),
  targetUrl: document.getElementById("targetUrl"),
  analyzeUrl: document.getElementById("analyzeUrl"),
  analyzeCurrent: document.getElementById("analyzeCurrent"),
  analyzeEmployees: document.getElementById("analyzeEmployees"),
  status: document.getElementById("status"),
  scopeBadge: document.getElementById("scopeBadge"),
  domainBadge: document.getElementById("domainBadge"),
  progressBar: document.getElementById("progressBar"),
  recentSiteNote: document.getElementById("recentSiteNote"),
  emptyState: document.getElementById("emptyState"),
  classificationStrip: document.getElementById("classificationStrip"),
  csBusinessType: document.getElementById("cs-businessType"),
  csIndustry: document.getElementById("cs-industry"),
  csServices: document.getElementById("cs-services"),
  csConfidenceWrap: document.getElementById("cs-confidenceWrap"),
  csConfidence: document.getElementById("cs-confidence"),
  result: document.getElementById("result"),
  businessType: document.getElementById("businessType"),
  confidence: document.getElementById("confidence"),
  summary: document.getElementById("summary"),
  industry: document.getElementById("industry"),
  peopleCount: document.getElementById("peopleCount"),
  pageCount: document.getElementById("pageCount"),
  websiteSignals: document.getElementById("websiteSignals"),
  services: document.getElementById("services"),
  people: document.getElementById("people"),
  peopleGrid: document.getElementById("peopleGrid"),
  peopleGridPanel: document.getElementById("peopleGridPanel"),
  teamSummary: document.getElementById("teamSummary"),
  evidence: document.getElementById("evidence"),
  raw: document.getElementById("raw"),
  copyJson: document.getElementById("copyJson"),
  exportCsv: document.getElementById("exportCsv")
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#b42318" : "#486581";
}

function setProgress(percent) {
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function updateDomainBadge(url) {
  if (!url) {
    elements.domainBadge.textContent = "No site selected";
    return;
  }
  try {
    elements.domainBadge.textContent = new URL(url).hostname;
  } catch {
    elements.domainBadge.textContent = url;
  }
}

function setBusy(isBusy) {
  elements.saveSettings.disabled = isBusy;
  elements.analyzeUrl.disabled = isBusy;
  elements.analyzeCurrent.disabled = isBusy;
  elements.analyzeEmployees.disabled = isBusy || !latestResult?.url;
}

function setEmployeeButtonState() {
  elements.analyzeEmployees.disabled = !latestResult?.url;
}

function updateProviderFields(provider) {
  const isGroq = provider === "groq";
  const isOpenRouter = provider === "openrouter";
  const isOllama = provider === "ollama";
  elements.groqFields.classList.toggle("hidden", !isGroq);
  elements.openrouterFields.classList.toggle("hidden", !isOpenRouter);
  elements.ollamaFields.classList.toggle("hidden", !isOllama);
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(["providerApiKeys", "provider", "ollamaBaseUrl"]);
  const sessionStored = await chrome.storage.session.get(["providerApiKeys", "provider", "ollamaBaseUrl"]);
  const localStored = await chrome.storage.local.get(["providerApiKeys", "provider", "ollamaBaseUrl"]);
  const providerApiKeys = {
    ...(localStored.providerApiKeys || {}),
    ...(stored.providerApiKeys || {}),
    ...(sessionStored.providerApiKeys || {})
  };
  const provider = sessionStored.provider || stored.provider || localStored.provider || "groq";
  const ollamaBaseUrl = sessionStored.ollamaBaseUrl || stored.ollamaBaseUrl || localStored.ollamaBaseUrl || "http://localhost:11434";

  elements.groqApiKey.value = providerApiKeys.groq || "";
  elements.openrouterApiKey.value = providerApiKeys.openrouter || "";
  elements.provider.value = provider;
  elements.ollamaBaseUrl.value = ollamaBaseUrl;
  updateProviderFields(provider);
}

async function saveSettings() {
  const providerApiKeys = {
    groq: elements.groqApiKey.value.trim(),
    openrouter: elements.openrouterApiKey.value.trim()
  };
  const provider = elements.provider.value;
  const ollamaBaseUrl = elements.ollamaBaseUrl.value.trim() || "http://localhost:11434";
  await chrome.storage.sync.set({ provider, ollamaBaseUrl });
  await chrome.storage.session.set({ providerApiKeys, provider, ollamaBaseUrl });
  setStatus("Settings saved.");
}

function fillList(target, items, emptyText = "None found.") {
  target.replaceChildren();
  const values = items?.length ? items : [emptyText];
  for (const item of values) {
    const li = document.createElement("li");
    li.textContent = item;
    target.appendChild(li);
  }
}

function normalizePeople(people) {
  return (people || [])
    .map((person) => {
      if (!person || typeof person !== "object") {
        return null;
      }
      const normalized = {
        name: String(person.name || "").trim(),
        title: String(person.title || "").trim(),
        email: String(person.email || "").trim(),
        phone: String(person.phone || "").trim(),
        linkedinUrl: String(person.linkedinUrl || "").trim()
      };
      return normalized.name ? normalized : null;
    })
    .filter(Boolean);
}

function dedupePeople(people) {
  const map = new Map();
  for (const person of people || []) {
    if (!person || typeof person !== "object") continue;
    const name = String(person.name || "").trim();
    if (!name) continue;
    const key = `${name.toLowerCase()}|${String(person.title || "").trim().toLowerCase()}`;
    if (!map.has(key)) map.set(key, person);
  }
  return [...map.values()];
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSupportedUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function normalizeUrl(input) {
  const value = input.trim();
  if (!value) {
    throw new Error("Enter a domain or full URL.");
  }
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function buildCsvRow(entry) {
  return [
    entry.analyzedAt,
    entry.title,
    entry.url,
    entry.businessType,
    entry.industry,
    entry.confidence,
    (entry.services || []).join(" | "),
    normalizePeople(entry.people).map((person) => person.name).join(" | "),
    entry.teamSummary,
    entry.summary,
    (entry.evidence || []).join(" | "),
    entry.websiteSignals
  ].map(csvEscape).join(",");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderPeople(target, people) {
  target.replaceChildren();
  const entries = normalizePeople(people);
  if (!entries.length) {
    const li = document.createElement("li");
    li.textContent = latestResult?.employeeAnalysisComplete
      ? "No team or people details found."
      : "Run Analyze Employee Details to load people information.";
    target.appendChild(li);
    return;
  }
  for (const person of entries) {
    const li = document.createElement("li");
    li.textContent = [person.name, person.title, person.email, person.phone, person.linkedinUrl].filter(Boolean).join(" | ");
    target.appendChild(li);
  }
}

function makeCopyCell(value) {
  const td = document.createElement("td");
  if (!value) return td;
  td.className = "pg-cell";
  const span = document.createElement("span");
  span.className = "pg-cell-text";
  span.textContent = value;
  const btn = document.createElement("button");
  btn.className = "pg-copy-btn";
  btn.title = "Copy";
  btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M3 11H2a1 1 0 01-1-1V2a1 1 0 011-1h8a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(value).then(() => {
      btn.classList.add("pg-copy-btn--copied");
      setTimeout(() => btn.classList.remove("pg-copy-btn--copied"), 1500);
    });
  });
  td.appendChild(span);
  td.appendChild(btn);
  return td;
}

function renderPeopleGrid(target, people) {
  target.replaceChildren();
  const entries = normalizePeople(people);
  if (!entries.length) {
    const msg = document.createElement("p");
    msg.className = "placeholder-text";
    msg.textContent = latestResult?.employeeAnalysisComplete
      ? "No team or people details found."
      : "Run Analyze Employees to load people.";
    target.appendChild(msg);
    return;
  }
  const table = document.createElement("table");
  table.className = "people-grid";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  for (const col of ["Name", "Title", "Email", "Phone", "LinkedIn"]) {
    const th = document.createElement("th");
    th.textContent = col;
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const person of entries) {
    const tr = document.createElement("tr");
    tr.appendChild(makeCopyCell(person.name));
    tr.appendChild(makeCopyCell(person.title));
    tr.appendChild(makeCopyCell(person.email));
    tr.appendChild(makeCopyCell(person.phone));
    tr.appendChild(makeCopyCell(person.linkedinUrl));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  target.appendChild(table);
}

function trimText(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function compactPageData(page) {
  return {
    title: page.title,
    url: page.url,
    description: trimText(page.description, 160),
    headings: (page.headings || []).slice(0, 6),
    people: normalizePeople(page.people).slice(0, 6),
    teamSnippets: (page.teamSnippets || []).slice(0, 3).map((item) => trimText(item, 120)),
    bodyText: trimText(page.bodyText, MAX_PAGE_BODY_CHARS)
  };
}

function compactResearchPayload(pageData, maxPages = MAX_RESEARCH_PAGES) {
  const discoveredPages = (pageData.discoveredPages || []).slice(0, maxPages).map(compactPageData);
  return {
    title: pageData.title,
    url: pageData.url,
    description: trimText(pageData.description, 180),
    headings: (pageData.headings || []).slice(0, 8),
    metadata: Object.fromEntries(Object.entries(pageData.metadata || {}).slice(0, 8)),
    bodyText: trimText(pageData.bodyText, MAX_SUMMARY_BODY_CHARS),
    people: normalizePeople(pageData.people).slice(0, 8),
    teamSnippets: (pageData.teamSnippets || []).slice(0, 4).map((item) => trimText(item, 120)),
    discoveredPages
  };
}

// ── Service keyword triggers ─────────────────────────────────

function renderKeywordTags() {
  const container = document.getElementById("kwTags");
  const statusEl = document.getElementById("kwStatus");
  container.replaceChildren();
  serviceKeywords.forEach((kw, i) => {
    const span = document.createElement("span");
    span.className = "kw-tag";
    span.innerHTML = `${kw}<span class="kw-tag-del" data-i="${i}">\u00d7</span>`;
    container.appendChild(span);
  });
  if (serviceKeywords.length === 0) {
    statusEl.className = "kw-status kw-status--idle";
    statusEl.textContent = "No keywords set";
  } else {
    statusEl.className = "kw-status kw-status--match";
    statusEl.textContent = `Auto-trigger active \u2014 ${serviceKeywords.length} keyword${serviceKeywords.length > 1 ? "s" : ""}`;
  }
}

async function saveKeywords() {
  await chrome.storage.local.set({ [KW_STORAGE_KEY]: serviceKeywords });
}

async function loadKeywords() {
  const stored = await chrome.storage.local.get([KW_STORAGE_KEY]);
  serviceKeywords = stored[KW_STORAGE_KEY] || [];
  renderKeywordTags();
}

function addKeyword(value) {
  const kw = value.trim().toLowerCase();
  if (!kw || serviceKeywords.includes(kw)) return;
  serviceKeywords.push(kw);
  renderKeywordTags();
  saveKeywords();
}

function removeKeyword(index) {
  serviceKeywords.splice(index, 1);
  renderKeywordTags();
  saveKeywords();
}

function checkAndAutoTriggerEmployee(result) {
  if (!serviceKeywords.length || !result?.services?.length) return;
  const services = result.services.map(s => s.toLowerCase());
  const matched = serviceKeywords.find(kw =>
    services.some(svc => svc.includes(kw))
  );
  if (!matched) return;

  const statusEl = document.getElementById("kwStatus");
  statusEl.className = "kw-status kw-status--triggered";
  statusEl.textContent = `Matched "${matched}" \u2014 running employee analysis\u2026`;

  setTimeout(() => {
    if (latestResult?.url) {
      analyzeEmployeeDetailsForUrl(latestResult.url).catch(err => {
        setStatus(err.message || "Auto employee analysis failed.", true);
      });
    }
  }, 800);
}

// ── Render result ────────────────────────────────────────────

function renderResult(result) {
  latestResult = result;
  if (!result) {
    elements.result.classList.add("hidden");
    elements.emptyState.classList.remove("hidden");
    elements.classificationStrip.classList.add("hidden");
    elements.peopleCount.textContent = "0";
    elements.pageCount.textContent = "0";
    setEmployeeButtonState();
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.result.classList.remove("hidden");
  elements.businessType.textContent = result.businessType || "Unknown";
  const confidence = typeof result.confidence === "number" ? `${Math.round(result.confidence * 100)}%` : "n/a";
  elements.confidence.textContent = `Confidence: ${confidence}`;
  elements.summary.textContent = result.summary || "";
  elements.industry.textContent = result.industry || "";
  elements.peopleCount.textContent = String(normalizePeople(result.people).length);
  elements.pageCount.textContent = String(result.researchedPageCount || 0);
  elements.websiteSignals.textContent = result.websiteSignals || "";
  fillList(elements.services, result.services);
  renderPeople(elements.people, result.people);
  if (elements.peopleGrid) {
    const people = normalizePeople(result.people);
    if (people.length) {
      elements.peopleGridPanel.classList.remove("hidden");
      renderPeopleGrid(elements.peopleGrid, result.people);
    } else {
      elements.peopleGridPanel.classList.add("hidden");
    }
  }
  elements.teamSummary.textContent = result.teamSummary || "Run Analyze Employee Details to load team information.";
  fillList(elements.evidence, result.evidence);
  elements.raw.textContent = JSON.stringify(result, null, 2);
  updateDomainBadge(result.url);
  elements.recentSiteNote.textContent = `Latest site analyzed: ${result.url}`;

  elements.csBusinessType.textContent = result.businessType || "Unknown";
  elements.csIndustry.textContent = result.industry || "—";
  elements.csServices.replaceChildren();
  const services = result.services && result.services.length ? result.services : [];
  if (services.length) {
    for (const svc of services) {
      const tag = document.createElement("span");
      tag.className = "cs-service-tag";
      tag.textContent = svc;
      elements.csServices.appendChild(tag);
    }
  } else {
    elements.csServices.textContent = "—";
  }
  if (typeof result.confidence === "number") {
    elements.csConfidence.textContent = `${Math.round(result.confidence * 100)}% confidence`;
    elements.csConfidenceWrap.classList.remove("hidden");
  } else {
    elements.csConfidenceWrap.classList.add("hidden");
  }
  elements.classificationStrip.classList.remove("hidden");

  setEmployeeButtonState();
  if (result && !result.employeeAnalysisComplete) {
    checkAndAutoTriggerEmployee(result);
  }
}

async function loadState() {
  renderResult(null);
  setProgress(0);
  setEmployeeButtonState();
}

async function exportCsv() {
  if (!latestResult) {
    setStatus("No analysis available to export.", true);
    return;
  }
  const header = ["analyzedAt", "title", "url", "businessType", "industry", "confidence", "services", "people", "teamSummary", "summary", "evidence", "websiteSignals"].join(",");
  const lines = [header, buildCsvRow(latestResult)];
  downloadFile("business-type-history.csv", `${lines.join("\n")}\n`, "text/csv;charset=utf-8");
  setStatus("CSV exported.");
}

async function copyJson() {
  if (!latestResult) {
    setStatus("No result available yet.", true);
    return;
  }
  await navigator.clipboard.writeText(JSON.stringify(latestResult, null, 2));
  setStatus("JSON copied.");
}

function extractPageData() {
  const TEAM_SECTION_PATTERN = /(team|staff|people|person|member|leadership|leader|management|executive|director|founder|advisor|board|employee|bio|profile|our[-\s]?team|our[-\s]?people|meet[-\s]?the[-\s]?team|directory|roster|agent|broker|consultant|attorney|lawyer|doctor|physician|therapist|counselor|coach|trainer)/i;
  const ROLE_PATTERN = /(founder|co-founder|ceo|cto|cfo|coo|cmo|chief|president|vice president|vp\b|director|manager|lead|head|principal|partner|consultant|engineer|designer|advisor|chair|staff|operations|marketing|sales|specialist|officer|associate|analyst|coordinator|executive|secretary|treasurer|broker|agent|attorney|lawyer|doctor|physician|therapist|counselor|coach|trainer|dentist|surgeon|professor|teacher|practitioner)/i;

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function textValue(node) {
    return cleanText(node?.textContent || "");
  }

  function attrValue(node, attr) {
    return cleanText(node?.getAttribute?.(attr) || "");
  }

  function collectVisibleText(limit = 7000) {
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const chunks = [];
    let total = 0;
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue?.replace(/\s+/g, " ").trim();
      if (!value) continue;
      const parent = walker.currentNode.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
      chunks.push(value);
      total += value.length + 1;
      if (total > limit) break;
    }
    return chunks.join(" ");
  }

  function collectMetadata() {
    const meta = {};
    for (const element of document.querySelectorAll("meta[name], meta[property]")) {
      const key = element.getAttribute("name") || element.getAttribute("property");
      const value = element.getAttribute("content");
      if (key && value) meta[key] = value;
    }
    return meta;
  }

  function walkJson(value, visitor) {
    if (!value || typeof value !== "object") return;
    visitor(value);
    if (Array.isArray(value)) {
      for (const item of value) walkJson(item, visitor);
      return;
    }
    for (const nested of Object.values(value)) walkJson(nested, visitor);
  }

  function normalizeLinkedinUrl(value) {
    const values = Array.isArray(value) ? value : [value];
    const match = values.map((item) => cleanText(item)).find((item) => /linkedin\.com/i.test(item));
    return match || "";
  }

  function normalizeEmail(value) {
    const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : "";
  }

  function normalizePhone(value) {
    const text = cleanText(value);
    const digits = text.replace(/[^\d+]/g, "");
    return digits.length >= 7 ? text : "";
  }

  function sanitizePersonName(name) {
    return cleanText(name)
      .replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, "")
      .replace(/\s+(mba|phd|md|dds|jd|esq)\.?$/i, "");
  }

  function isLikelyPersonName(name) {
    const cleaned = sanitizePersonName(name);
    if (!cleaned || cleaned.length < 4 || cleaned.length > 80) return false;
    const words = cleaned.split(/\s+/);
    if (words.length < 2) return false;
    if (words.length > 5) return false;
    if (!words.every((word) => /^[A-Z][A-Za-z'.-]*$/.test(word) || /^[A-Z]{2,}$/.test(word))) return false;
    const uiPhrases = /^(contact|home|about|services|our|the|get|learn|read|view|see|click|sign|log|call|email|send|submit|next|back|more|buy|sell|rent|find|search|menu|close|open|toggle|follow|share|book|request|download|upload|register|login|join|apply|explore|discover|navigate|skip|go to|back to|return|continue|cancel|confirm|yes|no|ok|done|save|edit|delete|add|remove|new|all|other|team|staff|people|company|office|phone|fax|address|website|social|media|news|blog|events|gallery|portfolio|careers|faqs?|privacy|terms|copyright|sitemap|policy)/i;
    if (uiPhrases.test(cleaned)) return false;
    if (/[0-9@#$%^&*()_+=\[\]{};:"<>?\/|]/.test(cleaned)) return false;
    return true;
  }

  function mergePeople(people) {
    const merged = new Map();
    for (const person of people) {
      const name = sanitizePersonName(person?.name || "");
      if (!name) continue;
      if (!isLikelyPersonName(name)) continue;
      const key = name.toLowerCase();
      const current = merged.get(key) || { name, title: "", email: "", phone: "", linkedinUrl: "" };
      current.title = current.title || String(person.title || "").trim();
      current.email = current.email || normalizeEmail(person.email);
      current.phone = current.phone || normalizePhone(person.phone);
      current.linkedinUrl = current.linkedinUrl || normalizeLinkedinUrl(person.linkedinUrl);
      merged.set(key, current);
    }
    return [...merged.values()].slice(0, 120);
  }

  function toPersonRecord(candidate) {
    if (!candidate || typeof candidate !== "object") return null;
    const name = sanitizePersonName(candidate.name || "");
    if (!isLikelyPersonName(name)) return null;
    const title = cleanText(candidate.title || candidate.jobTitle || candidate.roleName || candidate.description || "");
    return {
      name,
      title: ROLE_PATTERN.test(title) ? title.slice(0, 160) : "",
      email: normalizeEmail(candidate.email || ""),
      phone: normalizePhone(candidate.phone || candidate.telephone || ""),
      linkedinUrl: normalizeLinkedinUrl(candidate.linkedinUrl || candidate.sameAs || candidate.url || "")
    };
  }

  function collectPeopleFromJsonLd() {
    const people = [];
    const pushCandidate = (candidate) => {
      const normalized = toPersonRecord(candidate);
      if (normalized) people.push(normalized);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const payload = JSON.parse(script.textContent || "null");
        walkJson(payload, (node) => {
          const typeValue = node["@type"];
          const types = Array.isArray(typeValue) ? typeValue : [typeValue];
          const typedAsPerson = types.includes("Person");
          const looksLikePerson = !!(node.name && (node.jobTitle || node.roleName || node.email || node.telephone || normalizeLinkedinUrl(node.sameAs || node.url)));
          if (typedAsPerson || looksLikePerson) pushCandidate(node);
          for (const key of ["employee", "employees", "member", "members", "founder", "founders", "advisor", "advisors", "staff"]) {
            const value = node[key];
            if (Array.isArray(value)) value.forEach(pushCandidate);
            else if (value && typeof value === "object") pushCandidate(value);
          }
        });
      } catch {}
    }
    return mergePeople(people);
  }

  function getNodeHint(node) {
    if (!node) return "";
    return cleanText([
      attrValue(node, "aria-label"),
      attrValue(node, "title"),
      attrValue(node, "id"),
      attrValue(node, "class")
    ].join(" "));
  }

  function getCardRole(card, name) {
    const selectors = [
      "[itemprop='jobTitle']",
      "[class*='title']",
      "[class*='role']",
      "[class*='position']",
      "[class*='designation']",
      "[class*='job']",
      "[class*='profession']",
      "[class*='specialty']",
      "[class*='subtitle']",
      "[class*='department']",
      "figcaption",
      "p",
      "span",
      "small",
      "em"
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of card.querySelectorAll(selector)) {
        const value = textValue(node);
        if (!value || value === name || value.length > 160) continue;
        candidates.push(value);
      }
    }
    const matched = candidates.find((value) => ROLE_PATTERN.test(value));
    return matched || "";
  }

  function extractPersonFromCard(card) {
    const cardText = cleanText(card.innerText || card.textContent || "");
    if (!cardText || cardText.length < 10 || cardText.length > 1800) return null;

    const nameCandidates = [];
    const nameSelectors = [
      "[itemprop='name']",
      "[class*='name']",
      "[data-name]",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "figcaption",
      "a"
    ];

    for (const selector of nameSelectors) {
      for (const node of card.querySelectorAll(selector)) {
        const value = textValue(node);
        if (value) nameCandidates.push(value);
      }
    }

    for (const img of card.querySelectorAll("img[alt]")) {
      const alt = attrValue(img, "alt");
      if (alt) nameCandidates.push(alt);
    }

    const name = nameCandidates.map(sanitizePersonName).find(isLikelyPersonName);
    if (!name) return null;

    const role = getCardRole(card, name);
    const hasContext = ROLE_PATTERN.test(role) || !!card.querySelector("a[href^='mailto:'], a[href^='tel:'], a[href*='linkedin.com']");
    if (!hasContext && !TEAM_SECTION_PATTERN.test(`${cardText} ${getNodeHint(card)}`)) return null;

    const emailLink = card.querySelector("a[href^='mailto:']");
    const phoneLink = card.querySelector("a[href^='tel:']");
    const linkedinLink = Array.from(card.querySelectorAll("a[href]")).find((link) => /linkedin\.com/i.test(link.href));
    return {
      name,
      title: role ? role.slice(0, 160) : "",
      email: emailLink?.href?.replace(/^mailto:/i, "") || normalizeEmail(cardText),
      phone: phoneLink?.href?.replace(/^tel:/i, "") || normalizePhone(cardText),
      linkedinUrl: linkedinLink?.href || ""
    };
  }

  function collectPeopleFromDom() {
    const people = [];
    const containerSelectors = [
      "[class*='team']","[id*='team']","[class*='staff']","[id*='staff']",
      "[class*='people']","[id*='people']","[class*='person']","[id*='person']",
      "[class*='member']","[id*='member']","[class*='leader']","[id*='leader']",
      "[class*='leadership']","[id*='leadership']","[class*='executive']","[id*='executive']",
      "[class*='director']","[id*='director']","[class*='founder']","[id*='founder']",
      "[class*='management']","[id*='management']","[class*='advisor']","[id*='advisor']",
      "[class*='board']","[id*='board']","[class*='profile']","[id*='profile']",
      "[class*='bio']","[id*='bio']","[class*='employee']","[id*='employee']",
      "[class*='directory']","[id*='directory']","[class*='roster']","[id*='roster']",
      "[class*='agent']","[id*='agent']","[class*='broker']","[id*='broker']",
      "[class*='consultant']","[id*='consultant']","[class*='attorney']","[id*='attorney']",
      "[class*='lawyer']","[id*='lawyer']","[class*='doctor']","[id*='doctor']",
      "[class*='physician']","[id*='physician']","[class*='therap']","[id*='therap']"
    ];
    const seen = new Set();
    const teamContainers = new Set(Array.from(document.querySelectorAll(containerSelectors.join(","))).slice(0, 80));
    for (const node of document.querySelectorAll("section, article, main, div")) {
      const hint = `${getNodeHint(node)} ${textValue(node.querySelector("h1, h2, h3, h4"))}`;
      if (TEAM_SECTION_PATTERN.test(hint)) teamContainers.add(node);
    }

    for (const container of teamContainers) {
      const cards = [];
      if (container.matches?.("article, li, [itemtype*='Person'], [class*='card'], [class*='item'], [class*='entry'], [class*='profile'], [class*='member'], [class*='person'], div, section")) {
        cards.push(container);
      }
      cards.push(...Array.from(container.querySelectorAll("article, li, [itemtype*='Person'], [class*='card'], [class*='item'], [class*='entry'], [class*='profile'], [class*='member'], [class*='person'], div, section")).slice(0, 120));

      for (const card of cards) {
        const person = extractPersonFromCard(card);
        if (!person) continue;
        if (seen.has(person.name.toLowerCase())) continue;
        seen.add(person.name.toLowerCase());
        people.push(person);
        if (people.length >= 120) return mergePeople(people);
      }
    }
    return mergePeople(people);
  }

  function collectPeopleFromText() {
    const text = collectVisibleText(15000);
    const matches = [];
    const dashPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'\-]+){1,3})\s*[-–—|]\s*([A-Z][A-Za-z/&(),'\-.\s]{2,80})/g;
    const commaPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'\-]+){1,3}),\s*([A-Z][A-Za-z/&(),'\-.\s]{4,80})/g;
    const roleKeywords = /(founder|co-founder|ceo|cto|cfo|coo|cmo|director|manager|lead|head|principal|partner|consultant|engineer|designer|advisor|president|chair|vp |vice president|staff|operations|marketing|sales|specialist|officer|associate|analyst|coordinator|executive|secretary|treasurer)/i;
    for (const pat of [dashPattern, commaPattern]) {
      let match;
      while ((match = pat.exec(text)) !== null) {
        const name = match[1].trim();
        const role = match[2].trim();
        if (!roleKeywords.test(role)) continue;
        if (!isLikelyPersonName(name)) continue;
        matches.push({ name, title: role, email: "", phone: "", linkedinUrl: "" });
        if (matches.length >= 30) break;
      }
    }
    return mergePeople(matches);
  }

  function collectTeamSnippets() {
    const snippets = [];
    const keywordPattern = /(team|staff|leadership|founder|about us|about|management|employee|our people|who we are|directory|roster|advisor|board|agent|broker|attorney|doctor|therapist)/i;
    for (const node of document.querySelectorAll("section, article, div")) {
      const idClass = `${node.id || ""} ${node.className || ""}`;
      const heading = textValue(node.querySelector("h1, h2, h3, h4"));
      if (!keywordPattern.test(`${idClass} ${heading}`)) continue;
      const text = textValue(node).slice(0, 240);
      if (text) snippets.push(text);
      if (snippets.length >= 6) break;
    }
    return snippets;
  }

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((node) => textValue(node))
    .filter(Boolean)
    .slice(0, 20);

  function collectLinks() {
    const seen = new Set();
    const results = [];
    function getLinkText(node) {
      return cleanText(textValue(node) || attrValue(node, "aria-label") || attrValue(node, "title") || attrValue(node.querySelector("img"), "alt"));
    }
    function getContext(node) {
      const container = node.closest("article, section, li, div, nav, footer, header");
      if (!container) return "";
      const heading = textValue(container.querySelector("h1, h2, h3, h4"));
      return cleanText(`${heading} ${getNodeHint(container)}`).slice(0, 160);
    }
    function classifySource(node, href) {
      if (node.closest("nav, header nav, [role='navigation'], [class*='navigation'], [class*='menu'], [id*='nav']")) return "nav";
      if (node.closest("footer, [role='contentinfo'], [class*='footer'], [id*='footer']")) return "footer";
      if (node.closest("[class*='sitemap'], [id*='sitemap'], [class*='site-map'], [id*='site-map']")) return "sitemap";
      if (node.closest(containerSelectors.join(","))) return "team";
      if (TEAM_SECTION_PATTERN.test(`${getContext(node)} ${href}`)) return "profile";
      return "body";
    }
    function addLinks(nodes, source) {
      for (const node of nodes) {
        const href = node.href;
        const text = getLinkText(node);
        if (!href || !text || seen.has(href)) continue;
        seen.add(href);
        results.push({ text, href, source: source || classifySource(node, href), context: getContext(node) });
      }
    }
    const navSelectors = ["nav","header nav","[role='navigation']","[class*='navbar']","[class*='nav-bar']","[class*='navigation']","[class*='menu']","[id*='menu']","[id*='nav']","header","[class*='header']"];
    for (const sel of navSelectors) addLinks(document.querySelectorAll(`${sel} a[href]`), "nav");
    const footerSelectors = ["footer","[role='contentinfo']","[class*='footer']","[id*='footer']"];
    for (const sel of footerSelectors) addLinks(document.querySelectorAll(`${sel} a[href]`), "footer");
    const sitemapSelectors = ["[class*='sitemap']","[id*='sitemap']","[class*='site-map']","[id*='site-map']"];
    for (const sel of sitemapSelectors) addLinks(document.querySelectorAll(`${sel} a[href]`), "sitemap");
    const profileSelectors = ["[class*='agent'] a","[class*='staff'] a","[class*='team'] a","[class*='member'] a","[class*='profile'] a","[class*='people'] a","[class*='person'] a","[class*='consultant'] a","[class*='advisor'] a"];
    for (const sel of profileSelectors) addLinks(document.querySelectorAll(sel), "profile");
    addLinks(document.querySelectorAll("a[href]"), "");
    return results.slice(0, 400);
  }

  const links = collectLinks();
  const schemaPeople = collectPeopleFromJsonLd();
  const domPeople = collectPeopleFromDom();
  const textPeople = collectPeopleFromText();
  const people = mergePeople([...schemaPeople, ...domPeople, ...textPeople]);

  return {
    title: document.title,
    url: location.href,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
    headings,
    links,
    metadata: collectMetadata(),
    bodyText: collectVisibleText(),
    people,
    teamSnippets: collectTeamSnippets()
  };
}

function getSiteRoot(url) {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/`;
}

const BUSINESS_LINK_PATTERN = /(services?|solutions?|what[-\s]?we[-\s]?do|capabilities|offerings|products?|platform|software|pricing|plans|industr(?:y|ies)|clients?|customers?|portfolio|case[-\s]?studies|projects?|work|results|about|company|overview|who[-\s]?we[-\s]?are|our[-\s]?story|practice[-\s]?areas|specialt(?:y|ies)|markets?|sectors?|use[-\s]?cases?|features?|benefits?)/i;
const BUSINESS_HIGH_VALUE_PATTERN = /(services?|solutions?|products?|platform|software|pricing|industr(?:y|ies)|portfolio|case[-\s]?studies|practice[-\s]?areas|specialt(?:y|ies)|use[-\s]?cases?)/i;
const EMPLOYEE_LINK_PATTERN = /(team|people|staff|crew|leadership|leaders|management|founders?|directors?|executives?|board|advisors?|partners?|employees?|members?|profiles?|bios?|directory|roster|agents?|brokers?|consultants?|practitioners?|specialists?|professionals?|attorneys?|lawyers?|doctors?|physicians?|surgeons?|dentists?|therapists?|counselors?|coaches?|trainers?)/i;
const EMPLOYEE_PROFILE_PATH_PATTERN = /\/(team|people|staff|members?|leadership|management|agents?|brokers?|consultants?|attorneys?|lawyers?|doctors?|physicians?|therapists?|profiles?|bios?)\/[^/?#]+/i;
const LIKELY_PERSON_SLUG_PATTERN = /\/[a-z0-9]+(?:-[a-z0-9]+){1,4}\/?$/i;
const NEGATIVE_LINK_PATTERN = /\/(blog|news|press|jobs|careers|products|services|pricing|faq|support|help|resources|events|privacy|terms)(\/|$)/i;

function normalizeCandidateUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeScoredLink(link) {
  return {
    ...link,
    href: link?.href || link?.url || "",
    text: String(link?.text || "").trim(),
    source: String(link?.source || "body").trim(),
    context: String(link?.context || "").trim()
  };
}

function scoreLink(link, origin, focus = "business") {
  try {
    const normalized = normalizeScoredLink(link);
    const parsed = new URL(normalized.href);
    if (parsed.origin !== origin) return -1;
    if (/^(mailto:|tel:|javascript:)/i.test(normalized.href)) return -1;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|docx?|xlsx?|pptx?)$/i.test(parsed.pathname)) return -1;
    let score = 0;
    const haystack = `${normalized.text} ${normalized.context} ${parsed.pathname}`.toLowerCase();
    if (normalized.source === "nav") score += 6;
    if (normalized.source === "footer") score += 4;
    if (normalized.source === "sitemap") score += 5;
    if (normalized.source === "team") score += 16;
    if (normalized.source === "profile") score += 18;
    if (focus === "employee") {
      if (EMPLOYEE_LINK_PATTERN.test(parsed.pathname)) score += 20;
      if (/(\/about\/(our-team|team|staff|people|us|leadership|management|founders|board|advisors|directory|roster))/.test(parsed.pathname)) score += 22;
      if (EMPLOYEE_PROFILE_PATH_PATTERN.test(parsed.pathname)) score += 20;
      if (LIKELY_PERSON_SLUG_PATTERN.test(parsed.pathname) && EMPLOYEE_LINK_PATTERN.test(parsed.pathname)) score += 16;
      if (EMPLOYEE_LINK_PATTERN.test(haystack)) score += 14;
      if (/(directory|roster|our experts|meet our team|team members|leadership team|attorneys|physicians|our people)/.test(haystack)) score += 12;
      if (/(\/about|\/company|\/overview|\/us|\/our-story|\/our-company)/.test(parsed.pathname)) score += 8;
      if (/(about us|about|company|our story)/.test(haystack)) score += 5;
      if (/(contact|locations|office)/.test(haystack)) score += 3;
      if (NEGATIVE_LINK_PATTERN.test(parsed.pathname)) score -= 8;
    } else {
      if (BUSINESS_LINK_PATTERN.test(parsed.pathname)) score += 18;
      if (BUSINESS_HIGH_VALUE_PATTERN.test(parsed.pathname)) score += 8;
      if (BUSINESS_LINK_PATTERN.test(haystack)) score += 12;
      if (BUSINESS_HIGH_VALUE_PATTERN.test(haystack)) score += 8;
      if (/(\/about|\/company|\/about-us|\/our-story|\/who-we-are|\/overview|\/our-company)/.test(parsed.pathname)) score += 12;
      if (/(about|company|overview|our story|who we are)/.test(haystack)) score += 8;
      if (/(\/industries|\/clients|\/portfolio|\/case-studies|\/projects|\/work|\/results|\/pricing|\/plans|\/features|\/faq|\/markets|\/sectors|\/use-cases)/.test(parsed.pathname)) score += 10;
      if (/(industries|clients|portfolio|case studies|projects|results|pricing|plans|features|faq|markets|sectors|use cases)/.test(haystack)) score += 6;
      if (/(contact|locations|office)/.test(haystack)) score += 2;
      if (/(\/team|\/people|\/staff|\/leadership|\/founders|\/about-us|\/our-team|\/who-we-are|\/our-people|\/management)/.test(parsed.pathname)) score += 8;
      if (/(team|our team|meet the team|leadership|founders|who we are|our people)/.test(haystack)) score += 5;
      if (/(\/blog|\/news|\/press|\/jobs|\/careers|\/faq|\/support|\/help)/.test(parsed.pathname)) score -= 4;
    }
    if (focus === "employee" && (parsed.pathname === "/" || parsed.pathname === "")) score += 1;
    else if (parsed.pathname === "/" || parsed.pathname === "") score += 6;
    if (parsed.hash) score -= 3;
    return score;
  } catch {
    return -1;
  }
}

function buildCandidateUrls(pageData, maxPages = MAX_RESEARCH_PAGES, focus = "business") {
  const origin = new URL(pageData.url).origin;
  const rankedLinks = (pageData.links || [])
    .map((link) => {
      const normalized = normalizeScoredLink(link);
      return { ...normalized, score: scoreLink(normalized, origin, focus) };
    })
    .filter((link) => link.score > 0)
    .sort((a, b) => b.score - a.score);
  const seedUrls = focus === "employee" ? [pageData.url] : [pageData.url, getSiteRoot(pageData.url)];
  const urls = [];
  const seen = new Set();
  for (const url of seedUrls) {
    const normalized = normalizeCandidateUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  for (const link of rankedLinks) {
    const normalized = normalizeCandidateUrl(link.href);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= maxPages) break;
  }
  return urls.slice(0, maxPages);
}

function collectEmployeeExpansionUrls(pages, rootUrl, existingUrls = [], limit = 8) {
  const origin = new URL(rootUrl).origin;
  const seen = new Set(existingUrls.map(normalizeCandidateUrl).filter(Boolean));
  seen.add(normalizeCandidateUrl(rootUrl));

  const ranked = [];
  for (const page of pages || []) {
    for (const rawLink of page.links || []) {
      const link = normalizeScoredLink(rawLink);
      const normalized = normalizeCandidateUrl(link.href);
      if (!normalized || seen.has(normalized)) continue;
      const score = scoreLink(link, origin, "employee");
      if (score < 18) continue;
      ranked.push({ href: normalized, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const urls = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    urls.push(candidate.href);
    if (urls.length >= limit) break;
  }
  return urls;
}

function collectBusinessExpansionUrls(pages, rootUrl, existingUrls = [], limit = 8) {
  const origin = new URL(rootUrl).origin;
  const seen = new Set(existingUrls.map(normalizeCandidateUrl).filter(Boolean));
  seen.add(normalizeCandidateUrl(rootUrl));

  const ranked = [];
  for (const page of pages || []) {
    for (const rawLink of page.links || []) {
      const link = normalizeScoredLink(rawLink);
      const normalized = normalizeCandidateUrl(link.href);
      if (!normalized || seen.has(normalized)) continue;
      const score = scoreLink(link, origin, "business");
      if (score < 18) continue;
      ranked.push({ href: normalized, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  const urls = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.href)) continue;
    seen.add(candidate.href);
    urls.push(candidate.href);
    if (urls.length >= limit) break;
  }
  return urls;
}

async function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    let loadingFallbackId = null;
    const timeoutId = setTimeout(() => {
      clearTimeout(loadingFallbackId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.get(tabId).then(resolve).catch(() => {
        reject(new Error("The website took too long to load."));
      });
    }, 30000);

    function cleanup() {
      clearTimeout(timeoutId);
      clearTimeout(loadingFallbackId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    }

    function handleUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        cleanup();
        resolve(tab);
      } else if (changeInfo.status === "loading" && tab.url && tab.url !== "about:blank") {
        clearTimeout(loadingFallbackId);
        loadingFallbackId = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(handleUpdated);
          clearTimeout(timeoutId);
          chrome.tabs.get(tabId).then(resolve).catch(reject);
        }, 8000);
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        cleanup();
        resolve(tab);
      }
    }).catch((error) => {
      cleanup();
      reject(error);
    });
  });
}

async function extractPageDataFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedUrl(tab.url)) {
    throw new Error("This page cannot be analyzed. Use a regular website URL.");
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageData
  });
  const pageData = results?.[0]?.result;
  if (!pageData) {
    throw new Error("Unable to read that page.");
  }
  return pageData;
}

async function extractHomepageData(tabId) {
  return await extractPageDataFromTab(tabId);
}

async function fetchPageInBackground(url) {
  let tempTab = null;
  try {
    tempTab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tempTab.id);
    return await extractPageDataFromTab(tempTab.id);
  } catch {
    return null;
  } finally {
    if (tempTab?.id) await chrome.tabs.remove(tempTab.id).catch(() => {});
  }
}

async function analyzeTab(tabId) {
  setStatus("Reading homepage links...");
  setProgress(20);
  const homepage = await extractHomepageData(tabId);

  const origin = new URL(homepage.url).origin;
  const linkList = (homepage.links || [])
    .filter(l => {
      try { return new URL(l.href).origin === origin; } catch { return false; }
    })
    .slice(0, 300)
    .map((l) => ({
      text: l.text?.slice(0, 60),
      url: l.href,
      source: l.source || "body",
      context: String(l.context || "").slice(0, 160)
    }));

  setStatus("AI is selecting the best pages to analyze...");
  setProgress(40);
  const pickResponse = await chrome.runtime.sendMessage({
    type: "pick-pages",
    homepage: {
      url: homepage.url,
      title: homepage.title,
      description: homepage.description,
      headings: (homepage.headings || []).slice(0, 10),
      bodyText: (homepage.bodyText || "").slice(0, 800),
      links: linkList
    }
  });

  if (!pickResponse?.ok) {
    throw new Error(pickResponse?.error || "Failed to select pages.");
  }

  const aiPickedUrls = (pickResponse.urls || [])
    .filter(u => isSupportedUrl(u) && u !== homepage.url)
    .slice(0, 8);
  const fallbackUrls = buildCandidateUrls(homepage, 8, "business").filter((candidate) => candidate !== normalizeCandidateUrl(homepage.url));
  const pickedUrls = [...new Set([...aiPickedUrls, ...fallbackUrls])].slice(0, 8);

  setStatus(`Fetching ${pickedUrls.length} selected page(s)...`);
  setProgress(60);

  const extraPages = await Promise.all(pickedUrls.map(fetchPageInBackground));
  const initialPages = [homepage, ...extraPages.filter(Boolean)];
  const expansionUrls = collectBusinessExpansionUrls(initialPages, homepage.url, [homepage.url, ...pickedUrls], 6);
  let expansionPages = [];
  if (expansionUrls.length) {
    setStatus(`Following ${expansionUrls.length} additional business page(s)...`);
    setProgress(72);
    expansionPages = (await Promise.all(expansionUrls.map(fetchPageInBackground))).filter(Boolean);
  }

  const allPages = [...initialPages, ...expansionPages];
  const allPeople = dedupePeople(allPages.flatMap(p => p.people || [])).slice(0, 40);
  const allTeamSnippets = [...new Set(allPages.flatMap(p => p.teamSnippets || []))].slice(0, 12);
  const linkHints = [...new Set(allPages.flatMap((page) => (page.links || []).slice(0, 20).map((link) => {
    const normalized = normalizeScoredLink(link);
    return [normalized.text, normalized.context, normalized.href].filter(Boolean).join(" | ");
  })))].slice(0, 40);

  const researchPayload = {
    title: homepage.title,
    url: homepage.url,
    description: homepage.description,
    headings: (homepage.headings || []).slice(0, 8),
    metadata: Object.fromEntries(Object.entries(homepage.metadata || {}).slice(0, 8)),
    bodyText: (homepage.bodyText || "").slice(0, MAX_SUMMARY_BODY_CHARS),
    people: normalizePeople(allPeople).slice(0, 12),
    teamSnippets: allTeamSnippets.slice(0, 6).map(s => trimText(s, 120)),
    linkHints,
    discoveredPages: allPages.map(p => ({
      title: p.title,
      url: p.url,
      headings: (p.headings || []).slice(0, 6),
      metadata: Object.fromEntries(Object.entries(p.metadata || {}).slice(0, 6)),
      bodyText: trimText(p.bodyText, 1200),
      people: normalizePeople(p.people || []).slice(0, 8),
      linkHints: (p.links || []).slice(0, 10).map((link) => {
        const normalized = normalizeScoredLink(link);
        return [normalized.text, normalized.context, normalized.href].filter(Boolean).join(" | ");
      })
    }))
  };

  setStatus("Classifying business type and services...");
  setProgress(80);

  const response = await chrome.runtime.sendMessage({
    type: "analyze-page",
    pageData: researchPayload
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown analysis error.");
  }

  const result = {
    ...response.result,
    analyzedAt: new Date().toISOString(),
    title: homepage.title,
    url: homepage.url,
    researchedPageCount: allPages.length,
    cachedLinkList: linkList,
    people: latestResult?.url === homepage.url ? latestResult.people || [] : [],
    teamSummary: latestResult?.url === homepage.url ? latestResult.teamSummary || "" : "",
    employeeAnalysisComplete: latestResult?.url === homepage.url ? !!latestResult.employeeAnalysisComplete : false
  };

  renderResult(result);
  await chrome.storage.local.set({ [LATEST_RESULT_KEY]: result });
  setProgress(100);
  setStatus("Analysis complete.");
}

async function analyzeCurrentTab() {
  setBusy(true);
  renderResult(null);
  try {
    await saveSettings();
    setProgress(10);
    setStatus("Finding a website tab...");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const targetTab = tabs.find((tab) => tab.active && isSupportedUrl(tab.url))
      || tabs.find((tab) => isSupportedUrl(tab.url));
    if (!targetTab?.id) {
      throw new Error("No regular website tab found in this window.");
    }
    updateDomainBadge(targetTab.url);
    elements.recentSiteNote.textContent = `Using current tab: ${targetTab.url}`;
    await analyzeTab(targetTab.id);
  } catch (error) {
    setProgress(0);
    setStatus(error.message || "Analysis failed.", true);
  } finally {
    setBusy(false);
  }
}

async function analyzeTargetUrl() {
  setBusy(true);
  renderResult(null);
  let openedTabId = null;
  try {
    await saveSettings();
    const url = normalizeUrl(elements.targetUrl.value);
    updateDomainBadge(url);
    elements.recentSiteNote.textContent = `Root URL selected: ${url}`;
    setProgress(10);
    setStatus("Opening website...");
    const tab = await chrome.tabs.create({ url, active: false });
    openedTabId = tab.id;
    const loadedTab = await waitForTabComplete(tab.id);
    if (!isSupportedUrl(loadedTab.url)) {
      throw new Error("That destination cannot be analyzed. Use a normal website URL.");
    }
    await analyzeTab(tab.id);
    if (openedTabId) {
      await chrome.tabs.remove(openedTabId).catch(() => {});
      openedTabId = null;
    }
  } catch (error) {
    setProgress(0);
    setStatus(error.message || "Analysis failed.", true);
  } finally {
    if (openedTabId) {
      await chrome.tabs.remove(openedTabId).catch(() => {});
    }
    setBusy(false);
  }
}

async function analyzeEmployeeDetailsForUrl(url) {
  setBusy(true);
  try {
    await saveSettings();
    updateDomainBadge(url);

    const linkList = latestResult?.cachedLinkList || [];
    if (!linkList.length) {
      throw new Error("No cached links found. Please run a full site analysis first.");
    }

    setStatus("AI is selecting team/people pages...");
    setProgress(40);

    const pickResponse = await chrome.runtime.sendMessage({
      type: "pick-pages",
      focus: "employee",
      homepage: {
        url,
        title: latestResult?.title || "",
        description: latestResult?.summary || "",
        headings: [],
        bodyText: "",
        links: linkList
      }
    });

    if (!pickResponse?.ok) {
      throw new Error(pickResponse?.error || "Failed to select employee pages.");
    }

    const aiPickedUrls = (pickResponse.urls || [])
      .filter((u) => isSupportedUrl(u))
      .slice(0, 10);
    const fallbackUrls = buildCandidateUrls({
      url,
      links: linkList.map((link) => ({
        href: link.url || link.href,
        text: link.text,
        source: link.source,
        context: link.context
      }))
    }, 12, "employee").filter((candidate) => candidate !== normalizeCandidateUrl(url));
    const pickedUrls = [...new Set([...aiPickedUrls, ...fallbackUrls])].slice(0, 10);

    if (!pickedUrls.length) {
      throw new Error("AI could not identify any team/people pages from the site links.");
    }

    setStatus(`Fetching ${pickedUrls.length} team page(s)...`);
    setProgress(60);

    const pages = await Promise.all(pickedUrls.map(fetchPageInBackground));
    const validPages = pages.filter(Boolean);

    if (!validPages.length) {
      throw new Error("Could not load any of the selected team pages.");
    }

    const profileUrls = collectEmployeeExpansionUrls(validPages, url, pickedUrls, 10);
    let profilePages = [];
    if (profileUrls.length) {
      setStatus(`Following ${profileUrls.length} profile page(s)...`);
      setProgress(72);
      profilePages = (await Promise.all(profileUrls.map(fetchPageInBackground))).filter(Boolean);
    }

    const sourcePages = [...validPages, ...profilePages];
    const allPeople = dedupePeople(sourcePages.flatMap((p) => p.people || [])).slice(0, 160);
    const allTeamSnippets = [...new Set(sourcePages.flatMap((p) => p.teamSnippets || []))].slice(0, 20);

    const researchPayload = {
      title: latestResult?.title || "",
      url,
      description: latestResult?.summary || "",
      headings: [],
      metadata: {},
      bodyText: "",
      people: normalizePeople(allPeople).slice(0, 120),
      teamSnippets: allTeamSnippets.slice(0, 10).map(s => trimText(s, 200)),
      discoveredPages: sourcePages.map(p => ({
        title: p.title,
        url: p.url,
        headings: (p.headings || []).slice(0, 8),
        bodyText: trimText(p.bodyText, 2400),
        people: normalizePeople(p.people || []).slice(0, 40)
      }))
    };

    setStatus("Extracting employee details...");
    setProgress(80);

    const response = await chrome.runtime.sendMessage({
      type: "analyze-employee-details",
      pageData: researchPayload
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unknown employee analysis error.");
    }

    const mergedResult = {
      ...(latestResult || {}),
      people: response.result.people || [],
      teamSummary: response.result.teamSummary || "",
      evidence: [...new Set([...(latestResult?.evidence || []), ...(response.result.evidence || [])])],
      researchedPageCount: (latestResult?.researchedPageCount || 0) + sourcePages.length,
      employeeAnalysisComplete: true
    };

    renderResult(mergedResult);
    await chrome.storage.local.set({ [LATEST_RESULT_KEY]: mergedResult });
    setProgress(100);
    setStatus("Employee analysis complete.");

    // Restore keyword status after employee analysis completes
    renderKeywordTags();
  } catch (error) {
    setProgress(0);
    setStatus(error.message || "Employee analysis failed.", true);
  } finally {
    setBusy(false);
  }
}

// ── Event listeners ──────────────────────────────────────────

elements.saveSettings.addEventListener("click", () => {
  saveSettings().catch((error) => setStatus(error.message || "Save failed.", true));
});
elements.analyzeUrl.addEventListener("click", () => {
  analyzeTargetUrl().catch((error) => setStatus(error.message || "Analysis failed.", true));
});
elements.analyzeCurrent.addEventListener("click", () => {
  analyzeCurrentTab().catch((error) => setStatus(error.message || "Analysis failed.", true));
});
elements.analyzeEmployees.addEventListener("click", () => {
  if (!latestResult?.url) {
    setStatus("Analyze a website first.", true);
    return;
  }
  analyzeEmployeeDetailsForUrl(latestResult.url).catch((error) => {
    setStatus(error.message || "Employee analysis failed.", true);
  });
});
elements.copyJson.addEventListener("click", () => {
  copyJson().catch((error) => setStatus(error.message || "Copy failed.", true));
});
elements.exportCsv.addEventListener("click", () => {
  exportCsv().catch((error) => setStatus(error.message || "Export failed.", true));
});
elements.targetUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    analyzeTargetUrl().catch((error) => setStatus(error.message || "Analysis failed.", true));
  }
});
elements.targetUrl.addEventListener("input", () => {
  updateDomainBadge(elements.targetUrl.value.trim());
});
elements.provider.addEventListener("change", () => {
  updateProviderFields(elements.provider.value);
});

document.getElementById("kwAdd").addEventListener("click", () => {
  const input = document.getElementById("kwInput");
  addKeyword(input.value);
  input.value = "";
});
document.getElementById("kwInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const input = document.getElementById("kwInput");
    addKeyword(input.value);
    input.value = "";
  }
});
document.getElementById("kwTags").addEventListener("click", (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) removeKeyword(+i);
});

Promise.all([loadSettings(), loadState(), loadKeywords()]).catch((error) => {
  setStatus(error.message || "Failed to load dashboard.", true);
});
