const DEFAULT_SETTINGS = {
  provider: "groq",
  groqApiBaseUrl: "https://api.groq.com/openai/v1/chat/completions",
  ollamaBaseUrl: "http://localhost:11434",
  model: "llama-3.3-70b-versatile"
};
const STORAGE_KEYS = ["providerApiKeys", "provider", "ollamaBaseUrl"];
const PROVIDER_LABELS = {
  groq: "Groq",
  ollama: "Ollama"
};
const GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
const OLLAMA_DEFAULT_MODELS = ["llama3.2", "llama3.1", "mistral", "llama2"];
const GROQ_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const GROQ_FREE_TIER_MODEL_ORDER = [
  "groq/compound-mini",
  "groq/compound",
  "moonshotai/kimi-k2-instruct-0905",
  "moonshotai/kimi-k2-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
  "allam-2-7b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant"
];

const groqModelCache = new Map();

function getJsonFromText(text) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1] : text;
  return JSON.parse(candidate.trim());
}


function safeParseModelJson(text) {
  try {
    return getJsonFromText(text);
  } catch {
    const cleaned = String(text || "")
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();
    return JSON.parse(cleaned);
  }
}
function slimPageData(pageData, maxBodyChars = 1200) {
  const discBodyChars = Math.max(200, Math.floor(maxBodyChars * 0.5));
  const maxPeople     = maxBodyChars < 500 ? 4 : 15;   // keep more people
  const maxSnippets   = maxBodyChars < 500 ? 2 : 6;    // keep more snippets
  const maxHeadings   = maxBodyChars < 500 ? 5 : 8;

  const slim = {
    title: pageData.title,
    url: pageData.url,
    description: pageData.description,
    headings: (pageData.headings || []).slice(0, maxHeadings),
    bodyText: (pageData.bodyText || "").slice(0, maxBodyChars),
    people: (pageData.people || []).slice(0, maxPeople),
    teamSnippets: (pageData.teamSnippets || []).slice(0, maxSnippets)
  };

  if (Array.isArray(pageData.discoveredPages) && pageData.discoveredPages.length > 0) {
    slim.discoveredPages = pageData.discoveredPages.map((p) => ({
      title: p.title,
      url: p.url,
      headings: (p.headings || []).slice(0, 5),
      bodyText: (p.bodyText || "").slice(0, discBodyChars),
      people: (p.people || []).slice(0, 3)
    }));
  }

  return slim;
}

function buildPrompt(pageData, maxBodyChars = 3000) {
  return [
    "You are a business intelligence classifier.",
    "Infer the most likely business type and services from the website data.",
    "Pay close attention to: services pages, about pages, page headings, and body text describing what the business does.",
    "The 'discoveredPages' field contains additional pages crawled from the site — use them to improve accuracy.",
    "Return strict JSON with this exact shape:",
    JSON.stringify({
      businessType: "short label",
      industry: "industry name",
      confidence: 0,
      summary: "one short paragraph",
      services: ["service 1", "service 2"],
      evidence: ["reason 1", "reason 2"],
      websiteSignals: "keywords, pages, language, or patterns that support the classification"
    }),
    "Rules:",
    "- confidence must be a number between 0 and 1",
    "- services must be an array of plain strings",
    "- evidence must be an array of plain strings",
    "- do not include markdown",
    "- if the website is ambiguous, say so in summary and lower confidence",
    "",
    "Website data:",
    JSON.stringify(slimPageData(pageData, maxBodyChars))
  ].join("\n");
}

function buildPickPagesPrompt(homepage, focus = "business") {
  const goal = focus === "employee"
    ? "find pages most likely to contain team members, staff bios, founders, executives, or people profiles"
    : "find pages most likely to reveal what the business does, its services, products, or industry";

  const maxPages = focus === "employee" ? 6 : 3;

  return [
    `You are helping analyze a website. Your goal: ${goal}.`,
    `Based on the homepage data below, pick up to ${maxPages} internal page URLs that would be most useful.`,
    "Return strict JSON with this exact shape:",
    JSON.stringify({ urls: ["https://example.com/about", "https://example.com/services"] }),
    "Rules:",
    "- urls must be an array of absolute URLs (strings only)",
    "- only pick URLs that appear in the links list",
    `- pick at most ${maxPages} URLs`,
    "- do not include the homepage URL itself",
    "- do not include markdown",
    "- if no useful links exist, return { urls: [] }",
    "",
    "Homepage data:",
    JSON.stringify(homepage)
  ].join("\n");
}


function buildEmployeePrompt(pageData, maxBodyChars = 3000) {
  return [
    "You are an expert at extracting people and employee details from website content.",
    "Extract every real person mentioned — founders, executives, team members, advisors, directors, staff, and contacts.",
    "Look in: headings, body text, team sections, bios, about pages, contact pages, and JSON-LD data.",
    "Common patterns to detect:",
    "  - 'Name - Title'  or  'Name, Title'  or  'Name | Role'",
    "  - Person cards with name + role text",
    "  - JSON-LD Person schema blocks",
    "  - mailto: links (extract the name nearby)",
    "Return strict JSON with this exact shape:",
    JSON.stringify({
      people: [
        {
          name: "Full Name",
          title: "Job title or role",
          email: "person@example.com",
          phone: "+1 555 123 4567",
          linkedinUrl: "https://www.linkedin.com/in/example"
        }
      ],
      teamSummary: "Describe team size, seniority mix, and any notable leadership found",
      evidence: ["reason 1", "reason 2"]
    }),
    "Rules:",
    "- Extract ALL people found, up to 50",
    "- people must be an array of objects",
    "- each person object may include only: name, title, email, phone, linkedinUrl",
    "- do NOT invent or guess contact details — only include what is explicitly on the page",
    "- if a field is unknown, omit it entirely",
    "- names must be real human names (First Last), not company or product names",
    "- evidence must be an array of plain strings explaining what you found",
    "- do not include markdown",
    "",
    "Website data:",
    JSON.stringify(slimPageData(pageData, maxBodyChars))
  ].join("\n");
}

function getModelCandidates(settings) {
  const models = [settings.model, ...GROQ_FREE_TIER_MODEL_ORDER].filter(Boolean);

  return [...new Set(models)];
}

function isLikelyTextGenerationModel(model) {
  const id = String(model?.id || "").toLowerCase();
  if (!id || model?.active === false) {
    return false;
  }

  if (/whisper|tts|speech|audio|transcribe|distil-whisper|guard|safeguard|playai|orb|orpheus/.test(id)) {
    return false;
  }

  return /llama|qwen|gemma|mistral|deepseek|gpt-oss|compound|kimi|allam/.test(id);
}

async function fetchGroqModelCatalog(apiKey) {
  const normalizedKey = normalizeApiKey(apiKey);
  const cached = groqModelCache.get(normalizedKey);
  const now = Date.now();
  if (cached && (now - cached.cachedAt) < GROQ_MODEL_CACHE_TTL_MS) {
    return cached.models;
  }

  const response = await fetch(GROQ_MODELS_ENDPOINT, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${normalizedKey}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Groq model catalog request failed (${response.status}): ${errorText}`);
    error.status = response.status;
    error.responseText = errorText;
    throw error;
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : [];
  groqModelCache.set(normalizedKey, {
    cachedAt: now,
    models
  });
  return models;
}

async function getGroqModelCandidates(settings) {
  const requestedModels = getModelCandidates(settings);
  let activeModels = [];

  try {
    activeModels = await fetchGroqModelCatalog(settings.apiKey);
  } catch (error) {
    if (error?.status === 401) {
      throw new Error(buildAuthErrorMessage(settings, error));
    }
    return requestedModels;
  }

  const activeIds = new Set(
    activeModels
      .filter(isLikelyTextGenerationModel)
      .map((model) => model.id)
  );

  const freeTierIds = GROQ_FREE_TIER_MODEL_ORDER.filter((id) => activeIds.has(id));
  const requestedActiveIds = requestedModels.filter((id) => activeIds.has(id));
  const fallbackActiveIds = activeModels
    .map((model) => model.id)
    .filter((id) => activeIds.has(id));

  const orderedCandidates = [
    ...requestedActiveIds,
    ...freeTierIds,
    ...fallbackActiveIds
  ];

  const uniqueCandidates = [...new Set(orderedCandidates)];
  return uniqueCandidates.length ? uniqueCandidates : requestedModels;
}

function isRateLimitResponse(status, text) {
  if (status === 429) {
    return true;
  }

  return /rate.limit|rate_limit|too many requests|limit exceeded/i.test(text || "");
}

function normalizeApiKey(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function keyLooksLike(provider, key) {
  const normalized = normalizeApiKey(key);
  if (!normalized) {
    return false;
  }

  switch (provider) {
    case "groq":
      return /^gsk_[0-9A-Za-z]+/i.test(normalized);
    default:
      return true;
  }
}

function findLikelyProviderForKey(key) {
  return ["groq"].find((provider) => keyLooksLike(provider, key)) || null;
}

function getApiKeyValidationError(provider, apiKey) {
  if (provider === "ollama") {
    return "";
  }

  const key = normalizeApiKey(apiKey);
  if (!key) {
    return `Missing API key for ${PROVIDER_LABELS[provider] || provider}. No saved Groq API key was found in extension storage.`;
  }

  if (provider === "groq" && !keyLooksLike("groq", key)) {
    return "The saved Groq API key does not look valid. Groq keys usually start with \"gsk_\".";
  }

  return "";
}

function buildAuthErrorMessage(settings, error) {
  const providerLabel = PROVIDER_LABELS[settings.provider] || settings.provider;
  const likelyProvider = findLikelyProviderForKey(settings.apiKey);
  const mismatchHint = likelyProvider && likelyProvider !== settings.provider
    ? ` The saved key looks like a ${PROVIDER_LABELS[likelyProvider]} key.`
    : "";
  const invalidKeyHint = /invalid_api_key|invalid api key/i.test(error.responseText || "")
    ? ` ${providerLabel} rejected the saved API key.${mismatchHint}`
    : "";

  return `Authentication failed for ${providerLabel}.${invalidKeyHint} Replace the saved Groq API key and reload the extension.`;
}

async function requestModel(settings, promptText, model, maxTokens = 1200) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (settings.apiKey) {
    headers["Authorization"] = `Bearer ${settings.apiKey}`;
  }

  const body = {
    model,
    temperature: 0.2,
    max_tokens: maxTokens,
    messages: [
      {
        role: "system",
        content: "You classify websites into business types and service offerings."
      },
      {
        role: "user",
        content: promptText
      }
    ]
  };

  if (settings.provider !== "ollama") {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(settings.apiBaseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`API request failed (${response.status}): ${errorText}`);
    error.status = response.status;
    error.responseText = errorText;
    throw error;
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("The API response did not include a model message.");
  }

  const parsed = safeParseModelJson(content);

  return {
    ...parsed,
    modelUsed: model,
    rawResponse: payload
  };
}

async function fetchOllamaModelCatalog(ollamaBaseUrl) {
  const tagsUrl = `${ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`;
  const response = await fetch(tagsUrl);
  if (!response.ok) {
    throw new Error(`Ollama model list request failed (${response.status})`);
  }
  const payload = await response.json();
  return (payload?.models || []).map((m) => m.name || m.model).filter(Boolean);
}

async function getOllamaModelCandidates(settings) {
  try {
    const models = await fetchOllamaModelCatalog(
      settings.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl
    );
    return models.length ? models : OLLAMA_DEFAULT_MODELS;
  } catch {
    return OLLAMA_DEFAULT_MODELS;
  }
}

async function analyzeWithApi(settings, promptBuilder, isEmployeeAnalysis = false) {
  const candidates = settings.provider === "ollama"
    ? await getOllamaModelCandidates(settings)
    : await getGroqModelCandidates(settings);
  let lastError = null;
  let maxBodyChars = 1200;

  for (const model of candidates) {
    const promptText = promptBuilder(maxBodyChars);
    const maxTokens = isEmployeeAnalysis ? 4000 : 1200;
    try {
      return await requestModel(settings, promptText, model, maxTokens);
    } catch (error) {
      lastError = error;
      if (error?.status === 401) {
        if (settings.provider === "groq") {
          throw new Error(buildAuthErrorMessage(settings, error));
        }
        throw error;
      }
      const isRequestTooLarge = error?.status === 413 ||
        /request_too_large|request entity too large/i.test(error?.responseText || "");
      if (isRequestTooLarge) {
        maxBodyChars = Math.floor(maxBodyChars / 2);
        continue;
      }
      if (!isRateLimitResponse(error.status, error.responseText)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("All fallback models failed.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["analyze-page", "analyze-employee-details", "pick-pages"].includes(message?.type)) {
    if (message?.type !== "open-side-panel") {
      return;
    }

    (async () => {
      const focusedWindow = await chrome.windows.getLastFocused().catch(() => null);
      const windowId = message.windowId ?? sender.tab?.windowId ?? focusedWindow?.id;
      if (typeof windowId !== "number") {
        sendResponse({
          ok: false,
          error: "Side panel is unavailable in this window."
        });
        return;
      }

      await chrome.sidePanel.open({ windowId });
      sendResponse({ ok: true, mode: "sidepanel" });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

    return true;
  }

  (async () => {
    const sessionStored = await chrome.storage.session.get(STORAGE_KEYS);
    const stored = await chrome.storage.sync.get(STORAGE_KEYS);
    const localStored = await chrome.storage.local.get(STORAGE_KEYS);
    const settings = { ...DEFAULT_SETTINGS };
    const providerApiKeys = {
      ...(localStored.providerApiKeys || {}),
      ...(stored.providerApiKeys || {}),
      ...(sessionStored.providerApiKeys || {})
    };
    settings.apiKey = normalizeApiKey(providerApiKeys.groq);
    settings.provider = sessionStored.provider || stored.provider || localStored.provider || DEFAULT_SETTINGS.provider;
    settings.ollamaBaseUrl = sessionStored.ollamaBaseUrl || stored.ollamaBaseUrl || localStored.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl;
    settings.apiBaseUrl = settings.provider === "ollama"
      ? `${settings.ollamaBaseUrl}/v1/chat/completions`
      : DEFAULT_SETTINGS.groqApiBaseUrl;

    const apiKeyError = getApiKeyValidationError(settings.provider, settings.apiKey);
    if (apiKeyError) {
      throw new Error(apiKeyError);
    }

    const pageData = message.pageData;
    const promptBuilder = message.type === "analyze-employee-details"
      ? (maxBodyChars) => buildEmployeePrompt(pageData, maxBodyChars)
      : message.type === "pick-pages"
      ? (_) => buildPickPagesPrompt(message.homepage, message.focus || "business")
      : (maxBodyChars) => buildPrompt(pageData, maxBodyChars);
    const result = await analyzeWithApi(settings, promptBuilder, message.type === "analyze-employee-details");
    // For pick-pages, return urls array directly
    if (message.type === "pick-pages") {
      sendResponse({ ok: true, urls: result.urls || [] });
    } else {
      sendResponse({ ok: true, result });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});