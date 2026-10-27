"use strict";

(function () {
  const styleFile = /\.(?:vue|css|scss|sass|less|styl|stylus)$/i;

  function normalizePath(value) {
    const parts = [];
    for (const part of value.replace(/\\/g, "/").split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (parts.length <= 1) return null;
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return parts.join("/");
  }

  function isLocalHost(hostname) {
    if (["localhost", "[::1]", "0.0.0.0"].includes(hostname)) return true;
    if (hostname.endsWith(".localhost")) return true;
    const parts = hostname.split(".").map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }
    return parts[0] === 127 || parts[0] === 10 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }

  function collapseRepeatedSourceDirectory(relative, directory = false) {
    const parts = relative.split("/");
    const directoryLength = directory ? parts.length : parts.length - 1;
    let start = 0;
    let repeated = true;
    // 同时处理 src/views/foo/src/views/foo/ 这样的完整目录前缀重复。
    while (repeated) {
      repeated = false;
      for (let length = 1; start + length * 2 <= directoryLength; length++) {
        const first = parts.slice(start, start + length);
        if (!first.every((part, index) => part.toLowerCase() === parts[start + length + index].toLowerCase())) continue;
        start += length;
        repeated = true;
        break;
      }
    }
    return parts.slice(start).join("/");
  }

  function readSourcePath(resourceUrl) {
    if (typeof resourceUrl !== "string" || !resourceUrl.trim()) return null;
    // 先移除 URL 查询和片段，再解码，保留文件名中经过转义的空格和 #。
    let value = resourceUrl.trim().split(/[?#]/, 1)[0];
    try {
      value = decodeURIComponent(value).replace(/\\/g, "/");
    } catch (_) {
      return null;
    }

    if (/^webpack:\/\//i.test(value)) {
      const match = /^webpack:\/\/([^/]*)(\/.*)$/i.exec(value);
      if (!match) return null;
      value = match[2];
    } else if (/^file:\/\//i.test(value)) {
      try {
        const url = new URL(resourceUrl);
        if (url.hostname && url.hostname !== "localhost") return null;
        value = decodeURIComponent(url.pathname).replace(/\\/g, "/");
        if (!/^\/?[a-z]:\//i.test(value)) return null;
      } catch (_) {
        return null;
      }
    } else if (/^https?:\/\//i.test(value)) {
      let url;
      try {
        url = new URL(resourceUrl);
        if (!isLocalHost(url.hostname)) return null;
        value = decodeURIComponent(url.pathname).replace(/\\/g, "/");
      } catch (_) {
        return null;
      }
    } else if (!/^\/?[a-z]:\//i.test(value) && /^[a-z][a-z\d+.-]*:/i.test(value)) {
      return null;
    }

    value = value.replace(/^\/+/, "").replace(/^(?:\.\/)+/, "").replace(/^@fs\//i, "");
    // 未映射的加载器模块和编译产物继续交给 DevTools，避免误定位。
    if (value.includes("!") || /[<>"|?*\u0000-\u001f]/.test(value)) return null;
    return value;
  }

  function isExcluded(value, config) {
    return config.excludeNodeModules !== false && /(?:^|\/)node_modules(?:\/|$)/i.test(value);
  }

  function normalizeWindowsChunk(value, directory) {
    if (!/^[a-z]:\//i.test(value) || value.slice(2).includes(":")) return null;
    const normalized = normalizePath(value);
    if (!normalized || !/^[a-z]:\//i.test(normalized)) return null;
    const parts = normalized.split("/");
    const srcIndex = parts.findIndex((part, index) => index > 0 && part.toLowerCase() === "src");
    if (srcIndex === -1) return normalized;
    const root = parts.slice(0, srcIndex).join("/");
    const relative = collapseRepeatedSourceDirectory(parts.slice(srcIndex).join("/"), directory);
    return `${root}/${relative}`;
  }

  function resolveAbsolutePath(value) {
    const starts = Array.from(value.matchAll(/(?:^|\/)([a-z]:\/)/gi), match =>
      match.index + match[0].length - match[1].length
    );
    if (!starts.length || starts[0] !== 0) return null;
    const chunks = starts.map((start, index) => {
      const directory = index < starts.length - 1;
      const end = directory ? starts[index + 1] - 1 : value.length;
      return normalizeWindowsChunk(value.slice(start, end), directory);
    });
    if (chunks.some(chunk => !chunk)) return null;
    const file = chunks[chunks.length - 1];
    // 重复的绝对路径前缀必须与最终文件目录一致，避免丢弃冲突的项目路径。
    if (chunks.slice(0, -1).some(directory => !file.toLowerCase().startsWith(`${directory.toLowerCase()}/`))) return null;
    return file;
  }

  function uniquePaths(values) {
    return Array.from(new Map(values.map(value => [value.toLowerCase(), value])).values());
  }

  function collectKnownFiles(config) {
    const files = [];
    for (const sourceUrl of Array.isArray(config.sourceUrls) ? config.sourceUrls : []) {
      const value = readSourcePath(sourceUrl);
      if (!value || isExcluded(value, config)) continue;
      const file = resolveAbsolutePath(value);
      if (file) files.push(file);
    }
    return uniquePaths(files);
  }

  function inferSourceRoot(file) {
    const parts = file.split("/");
    const indexes = parts.reduce((result, part, index) => {
      if (index > 0 && index < parts.length - 1 && part.toLowerCase() === "src") result.push(index);
      return result;
    }, []);
    // 嵌套 src 目录无法唯一确定根目录，保留浏览器内打开。
    return indexes.length === 1 ? parts.slice(0, indexes[0]).join("/") : null;
  }

  function isStyleResource(resourceUrl, config = {}) {
    const value = readSourcePath(resourceUrl);
    return Boolean(value && styleFile.test(value) && !isExcluded(value, config));
  }

  function resolveFile(resourceUrl, config = {}) {
    const value = readSourcePath(resourceUrl);
    if (!value || !styleFile.test(value) || isExcluded(value, config)) return null;
    const absolute = resolveAbsolutePath(value);
    if (absolute) return absolute;
    if (value.includes(":")) return null;

    let relative = normalizePath(value);
    if (!relative || !relative.includes("/")) return null;
    if (/^src\//i.test(relative)) relative = collapseRepeatedSourceDirectory(relative);
    const knownFiles = collectKnownFiles(config);
    const matches = uniquePaths(knownFiles.filter(file => file.toLowerCase().endsWith(`/${relative.toLowerCase()}`)));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;

    const roots = uniquePaths(knownFiles.map(inferSourceRoot).filter(Boolean));
    if (roots.length !== 1 || !/^src\//i.test(relative)) return null;
    return resolveAbsolutePath(`${roots[0]}/${relative}`);
  }

  function createVSCodeUrl(resourceUrl, lineNumber, columnNumber, config = {}) {
    const file = resolveFile(resourceUrl, config);
    if (!file) return null;
    // setOpenResourceHandler 提供从 1 开始的行列号；首行在部分版本中为 undefined。
    const line = Number.isInteger(lineNumber) && lineNumber > 0 ? lineNumber : 1;
    const column = Number.isInteger(columnNumber) && columnNumber > 0 ? columnNumber : 1;
    const encodedPath = file.split("/").map((part, index) => index === 0 ? part : encodeURIComponent(part)).join("/");
    return `vscode://file/${encodedPath}:${line}:${column}`;
  }

  globalThis.StylesToVSCode = Object.freeze({ resolveFile, createVSCodeUrl, isStyleResource });
})();
