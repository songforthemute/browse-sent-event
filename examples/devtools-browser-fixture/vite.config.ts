import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

function writeStream(res: ServerResponse, chunks: readonly string[]): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/plain; charset=utf-8");

  for (const chunk of chunks) {
    res.write(chunk);
  }

  res.end();
}

function writeSse(res: ServerResponse, chunks: readonly string[]): void {
  res.statusCode = 200;
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("content-type", "text/event-stream; charset=utf-8");

  for (const chunk of chunks) {
    res.write(`data: ${chunk}\n\n`);
  }

  res.end();
}

function fixtureEndpoints(): Plugin {
  return {
    name: "browse-sent-event-fixture-endpoints",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0];

        if (pathname === "/__bse-fixture/stream") {
          writeStream(res, ["fetch stream hello", "\nfetch stream goodbye"]);
          return;
        }

        if (pathname === "/__bse-fixture/events") {
          writeSse(res, ["eventsource hello", "eventsource goodbye"]);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [fixtureEndpoints(), browseSentEvent()],
});
