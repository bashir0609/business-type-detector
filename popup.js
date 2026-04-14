const LATEST_RESULT_KEY = "latestAnalysis";
const MAX_RESEARCH_PAGES = 2;
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
  ollamaFields: document.getElementById("ollamaFields"),
  groqApiKey: document.getElementById("groqApiKey"),
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
  const isOllama = provider === "ollama";
  elements.groqFields.classList.toggle("hidden", isOllama);
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
  elements.provider.value = provider;
  elements.ollamaBaseUrl.value = ollamaBaseUrl;
  updateProviderFields(provider);
}

async function saveSettings() {
  const providerApiKeys = {
    groq: elements.groqApiKey.value.trim()
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
  function textValue(node) {
    return node?.textContent?.replace(/\s+/g, " ").trim() || "";
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
    const text = String(value || "").trim();
    return /linkedin\.com/i.test(text) ? text : "";
  }

  function normalizeEmail(value) {
    const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : "";
  }

  function normalizePhone(value) {
    const text = String(value || "").trim();
    const digits = text.replace(/[^\d+]/g, "");
    return digits.length >= 7 ? text : "";
  }

  function mergePeople(people) {
    const merged = new Map();
    for (const person of people) {
      const name = String(person?.name || "").trim();
      if (!name) {
        continue;
      }
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
    return [...merged.values()].slice(0, 20);
  }

  function collectPeopleFromJsonLd() {
    const people = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const payload = JSON.parse(script.textContent || "null");
        walkJson(payload, (node) => {
          const typeValue = node["@type"];
          const types = Array.isArray(typeValue) ? typeValue : [typeValue];
          if (!types.includes("Person")) {
            return;
          }
          const name = String(node.name || "").trim();
          const title = String(node.jobTitle || node.roleName || node.description || "").trim();
          if (!name) {
            return;
          }
          people.push({
            name,
            title,
            email: node.email || "",
            phone: node.telephone || "",
            linkedinUrl: node.sameAs || node.url || ""
          });
        });
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    }
    return people;
  }

  function collectPeopleFromDom() {
    const people = [];
    const teamContainers = Array.from(document.querySelectorAll([
      "[class*='team']",
      "[id*='team']",
      "[class*='staff']",
      "[id*='staff']",
      "[class*='leader']",
      "[id*='leader']",
      "[class*='leadership']",
      "[id*='leadership']",
      "[class*='member']",
      "[id*='member']",
      "[class*='profile']",
      "[id*='profile']",
      "[class*='bio']",
      "[id*='bio']",
      "[class*='founder']",
      "[id*='founder']",
      "[class*='management']",
      "[id*='management']",
      "[class*='advisor']",
      "[id*='advisor']",
      "[class*='board']",
      "[id*='board']",
      "[class*='about']",
      "[id*='about']",
      "[class*='employee']",
      "[id*='employee']"
    ].join(","))).slice(0, 20);

    for (const container of teamContainers) {
      const cards = Array.from(container.querySelectorAll("article, li, div, section")).slice(0, 30);
      for (const card of cards) {
        const name = textValue(card.querySelector("h1, h2, h3, h4, h5, h6, strong, b, a"));
        const role = textValue(card.querySelector([
          "[class*='title']",
          "[class*='role']",
          "[class*='position']",
          "[class*='designation']",
          "[class*='job']",
          "p",
          "span",
          "small"
        ].join(",")));
        if (!name || name.length > 80) {
          continue;
        }
        const emailLink = card.querySelector("a[href^='mailto:']");
        const phoneLink = card.querySelector("a[href^='tel:']");
        const linkedinLink = Array.from(card.querySelectorAll("a[href]")).find((link) => /linkedin\.com/i.test(link.href));
        people.push({
          name,
          title: role && role !== name ? role.slice(0, 120) : "",
          email: emailLink?.href?.replace(/^mailto:/i, "") || normalizeEmail(textValue(card)),
          phone: phoneLink?.href?.replace(/^tel:/i, "") || normalizePhone(textValue(card)),
          linkedinUrl: linkedinLink?.href || ""
        });
        if (people.length >= 20) {
          return mergePeople(people);
        }
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
      if (!/(founder|co-founder|ceo|cto|cfo|director|manager|lead|head|principal|partner|consultant|engineer|designer|advisor|president|chair|employee|staff|team|operations|marketing|sales|specialist)/i.test(role)) {
        continue;
      }
      matches.push({
        name,
        title: role,
        email: "",
        phone: "",
        linkedinUrl: ""
      });
      if (matches.length >= 20) {
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
    const keywordPattern = /(team|staff|leadership|founder|about us|about|management|employee|our people|who we are)/i;

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

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => ({
      text: textValue(node),
      href: node.href
    }))
    .filter((link) => link.text)
    .slice(0, 40);

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

function scoreLink(link, origin, focus = "business") {
  try {
    const parsed = new URL(link.href);
    if (parsed.origin !== origin) {
      return -1;
    }
    let score = 0;
    const haystack = `${link.text} ${parsed.pathname}`.toLowerCase();
    if (focus === "employee") {
      if (/(team|people|leadership|staff|management|founder|employee|our-team|meet-the-team|executive|board|advisor|who-we-are)/.test(haystack)) score += 12;
      if (/(about|company|overview)/.test(haystack)) score += 8;
      if (/(contact|locations|office)/.test(haystack)) score += 3;
      if (/(services|solutions|what-we-do|capabilities)/.test(haystack)) score += 1;
    } else {
      if (/(services|solutions|what-we-do|capabilities|offerings|products)/.test(haystack)) score += 12;
      if (/(about|company|overview)/.test(haystack)) score += 8;
      if (/(industries|clients|portfolio|case-studies)/.test(haystack)) score += 4;
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
    .map((link) => ({ ...link, score: scoreLink(link, origin, focus) }))
    .filter((link) => link.score >= 0)
    .sort((a, b) => b.score - a.score);

  const urls = [pageData.url, getSiteRoot(pageData.url)];
  for (const link of rankedLinks) {
    urls.push(link.href);
    if (urls.length >= maxPages * 2) {
      break;
    }
  }

  return [...new Set(urls)].slice(0, maxPages);
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

  const allPeople = dedupePeople(pages.flatMap((page) => page.people || [])).slice(0, 25);
  const allTeamSnippets = [...new Set(pages.flatMap((page) => page.teamSnippets || []))].slice(0, 12);

  return {
    title: primaryPage.title,
    url: primaryPage.url,
    description: primaryPage.description,
    headings: primaryPage.headings,
    metadata: primaryPage.metadata,
    bodyText: primaryPage.bodyText,
    discoveredPages: pages.map((page) => ({
      title: page.title,
      url: page.url,
      description: page.description,
      headings: page.headings,
      bodyText: page.bodyText,
      people: page.people,
      teamSnippets: page.teamSnippets
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
  // Popup only analyzes the single current page — no background tab crawling
  const primaryPage = await extractPageDataFromTab(tabId);
  const pageData = {
    ...primaryPage,
    discoveredPages: [],
    people: normalizePeople(primaryPage.people || []),
    teamSnippets: primaryPage.teamSnippets || []
  };

  setStatus("Classifying business type, services, and team details...");
  const response = await chrome.runtime.sendMessage({
    type: "analyze-page",
    pageData: compactResearchPayload(pageData)
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
      const primaryPage = await extractPageDataFromTab(tab.id);
      const pageData = {
        ...primaryPage,
        discoveredPages: [],
        people: normalizePeople(primaryPage.people || []),
        teamSnippets: primaryPage.teamSnippets || []
      };
      const response = await chrome.runtime.sendMessage({
        type: "analyze-employee-details",
        pageData: compactResearchPayload(pageData)
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