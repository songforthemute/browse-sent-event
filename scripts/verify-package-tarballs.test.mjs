import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  normalizePackedPath,
  readPackageJsonFromTarball,
  validatePackedFiles,
  validatePublishedManifest,
} from "./verify-package-tarballs.mjs";

void test("normalizePackedPath accepts pnpm and npm pack path shapes", () => {
  assert.equal(normalizePackedPath("README.md"), "package/README.md");
  assert.equal(normalizePackedPath("package/README.md"), "package/README.md");
});

void test("validatePackedFiles accepts required release files", () => {
  assert.doesNotThrow(() =>
    validatePackedFiles("@browse-sent-event/core", [
      "package.json",
      "dist/index.mjs",
      "dist/index.mjs.map",
      "dist/index.d.mts",
      "dist/index.d.mts.map",
      "README.md",
      "LICENSE",
    ]),
  );
});

void test("validatePackedFiles reports missing required files", () => {
  assert.throws(
    () =>
      validatePackedFiles("@browse-sent-event/core", [
        "package.json",
        "dist/index.mjs",
        "dist/index.mjs.map",
        "dist/index.d.mts",
        "dist/index.d.mts.map",
        "LICENSE",
      ]),
    /@browse-sent-event\/core.*package\/README\.md/s,
  );
});

void test("validatePackedFiles rejects forbidden source files", () => {
  assert.throws(
    () =>
      validatePackedFiles("@browse-sent-event/core", [
        "package.json",
        "dist/index.mjs",
        "dist/index.mjs.map",
        "dist/index.d.mts",
        "dist/index.d.mts.map",
        "README.md",
        "LICENSE",
        "src/index.ts",
      ]),
    /forbidden.*package\/src\/index\.ts/s,
  );
});

void test("validatePublishedManifest rejects workspace protocol dependencies", () => {
  assert.throws(
    () =>
      validatePublishedManifest("@browse-sent-event/plugin-vite", {
        dependencies: {
          "@browse-sent-event/core": "workspace:*",
        },
      }),
    /workspace:\*/,
  );
});

void test("readPackageJsonFromTarball reads the published manifest", () => {
  const tarballPath = path.join(os.tmpdir(), `browse-sent-event-pack-${process.pid}.tgz`);
  const manifest = {
    name: "@browse-sent-event/core",
    version: "0.1.0-alpha.0",
  };

  fs.writeFileSync(
    tarballPath,
    gzipSync(createTarBuffer("package/package.json", JSON.stringify(manifest))),
  );

  try {
    assert.deepEqual(readPackageJsonFromTarball(tarballPath), manifest);
  } finally {
    fs.rmSync(tarballPath, { force: true });
  }
});

function createTarBuffer(name, content) {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");

  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}
