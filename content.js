function collectVisibleText() {
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const chunks = [];

  while (walker.nextNode()) {
    const value = walker.currentNode.nodeValue?.replace(/\s+/g, " ").trim();
    if (!value) {
      continue;
    }

    const parent = walker.currentNode.parentElement;
    if (!parent) {
      continue;
    }

    const tag = parent.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tag)) {
      continue;
    }

    chunks.push(value);
    if (chunks.join(" ").length > 7000) {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "extract-page-data") {
    return;
  }

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20);

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim(),
      href: node.href
    }))
    .filter((link) => link.text)
    .slice(0, 25);

  sendResponse({
    title: document.title,
    url: location.href,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
    headings,
    links,
    metadata: collectMetadata(),
    bodyText: collectVisibleText()
  });
});
