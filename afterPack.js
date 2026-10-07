// Adds a free local signature so Apple Silicon Macs don't call the app "damaged".
const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execSync(`xattr -cr "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
