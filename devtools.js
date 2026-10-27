"use strict";

(function () {
  const panels = chrome.devtools.panels;
  const inspectedWindow = chrome.devtools.inspectedWindow;
  const config = STYLES_TO_VSCODE_CONFIG;
  let sourceUrlsPromise = null;
  let pageVersion = 0;

  function openInDevTools(resource, lineNumber, columnNumber) {
    // openResource 接收从 0 开始的行号，与点击回调的行号约定不同。
    const line = Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber - 1 : 0;
    const column = Number.isInteger(columnNumber) && columnNumber > 0 ? columnNumber - 1 : 0;
    panels.openResource(resource.url, line, column);
  }

  // 此函数只读取样式来源元数据，由 inspectedWindow.eval 在被检查页面中执行。
  function collectPageSourceUrls() {
    const urls = new Set();
    function add(value) {
      if (typeof value === "string" && value.trim()) urls.add(value.trim());
    }
    for (const style of document.querySelectorAll("style")) {
      add(style.getAttribute("data-vite-dev-id"));
      const text = style.textContent || "";
      for (const match of text.matchAll(/\/\*[#@]\s*sourceURL=([^\r\n]*?)\s*\*\//g)) add(match[1]);
      const inlineMap = text.match(/\/\*[#@]\s*sourceMappingURL=(data:application\/json[^,\r\n]*,[^\r\n]*?)\s*\*\//);
      if (!inlineMap) continue;
      try {
        const comma = inlineMap[1].indexOf(",");
        const header = inlineMap[1].slice(0, comma);
        const payload = inlineMap[1].slice(comma + 1);
        const json = /;base64/i.test(header)
          ? new TextDecoder().decode(Uint8Array.from(atob(payload), character => character.charCodeAt(0)))
          : decodeURIComponent(payload);
        const map = JSON.parse(json);
        add(map.file);
        for (const source of Array.isArray(map.sources) ? map.sources : []) {
          add(source);
          if (typeof source !== "string" || typeof map.sourceRoot !== "string" || !map.sourceRoot) continue;
          if (/^(?:[a-z]:[\\/]|[a-z][a-z\d+.-]*:\/\/|[\\/])/i.test(source)) continue;
          add(`${map.sourceRoot.replace(/[\\/]+$/, "")}/${source}`);
        }
      } catch (_) {
        // 无法读取的 Source Map 不作为本地路径的识别依据。
      }
    }
    return Array.from(urls);
  }

  function readUrls(register) {
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => finish([]), 2000);
      function finish(values) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(Array.isArray(values) ? values.filter(value => typeof value === "string") : []);
      }
      try {
        register(finish);
      } catch (_) {
        finish([]);
      }
    });
  }

  function getSourceUrls() {
    if (!sourceUrlsPromise) {
      const resources = readUrls(done => inspectedWindow.getResources(values => done(
        Array.isArray(values) ? values.map(value => value.url) : []
      )));
      const pageSources = readUrls(done => inspectedWindow.eval(
        `(${collectPageSourceUrls.toString()})()`,
        (values, error) => done(error ? [] : values)
      ));
      sourceUrlsPromise = Promise.all([resources, pageSources]).then(values => Array.from(new Set(values.flat())));
    }
    return sourceUrlsPromise;
  }

  function openInEditor(url, resource, lineNumber, columnNumber) {
    // 由 Chrome 调用 Windows 中注册的 vscode 协议，无需本地服务或额外依赖。
    try {
      chrome.tabs.update(inspectedWindow.tabId, { url }, function () {
        const error = chrome.runtime.lastError;
        if (error) {
          console.warn("Styles to VS Code：打开编辑器失败，已返回 DevTools。", error.message);
          openInDevTools(resource, lineNumber, columnNumber);
        }
      });
    } catch (error) {
      console.warn("Styles to VS Code：打开编辑器失败，已返回 DevTools。", error.message);
      openInDevTools(resource, lineNumber, columnNumber);
    }
  }

  if (inspectedWindow.onResourceAdded) {
    inspectedWindow.onResourceAdded.addListener(() => { sourceUrlsPromise = null; });
  }
  if (chrome.devtools.network && chrome.devtools.network.onNavigated) {
    chrome.devtools.network.onNavigated.addListener(() => {
      pageVersion++;
      sourceUrlsPromise = null;
    });
  }

  panels.setOpenResourceHandler(function (resource, lineNumber, columnNumber) {
    if (!resource || !resource.url) return;
    if (!StylesToVSCode.isStyleResource(resource.url, config)) {
      openInDevTools(resource, lineNumber, columnNumber);
      return;
    }
    const directUrl = StylesToVSCode.createVSCodeUrl(resource.url, lineNumber, columnNumber, config);
    if (directUrl) {
      openInEditor(directUrl, resource, lineNumber, columnNumber);
      return;
    }

    const version = pageVersion;
    return getSourceUrls().then(sourceUrls => {
      if (version !== pageVersion) return;
      const url = StylesToVSCode.createVSCodeUrl(resource.url, lineNumber, columnNumber, { ...config, sourceUrls });
      if (url) openInEditor(url, resource, lineNumber, columnNumber);
      else openInDevTools(resource, lineNumber, columnNumber);
    }).catch(() => {
      if (version === pageVersion) openInDevTools(resource, lineNumber, columnNumber);
    });
  });
})();
