// Expo config plugin: on `expo prebuild`, links the AppMCPHarness pod (Debug configuration
// only) and starts the harness from AppDelegate.swift behind `#if DEBUG`. Release builds
// neither compile nor link the harness, so they never open the port.
const fs = require("fs");
const path = require("path");

// Resolve Expo from the app being prebuilt, not from this package: when the plugin is
// linked from a checkout (`link:` / `file:`), its real path has no node_modules.
function configPlugins() {
  try {
    return require(require.resolve("expo/config-plugins", { paths: [process.cwd()] }));
  } catch {
    return require("expo/config-plugins");
  }
}

const POD_LINE = "pod 'AppMCPHarness'";

/** Adds the Debug-only pod right after `use_expo_modules!` in the app target. */
function addPod(podfile, harnessPath) {
  if (podfile.includes(POD_LINE)) return podfile;
  const anchor = /^(\s*)use_expo_modules!.*$/m;
  const match = podfile.match(anchor);
  if (!match) throw new Error("app-mcp-expo-plugin: no `use_expo_modules!` line in the Podfile");
  const line = `${match[1]}${POD_LINE}, :path => '${harnessPath}', :configurations => ['Debug']`;
  return podfile.replace(anchor, `${match[0]}\n${line}`);
}

/** Imports the harness and starts it first thing in didFinishLaunchingWithOptions. */
function addHarnessStart(appDelegate, port) {
  if (appDelegate.includes("AppMCP.start(")) return appDelegate;
  const launch = /didFinishLaunchingWithOptions[^{]*\{\n/;
  if (!launch.test(appDelegate)) {
    throw new Error("app-mcp-expo-plugin: no application(_:didFinishLaunchingWithOptions:) in AppDelegate.swift");
  }
  const withStart = appDelegate.replace(
    launch,
    (m) => `${m}#if DEBUG\n    AppMCP.start(port: ${port})\n#endif\n`,
  );
  // Imports must precede declarations; put ours after the last top-level import.
  const imports = [...withStart.matchAll(/^(?:[a-z]+ )?import .+$/gm)];
  const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
  return `${withStart.slice(0, at)}\n#if DEBUG\nimport AppMCPHarness\n#endif${withStart.slice(at)}`;
}

function defaultHarnessPath() {
  return path.resolve(fs.realpathSync(__dirname), "..", "swift-harness");
}

const withAppMcp = (config, options = {}) => {
  const { withPodfile, withAppDelegate } = configPlugins();
  const port = options.port ?? 8787;
  const harnessPath = path.resolve(options.harnessPath ?? defaultHarnessPath());
  if (!fs.existsSync(path.join(harnessPath, "AppMCPHarness.podspec"))) {
    throw new Error(
      `app-mcp-expo-plugin: AppMCPHarness.podspec not found in ${harnessPath}. ` +
        "Pass { harnessPath: '<checkout>/swift-harness' } in the plugin options.",
    );
  }

  config = withPodfile(config, (c) => {
    const relative = path.relative(c.modRequest.platformProjectRoot, harnessPath);
    c.modResults.contents = addPod(c.modResults.contents, relative);
    return c;
  });

  config = withAppDelegate(config, (c) => {
    if (c.modResults.language !== "swift") {
      throw new Error("app-mcp-expo-plugin: only a Swift AppDelegate is supported");
    }
    c.modResults.contents = addHarnessStart(c.modResults.contents, port);
    return c;
  });

  return config;
};

module.exports = withAppMcp;
module.exports.addPod = addPod;
module.exports.addHarnessStart = addHarnessStart;
