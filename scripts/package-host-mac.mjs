import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const hostDir = path.join(rootDir, "apps", "host");
const sharedProtocolDir = path.join(rootDir, "packages", "shared-protocol");
const electronAppDir = path.join(rootDir, "node_modules", "electron", "dist", "Electron.app");
const releaseDir = path.join(hostDir, "release");
const packagedAppDir = path.join(releaseDir, "CTRLX Host.app");
const appContentsDir = path.join(packagedAppDir, "Contents");
const appResourcesDir = path.join(appContentsDir, "Resources", "app");

async function copyDir(source, target) {
  await cp(source, target, {
    recursive: true,
    force: true
  });
}

async function main() {
  if (!existsSync(electronAppDir)) {
    throw new Error(`Electron.app not found at ${electronAppDir}`);
  }

  await rm(packagedAppDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  await copyDir(electronAppDir, packagedAppDir);

  const plistPath = path.join(appContentsDir, "Info.plist");
  const plist = await readFile(plistPath, "utf8");
  const updatedPlist = plist
    .replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/,
      "<key>CFBundleDisplayName</key>\n\t<string>CTRLX Host</string>"
    )
    .replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/,
      "<key>CFBundleName</key>\n\t<string>CTRLX Host</string>"
    )
    .replace(
      /<key>CFBundleIdentifier<\/key>\s*<string>[^<]+<\/string>/,
      "<key>CFBundleIdentifier</key>\n\t<string>com.ctrlx.remotehost</string>"
    );
  await writeFile(plistPath, updatedPlist, "utf8");

  await rm(appResourcesDir, { recursive: true, force: true });
  await mkdir(path.join(appResourcesDir, "node_modules"), { recursive: true });

  const hostPackage = JSON.parse(await readFile(path.join(hostDir, "package.json"), "utf8"));
  const runtimePackage = {
    name: "ctrlx-host-runtime",
    version: hostPackage.version,
    private: true,
    type: "module",
    main: "dist/main.js"
  };

  await writeFile(
    path.join(appResourcesDir, "package.json"),
    `${JSON.stringify(runtimePackage, null, 2)}\n`,
    "utf8"
  );

  await copyDir(path.join(hostDir, "dist"), path.join(appResourcesDir, "dist"));
  await copyDir(path.join(hostDir, "src"), path.join(appResourcesDir, "src"));
  await copyDir(path.join(sharedProtocolDir, "dist"), path.join(appResourcesDir, "shared-protocol", "dist"));
  await copyDir(path.join(rootDir, "node_modules", "ws"), path.join(appResourcesDir, "node_modules", "ws"));

  const packagedProtocolPath = path.join(appResourcesDir, "dist", "protocol.js");
  const packagedProtocolSource = await readFile(packagedProtocolPath, "utf8");
  const rewrittenProtocolSource = packagedProtocolSource.replace(
    '../../../packages/shared-protocol/dist/index.js',
    '../shared-protocol/dist/index.js'
  );
  await writeFile(packagedProtocolPath, rewrittenProtocolSource, "utf8");

  console.log(`Packaged app created at ${packagedAppDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
