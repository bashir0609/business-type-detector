const LATEST_RESULT_KEY = "latestAnalysis";
const MAX_RESEARCH_PAGES = 6;
const MAX_PAGE_BODY_CHARS = 700;
const MAX_SUMMARY_BODY_CHARS = 1000;

let latestResult = null;
const elements = {
  settingsPanel: document.getElementById("settingsPanel"),
  compactBar: document.getElementById("compactBar"),
  reAnalyze: document.getElementById("reAnalyze"),
  toggleSettings: document.getElementById("toggleSettings"),
  provider: document.getElementById("provider"),
  groqFields: document.getElementById("groqFields"),
  openrouterFields: document.getElementById("openrouterFields"),
  ollamaFields: document.getElementById("ollamaFields"),
  groqApiKey: document.getElementById("groqApiKey"),
  openrouterApiKey: document.getElementById("openrouterApiKey"),
  ollamaBaseUrl: document.getElementById("ollamaBaseUrl"),
  analyze: document.getElementById("analyze"),
  analyzeEmployees: document.getElementById("analyzeEmployees"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
  businessType: document.getElementById("businessType"),
  confidence: document.getElementById("confidence"),
  summary: document.getElementById("summary"),
  industry: document.getElementById("industry"),
  websiteSignals: document.getElementById("websiteSignals"),
  services: document.getElementById("services"),
  people: document.getElementById("people"),
  teamSummary: document.getElementById("teamSummary"),
  evidence: document.getElementById("evidence"),
  raw: document.getElementById("raw"),
  copyJson: document.getElementById("copyJson"),
  exportCsv: document.getElementById("exportCsv"),
  openDashboard: document.getElementById("openDashboard")
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#b42318" : "#486581";
}

function showSettings() {
  elements.settingsPanel.classList.remove("hidden");
  elements.compactBar.classList.add("hidden");
}

function showResults() {
  elements.settingsPanel.classList.add("hidden");
  elements.compactBar.classList.remove("hidden");
}

function setBusy(isBusy) {
  elements.analyze.disabled = isBusy;
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
  // API keys go to session only; non-secret prefs sync across devices
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

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
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
    li.textContent = [
      person.name,
      person.title,
      person.email,
      person.phone,
      person.linkedinUrl
    ].filter(Boolean).join(" | ");
    target.appendChild(li);
  }
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

function compactResearchPayload(pageData) {
  const discoveredPages = (pageData.discoveredPages || []).slice(0, MAX_RESEARCH_PAGES).map(compactPageData);
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

async function loadState() {
  setEmployeeButtonState();
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  return tab;
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
      if (!value) {
        continue;
      }
      const parent = walker.currentNode.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
        continue;
      }
      chunks.push(value);
      total += value.length + 1;
      if (total > limit) {
        break;
      }
    }

    return chunks.join(" ");
  }

  function collectMetadata() {
    const meta = {};
    for (const element of document.querySelectorAll("meta[name], meta[property]")) {
      const key = element.getAttribute("name") || element.getAttribute("property");
      const value = element.getAttribute("content");
      if (key && value) {
        meta[key] = value;
      }
    }
    return meta;
  }

  function walkJson(value, visitor) {
    if (!value || typeof value !== "object") {
      return;
    }
    visitor(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        walkJson(item, visitor);
      }
      return;
    }
    for (const nested of Object.values(value)) {
      walkJson(nested, visitor);
    }
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
    if (words.length < 2 || words.length > 5) return false;
    if (!words.every((word) => /^[A-Z][A-Za-z'.-]*$/.test(word) || /^[A-Z]{2,}$/.test(word))) return false;
    if (/[0-9@#$%^&*()_+=\[\]{};:"<>?\/|]/.test(cleaned)) return false;
    if (/^(team|staff|people|contact|about|services|company|office|privacy|terms)$/i.test(cleaned)) return false;
    return true;
  }

  function mergePeople(people) {
    const merged = new Map();
    for (const person of people) {
      const name = sanitizePersonName(person?.name || "");
      if (!name || !isLikelyPersonName(name)) continue;
      const key = name.toLowerCase();
      const current = merged.get(key) || {
        name,
        title: "",
        email: "",
        phone: "",
        linkedinUrl: ""
      };
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
    return candidates.find((value) => ROLE_PATTERN.test(value)) || "";
  }

  function extractPersonFromCard(card) {
    const cardText = cleanText(card.innerText || card.textContent || "");
    if (!cardText || cardText.length < 10 || cardText.length > 1800) return null;
    const nameCandidates = [];
    for (const selector of ["[itemprop='name']", "[class*='name']", "[data-name]", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "figcaption", "a"]) {
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
        if (!person || seen.has(person.name.toLowerCase())) continue;
        seen.add(person.name.toLowerCase());
        people.push(person);
        if (people.length >= 120) return mergePeople(people);
      }
    }

    return mergePeople(people);
  }

  function collectPeopleFromText() {
    const text = collectVisibleText(12000);
    const matches = [];
    const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,3})\s*(?:[-|,]|[–—])\s*([A-Z][A-Za-z/&(),.'\-\s]{2,80})/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      const role = match[2].trim();
      if (!ROLE_PATTERN.test(role)) {
        continue;
      }
      if (!isLikelyPersonName(name)) continue;
      matches.push({
        name: sanitizePersonName(name),
        title: role,
        email: "",
        phone: "",
        linkedinUrl: ""
      });
      if (matches.length >= 60) {
        break;
      }
    }

    return mergePeople(matches);
  }

  function collectTeamSnippets() {
    const snippets = [];
    const selectors = [
      "section",
      "article",
      "div"
    ];
    const keywordPattern = /(team|staff|leadership|founder|about us|about|management|employee|our people|who we are|directory|roster|advisor|board|agent|broker|attorney|doctor|therapist)/i;

    for (const node of document.querySelectorAll(selectors.join(","))) {
      const idClass = `${node.id || ""} ${node.className || ""}`;
      const heading = textValue(node.querySelector("h1, h2, h3, h4"));
      if (!keywordPattern.test(`${idClass} ${heading}`)) {
        continue;
      }
      const text = textValue(node).slice(0, 240);
      if (text) {
        snippets.push(text);
      }
      if (snippets.length >= 6) {
        break;
      }
    }

    return snippets;
  }

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((node) => textValue(node))
    .filter(Boolean)
    .slice(0, 20);

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

  const seenLinks = new Set();
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => ({
      text: getLinkText(node),
      href: node.href,
      source: classifySource(node, node.href),
      context: getContext(node)
    }))
    .filter((link) => {
      if (!link.text || seenLinks.has(link.href)) return false;
      seenLinks.add(link.href);
      return true;
    })
    .slice(0, 300);

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
      if (/(about|company|overview)/.test(haystack)) score += 8;
      if (/(contact|locations|office)/.test(haystack)) score += 3;
      if (NEGATIVE_LINK_PATTERN.test(parsed.pathname)) score -= 8;
    } else {
      if (BUSINESS_LINK_PATTERN.test(parsed.pathname)) score += 18;
      if (BUSINESS_HIGH_VALUE_PATTERN.test(parsed.pathname)) score += 8;
      if (BUSINESS_LINK_PATTERN.test(haystack)) score += 12;
      if (BUSINESS_HIGH_VALUE_PATTERN.test(haystack)) score += 8;
      if (/(about|company|overview)/.test(haystack)) score += 8;
      if (/(industries|clients|portfolio|case-studies|pricing|plans|features|faq|markets|sectors|use cases)/.test(haystack)) score += 6;
      if (/(contact|locations|office)/.test(haystack)) score += 2;
      if (/(team|people|leadership|staff|management|founder|employee|our-team|meet-the-team|executive|board|advisor|who-we-are)/.test(haystack)) score += 1;
    }
    if (parsed.pathname === "/" || parsed.pathname === "") score += 6;
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

  const urls = [];
  const seen = new Set();
  for (const url of [pageData.url, getSiteRoot(pageData.url)]) {
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

async function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error("The website took too long to load."));
    }, 10000);

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    }

    function handleUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === "complete") {
        cleanup();
        resolve(tab);
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
    throw new Error("This page cannot be analyzed. Open a regular website first.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageData
  });

  const pageData = results?.[0]?.result;
  if (!pageData) {
    throw new Error("Unable to read the current page.");
  }

  return pageData;
}

async function gatherSiteResearch(tabId, maxPages = MAX_RESEARCH_PAGES, focus = "business") {
  const primaryPage = await extractPageDataFromTab(tabId);
  const candidateUrls = buildCandidateUrls(primaryPage, maxPages, focus);
  const pages = [primaryPage];

  for (const url of candidateUrls.slice(1)) {
    let tempTab = null;
    try {
      tempTab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(tempTab.id);
      const pageData = await extractPageDataFromTab(tempTab.id);
      pages.push(pageData);
    } catch {
      // Ignore pages that fail to load or script.
    } finally {
      if (tempTab?.id) {
        await chrome.tabs.remove(tempTab.id).catch(() => {});
      }
    }
  }

  const allPeople = dedupePeople(pages.flatMap((page) => page.people || [])).slice(0, 120);
  const allTeamSnippets = [...new Set(pages.flatMap((page) => page.teamSnippets || []))].slice(0, 20);

  return {
    title: primaryPage.title,
    url: primaryPage.url,
    description: primaryPage.description,
    headings: primaryPage.headings,
    metadata: primaryPage.metadata,
    bodyText: primaryPage.bodyText,
    linkHints: [...new Set(pages.flatMap((page) => (page.links || []).slice(0, 15).map((link) => {
      const normalized = normalizeScoredLink(link);
      return [normalized.text, normalized.context, normalized.href].filter(Boolean).join(" | ");
    })))].slice(0, 40),
    discoveredPages: pages.map((page) => ({
      title: page.title,
      url: page.url,
      description: page.description,
      headings: page.headings,
      metadata: page.metadata,
      bodyText: page.bodyText,
      people: page.people,
      teamSnippets: page.teamSnippets,
      linkHints: (page.links || []).slice(0, 10).map((link) => {
        const normalized = normalizeScoredLink(link);
        return [normalized.text, normalized.context, normalized.href].filter(Boolean).join(" | ");
      })
    })),
    people: allPeople,
    teamSnippets: allTeamSnippets
  };
}

function renderResult(result) {
  latestResult = result;
  elements.result.classList.remove("hidden");
  elements.businessType.textContent = result.businessType || "Unknown";
  const confidence = typeof result.confidence === "number" ? `${Math.round(result.confidence * 100)}%` : "n/a";
  elements.confidence.textContent = `Confidence: ${confidence}`;
  elements.summary.textContent = result.summary || "";
  elements.industry.textContent = result.industry || "";
  elements.websiteSignals.textContent = result.websiteSignals || "";
  fillList(elements.services, result.services);
  renderPeople(elements.people, result.people);
  elements.teamSummary.textContent = result.teamSummary || "Run Analyze Employee Details to load team information.";
  fillList(elements.evidence, result.evidence);
  elements.raw.textContent = JSON.stringify(result, null, 2);
  setEmployeeButtonState();
  elements.result.scrollIntoView({ behavior: "smooth", block: "start" });
  showResults();
}

async function copyJson() {
  if (!latestResult) {
    setStatus("Run an analysis first.", true);
    return;
  }

  await navigator.clipboard.writeText(JSON.stringify(latestResult, null, 2));
  setStatus("JSON copied.");
}

async function exportCsv() {
  if (!latestResult) {
    setStatus("No analysis available to export.", true);
    return;
  }

  const header = [
    "analyzedAt",
    "title",
    "url",
    "businessType",
    "industry",
    "confidence",
    "services",
    "people",
    "teamSummary",
    "summary",
    "evidence",
    "websiteSignals"
  ].join(",");

  const lines = [header, buildCsvRow(latestResult)];
  downloadFile("business-type-history.csv", `${lines.join("\n")}\n`, "text/csv;charset=utf-8");
  setStatus("CSV exported.");
}

async function runAnalysisForTab(tabId) {
  setStatus("Reading current page...");
  const pageData = compactResearchPayload(await gatherSiteResearch(tabId, MAX_RESEARCH_PAGES, "business"));

  setStatus("Classifying business type, services, and team details...");
  const response = await chrome.runtime.sendMessage({
    type: "analyze-page",
    pageData
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown analysis error.");
  }

  const result = {
    ...response.result,
    analyzedAt: new Date().toISOString(),
    title: pageData.title,
    url: pageData.url,
    people: latestResult?.url === pageData.url ? latestResult.people || [] : [],
    teamSummary: latestResult?.url === pageData.url ? latestResult.teamSummary || "" : "",
    employeeAnalysisComplete: latestResult?.url === pageData.url ? !!latestResult.employeeAnalysisComplete : false
  };

  renderResult(result);
  await chrome.storage.local.set({ [LATEST_RESULT_KEY]: result });
  setStatus("Analysis complete.");
}

async function openSidePanel(windowId) {
  const response = await chrome.runtime.sendMessage({
    type: "open-side-panel",
    windowId
  });

  if (!response?.ok) {
    return {
      ok: false,
      error: response?.error || "Unable to open side panel."
    };
  }
  return response;
}

async function analyzeUrl(url) {
  setBusy(true);
  elements.result.classList.add("hidden");

  try {
    await saveSettings();
    const tab = await getCurrentTab();
    if (!isSupportedUrl(tab.url) && !url) {
      throw new Error("No valid URL to analyze. Enter a URL or open a website first.");
    }
    const targetUrl = url || tab.url;
    setStatus("Navigating to site...");
    await chrome.tabs.update(tab.id, { url: targetUrl });
    await waitForTabComplete(tab.id);
    const panelResult = await openSidePanel(tab.windowId);
    if (!panelResult?.ok) {
      setStatus(`${panelResult.error} Showing results here instead.`);
    }
    await runAnalysisForTab(tab.id);
  } finally {
    setBusy(false);
  }
}

async function analyzeCurrentTab() {
  showSettings();
  setBusy(true);
  setStatus("Opening side panel...");
  elements.result.classList.add("hidden");

  try {
    await saveSettings();
    const panelResult = await openSidePanel();
    if (!panelResult?.ok) {
      setStatus(`${panelResult.error} Showing results here instead.`);
    }
    setStatus("Preparing site research...");
    const tab = await getCurrentTab();
    if (!isSupportedUrl(tab.url)) {
      throw new Error("This page cannot be analyzed. Open a regular website first.");
    }
    await runAnalysisForTab(tab.id);
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  } finally {
    setBusy(false);
  }
}

async function analyzeEmployeeDetailsForUrl(url) {
  setBusy(true);

  try {
    await saveSettings();
    setStatus("Researching team and employee details...");
    // Reuse the current tab — no new tab opened from popup
    const tab = await getCurrentTab();
    try {
      const pageData = compactResearchPayload(await gatherSiteResearch(tab.id, 10, "employee"), 12);
      const response = await chrome.runtime.sendMessage({
        type: "analyze-employee-details",
        pageData
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Unknown employee analysis error.");
      }

      const mergedResult = {
        ...(latestResult || {}),
        people: response.result.people || [],
        teamSummary: response.result.teamSummary || "",
        evidence: [...new Set([...(latestResult?.evidence || []), ...(response.result.evidence || [])])],
        employeeAnalysisComplete: true
      };

      renderResult(mergedResult);
      await chrome.storage.local.set({ [LATEST_RESULT_KEY]: mergedResult });
      setStatus("Employee analysis complete.");
    } catch (innerError) {
      throw innerError;
    }
  } catch (error) {
    setStatus(error.message || "Employee analysis failed.", true);
  } finally {
    setBusy(false);
  }
}

elements.analyze.addEventListener("click", analyzeCurrentTab);
elements.reAnalyze?.addEventListener("click", analyzeCurrentTab);
elements.toggleSettings?.addEventListener("click", showSettings);
elements.provider.addEventListener("change", () => {
  updateProviderFields(elements.provider.value);
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
elements.openDashboard.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }).catch((error) => {
    setStatus(error.message || "Unable to open dashboard.", true);
  });
});
elements.copyJson.addEventListener("click", () => {
  copyJson().catch((error) => setStatus(error.message || "Copy failed.", true));
});
elements.exportCsv.addEventListener("click", () => {
  exportCsv().catch((error) => setStatus(error.message || "Export failed.", true));
});
Promise.all([loadSettings(), loadState()]).catch((error) => {
  setStatus(error.message || "Failed to load popup.", true);
});
