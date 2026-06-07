import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const packages = [
  {
    name: "@browse-sent-event/core",
    dir: "packages/core",
  },
  {
    name: "@browse-sent-event/plugin-vite",
    dir: "packages/plugin-vite",
  },
];

const requiredFiles = [
  "package/package.json",
  "package/dist/index.mjs",
  "package/dist/index.mjs.map",
  "package/dist/index.d.mts",
  "package/dist/index.d.mts.map",
  "package/README.md",
  "package/LICENSE",
];

const forbiddenFilePatterns = [
  /^package\/src\//,
  /\/__tests__\//,
  /^package\/node_modules\//,
  /^package\/\.tmp-/,
  /^package\/playwright-report\//,
  /^package\/test-results\//,
];

export function normalizePackedPath(packedPath) {
  return packedPath.startsWith("package/") ? packedPath : `package/${packedPath}`;
}

export function validatePackedFiles(packageName, packedFiles) {
  const normalizedFiles = packedFiles.map((file) => normalizePackedPath(file));
  const fileSet = new Set(normalizedFiles);
  const missingFiles = requiredFiles.filter((file) => !fileSet.has(file));
  const forbiddenFiles = normalizedFiles.filter((file) =>
    forbiddenFilePatterns.some((pattern) => pattern.test(file)),
  );

  const errors = [];
  if (missingFiles.length > 0) {
    errors.push(`missing required files: ${missingFiles.join(", ")}`);
  }
  if (forbiddenFiles.length > 0) {
    errors.push(`forbidden files: ${forbiddenFiles.join(", ")}`);
  }
  if (errors.length > 0) {
    throw new Error(`${packageName} tarball check failed: ${errors.join("; ")}`);
  }
}

export function validatePublishedManifest(packageName, manifest) {
  const dependencyGroups = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];
  const workspaceDependencies = [];

  for (const group of dependencyGroups) {
    const dependencies = manifest[group] ?? {};
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (typeof specifier === "string" && specifier.includes("workspace:")) {
        workspaceDependencies.push(`${group}.${name}=${specifier}`);
      }
    }
  }

  if (workspaceDependencies.length > 0) {
    throw new Error(
      `${packageName} tarball package.json contains workspace protocol dependencies: ${workspaceDependencies.join(", ")}`,
    );
  }
}

export function parsePnpmPackJson(stdout) {
  const output = stdout.trim();
  if (output.length === 0) {
    throw new Error("pnpm pack returned empty JSON output");
  }
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function readPackageJsonFromTarball(tarballPath) {
  const tarBuffer = gunzipSync(fs.readFileSync(tarballPath));
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    const name = readTarString(header, 0, 100);
    if (name.length === 0) {
      break;
    }

    const prefix = readTarString(header, 345, 155);
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || "0", 8);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;

    if (fullName === "package/package.json") {
      const rawManifest = tarBuffer.subarray(contentStart, contentEnd).toString("utf8");
      return JSON.parse(rawManifest);
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  throw new Error(`${tarballPath} does not contain package/package.json`);
}

function readTarString(buffer, start, length) {
  const value = buffer.subarray(start, start + length).toString("utf8");
  const nulIndex = value.indexOf("\u0000");
  return (nulIndex === -1 ? value : value.slice(0, nulIndex)).trim();
}

function packPackage({ rootDir, packDir, packageConfig }) {
  const packageDir = path.join(rootDir, packageConfig.dir);
  const pnpmCommand = process.env.PACK_CHECK_PNPM ?? "pnpm";
  const result = spawnSync(pnpmCommand, ["pack", "--pack-destination", packDir, "--json"], {
    cwd: packageDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`${packageConfig.name} could not run ${pnpmCommand}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(
      `${packageConfig.name} pnpm pack failed with exit code ${result.status}\n${result.stderr}`,
    );
  }

  const [packResult] = parsePnpmPackJson(result.stdout);
  validatePackedFiles(
    packageConfig.name,
    packResult.files.map((file) => file.path),
  );

  const tarballPath = path.isAbsolute(packResult.filename)
    ? packResult.filename
    : path.join(packageDir, packResult.filename);
  const publishedManifest = readPackageJsonFromTarball(tarballPath);
  validatePublishedManifest(packageConfig.name, publishedManifest);

  return {
    name: packageConfig.name,
    tarballPath,
    fileCount: packResult.files.length,
  };
}

export function verifyPackageTarballs({
  rootDir = process.cwd(),
  packDir = path.join(rootDir, ".tmp-pack"),
} = {}) {
  fs.rmSync(packDir, { recursive: true, force: true });
  fs.mkdirSync(packDir, { recursive: true });

  return packages.map((packageConfig) => packPackage({ rootDir, packDir, packageConfig }));
}

function main() {
  const results = verifyPackageTarballs();
  for (const result of results) {
    process.stdout.write(
      `${result.name}: ${result.fileCount} files checked (${result.tarballPath})\n`,
    );
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
