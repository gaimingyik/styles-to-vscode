"use strict";

// 仅在 Node 中验证路径解析和浏览器 API 调用，不启动项目或浏览器。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const extension = path.resolve(__dirname, "..");
const scripts = ["config.js", "path-mapping.js", "devtools.js"];
let checks = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }

function style(sourceUrl, map, viteId) {
  const comments = [];
  if (sourceUrl) comments.push(`/*# sourceURL=${sourceUrl} */`);
  if (map) comments.push(`/*# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")} */`);
  return { textContent: comments.join("\n"), getAttribute: name => name === "data-vite-dev-id" ? viteId || null : null };
}

function environment() {
  const state = { styles: [], resources: [], deferred: false, resourceFailure: false, pageFailure: false, launchError: null, launchThrows: false };
  const calls = { resources: 0, page: 0, updates: [], sources: [], warnings: [] };
  const listeners = {};
  const pending = {};
  const timers = new Map();
  let timerId = 0;
  const page = vm.createContext({
    TextDecoder, Uint8Array,
    atob: value => Buffer.from(value, "base64").toString("latin1"),
    document: { querySelectorAll: () => state.styles }
  });
  const context = vm.createContext({
    URL,
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => calls.warnings.push(args) },
    chrome: {
      runtime: {},
      devtools: {
        panels: {
          setOpenResourceHandler: handler => { listeners.open = handler; },
          openResource: (url, line, column) => calls.sources.push({ url, line, column })
        },
        inspectedWindow: {
          tabId: 27,
          onResourceAdded: { addListener: callback => { listeners.added = callback; } },
          getResources: callback => {
            calls.resources++;
            if (state.resourceFailure) throw new Error("Resources unavailable");
            if (state.deferred) pending.resources = callback;
            else callback(state.resources.map(url => ({ url })));
          },
          eval: (expression, callback) => {
            calls.page++;
            if (state.pageFailure) return callback(undefined, { isError: true });
            if (state.deferred) pending.page = callback;
            else callback(vm.runInContext(expression, page), null);
          }
        },
        network: { onNavigated: { addListener: callback => { listeners.navigated = callback; } } }
      },
      tabs: { update: (id, options, callback) => {
        if (state.launchThrows) throw new Error("Editor API unavailable");
        calls.updates.push({ id, url: options.url });
        if (state.launchError) context.chrome.runtime.lastError = { message: state.launchError };
        callback();
        delete context.chrome.runtime.lastError;
      } }
    }
  });
  for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(extension, file), "utf8"), context, { filename: file });
  return { state, calls, listeners, pending, timers, context, mapper: context.StylesToVSCode, config: context.STYLES_TO_VSCODE_CONFIG };
}

async function main() {
  const base = environment();
  const { mapper, config } = base;
  const rootA = "D:/work/project-a";
  const rootB = "E:/code/项目 B";
  const fileA = `${rootA}/src/views/index.vue`;
  const fileB = `${rootB}/src/views/index.vue`;
  const resolves = (url, expected, options = config) => equal(mapper.resolveFile(url, options), expected, String(url));

  for (const file of [fileA, fileB, "C:/sites/project/styles/home.scss", "F:/other/app/components/Panel.vue"]) {
    for (const url of [file, file.replaceAll("/", "\\"), `file:///${file}`, `file://localhost/${file}`, `http://localhost/${file}`, `http://localhost:5173/@fs/${file}`, `webpack://any-project/./${file}`]) resolves(url, file);
  }
  for (const host of ["127.0.0.1", "[::1]", "app.localhost", "192.168.1.12", "10.0.0.5", "172.16.2.3"]) resolves(`http://${host}/${fileA}`, fileA);
  for (const count of [2, 3, 4]) {
    resolves(`http://localhost/${(rootA + "/src/views/").repeat(count)}index.vue`, fileA);
    resolves(`file:///${rootA}/${"src/views/".repeat(count)}index.vue`, fileA);
    resolves(`webpack://other/${rootA}/${"src/views/".repeat(count)}${rootA}/${"src/views/".repeat(count)}index.vue`, fileA);
  }
  const legacyProject = "D:/work/legacy-project";
  const otherProject = "E:/work/another-project";
  const customerDirectory = "src/views/customers/";
  const screenshot = `http://localhost/${legacyProject}/${customerDirectory.repeat(2)}${legacyProject}/${customerDirectory.repeat(2)}customers.vue`;
  resolves(screenshot, `${legacyProject}/${customerDirectory}customers.vue`);
  equal(mapper.createVSCodeUrl(screenshot, 2262, 1), `vscode://file/${legacyProject}/${customerDirectory}customers.vue:2262:1`, "Mixed repeated path line");
  resolves(`${otherProject}/src/components/ThemePicker/src/components/ThemePicker/index.vue`, `${otherProject}/src/components/ThemePicker/index.vue`);
  resolves(`${otherProject}/src/components/RightPanel/${otherProject}/src/components/RightPanel/index.vue`, `${otherProject}/src/components/RightPanel/index.vue`);
  resolves(`${otherProject}/src/components/Toolbar/index.vue`, `${otherProject}/src/components/Toolbar/index.vue`);

  const a = { ...config, sourceUrls: [fileA, `${rootA}/src/main.js`] };
  const both = { ...config, sourceUrls: [fileA, fileB] };
  for (const url of ["src/views/index.vue", "/src/views/index.vue", "webpack://arbitrary/./src/views/index.vue", "http://localhost/src/views/index.vue", "src/views/src/views/index.vue"]) resolves(url, fileA, a);
  resolves("views/index.vue", fileA, a);
  resolves("src/new/New.vue", `${rootA}/src/new/New.vue`, a);
  resolves("src/views/index.vue", null);
  resolves("src/views/index.vue", null, both);
  resolves("src/new/New.vue", null, both);
  resolves("index.vue", null, a);
  resolves("index.vue", null, both);
  resolves("src/views/index.vue", fileA, { ...config, sourceUrls: [fileA, `${rootB}/src/Header.vue`] });
  resolves("src/new/New.vue", null, { ...config, sourceUrls: ["D:/work/src/project/src/App.vue"] });
  resolves("src/views/index.vue", fileA, { ...config, sourceUrls: [fileA, "C:/vendor/node_modules/lib/src/Theme.vue"] });
  resolves("src/views/index.vue", null, { ...config, sourceUrls: [`https://example.com/${fileA}`] });

  for (const nested of ["src/components/src/Button.vue", "src/components/components/Button.vue", "src/views/foo/src/views/other/Test.vue"]) resolves(`${rootA}/${nested}`, `${rootA}/${nested}`);
  for (const url of [null, "", "data:text/css,body{}", "blob:http://localhost/example.scss", "vscode://file/D:/a.scss", "D:/bad%Q0.scss", "D:/bad%00.scss", "D:/bad%3F.scss", "D:/source.scss:stream", "D:/../../outside.scss", "file://server/share/file.scss", "file:///home/project/src/App.vue", `http://example.com/${fileA}`, `${rootA}/src/${rootB}/src/App.vue`, `${rootA}/src/views/old/${rootA}/src/views/new/Test.vue`, `${rootA}/node_modules/lib/theme.scss`, "webpack:///./node_modules/css-loader!./src/App.vue", `${rootA}/src/main.js`, `${rootA}/src/main.ts`, `http://localhost/${rootA}/src/App.vue${rootA}/src/App.vue`]) resolves(url, null, a);
  equal(mapper.createVSCodeUrl(`${rootB}/src/样式/My%20File%23one.scss`, 12, 3), `vscode://file/E:/code/%E9%A1%B9%E7%9B%AE%20B/src/%E6%A0%B7%E5%BC%8F/My%20File%23one.scss:12:3`, "Unicode and reserved filename characters");
  equal("projectRoot" in config, false, "No fixed project root");
  equal("webpackNamespaces" in config, false, "No namespace allowlist");

  const direct = environment();
  await direct.listeners.open({ url: fileB }, 98, 4);
  equal(direct.calls.updates[0], { id: 27, url: mapper.createVSCodeUrl(fileB, 98, 4) }, "Direct absolute link launches editor");
  equal(direct.calls.page + direct.calls.resources, 0, "Absolute links do not scan page metadata");
  await direct.listeners.open({ url: `${rootA}/node_modules/lib/theme.scss` }, 51, 2);
  equal(direct.calls.sources[0], { url: `${rootA}/node_modules/lib/theme.scss`, line: 50, column: 1 }, "Dependency behavior unchanged");

  const metadata = environment();
  metadata.state.styles = [style(null, { version: 3, sourceRoot: rootB + "/src/views", sources: ["index.vue"] })];
  await metadata.listeners.open({ url: "webpack://new-name/./src/views/index.vue" }, 123, 2);
  equal(metadata.calls.updates[0], { id: 27, url: mapper.createVSCodeUrl(fileB, 123, 2) }, "Inline Source Map resolves relative path");
  await metadata.listeners.open({ url: "src/views/index.vue" }, 124, 3);
  equal(metadata.calls.page, 1, "Metadata cached within a page");
  equal(metadata.calls.resources, 1, "Resource list cached within a page");
  metadata.state.styles = [style(null, null, fileA)];
  metadata.listeners.navigated("http://localhost/another-project");
  await metadata.listeners.open({ url: "src/views/index.vue" }, 50, 1);
  equal(metadata.calls.updates[2].url, mapper.createVSCodeUrl(fileA, 50, 1), "Navigation discards previous project context");
  metadata.state.styles = [style(fileB)];
  metadata.listeners.added({ url: "new-style" });
  await metadata.listeners.open({ url: "src/views/index.vue" }, 60, 1);
  equal(metadata.calls.updates[3].url, mapper.createVSCodeUrl(fileB, 60, 1), "Added resources invalidate metadata cache");

  const ambiguous = environment();
  ambiguous.state.resources = [fileA, fileB];
  await ambiguous.listeners.open({ url: "src/views/index.vue" }, 30, 9);
  equal(ambiguous.calls.updates.length, 0, "Ambiguous project never launches editor");
  equal(ambiguous.calls.sources[0], { url: "src/views/index.vue", line: 29, column: 8 }, "Ambiguous link stays in browser with original position");
  const missing = environment();
  missing.state.pageFailure = true;
  missing.state.resourceFailure = true;
  await missing.listeners.open({ url: "src/views/index.vue" }, 20, 1);
  equal(missing.calls.sources.length, 1, "Unavailable metadata falls back");

  const timeout = environment();
  timeout.state.deferred = true;
  const timed = timeout.listeners.open({ url: "src/views/index.vue" }, 20, 1);
  for (const callback of Array.from(timeout.timers.values())) callback();
  await timed;
  equal(timeout.calls.sources.length, 1, "Unresponsive metadata falls back after timeout");
  const stale = environment();
  stale.state.deferred = true;
  const previousClick = stale.listeners.open({ url: "src/views/index.vue" }, 20, 1);
  stale.listeners.navigated("http://localhost/new-project");
  stale.pending.resources([{ url: fileA }]);
  stale.pending.page([fileA], null);
  await previousClick;
  equal(stale.calls.updates.length + stale.calls.sources.length, 0, "An old in-flight click cannot act on the new page");

  const failure = environment();
  failure.state.launchError = "Editor unavailable";
  await failure.listeners.open({ url: fileA }, 22, 4);
  equal(failure.calls.sources[0], { url: fileA, line: 21, column: 3 }, "Editor launch failure keeps browser fallback");
  failure.state.launchThrows = true;
  await failure.listeners.open({ url: fileA });
  equal(failure.calls.sources[1], { url: fileA, line: 0, column: 0 }, "Unavailable editor API is handled");

  let existingFiles = 0;
  for (const root of process.argv.slice(2)) {
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && /\.(vue|css|scss|sass|less|styl|stylus)$/i.test(entry.name)) {
          const normalized = file.replaceAll("\\", "/");
          resolves(normalized, normalized);
          equal(fs.existsSync(mapper.resolveFile(normalized)), true, normalized);
          existingFiles++;
        }
      }
    }
    walk(path.join(root, "src"));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));
  equal(manifest.version, "1.1.0", "Universal extension version");
  equal(manifest.permissions, undefined, "No new permissions");
  equal(manifest.host_permissions, undefined, "No new host permissions");
  console.log(JSON.stringify({ checksPassed: checks, existingFilesChecked: existingFiles, multiProjectExample: mapper.resolveFile(`${otherProject}/src/components/Toolbar/index.vue`), status: "passed" }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
