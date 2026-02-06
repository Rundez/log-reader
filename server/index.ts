import path from "path";
import fs from "fs";
import { logSources } from "./logSources";
import { scanLogSource } from "./fileScanner";
import { createTailStream, readLastLines } from "./tail";
import { createSearchStream } from "./search";

const PORT = Number(process.env.PORT ?? 3210);
const staticRoot = path.resolve(import.meta.dir, "../web/dist");

const fileCache = new Map<string, { files: Awaited<ReturnType<typeof scanLogSource>>; updatedAt: number }>();

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const respondNotFound = () => new Response("Not found", { status: 404 });

const getSource = (id: string | null) => logSources.find((source) => source.id === id) ?? null;

const serveStatic = async (request: Request) => {
  const url = new URL(request.url);
  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(staticRoot, safePath);

  if (!filePath.startsWith(staticRoot)) {
    return respondNotFound();
  }

  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      const indexFile = Bun.file(path.join(staticRoot, "index.html"));
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }
      return respondNotFound();
    }
    return new Response(file);
  } catch {
    return respondNotFound();
  }
};

const parseLineCount = (value: string | null) => {
  const parsed = Number(value ?? 2000);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 2000;
  }
  return Math.min(parsed, 20000);
};

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/sources") {
      return json({ sources: logSources });
    }

    if (url.pathname === "/api/files") {
      const source = getSource(url.searchParams.get("sourceId"));
      if (!source) {
        return json({ error: "Unknown log source." }, { status: 400 });
      }
      const cached = fileCache.get(source.id);
      if (cached) {
        return json({ sourceId: source.id, files: cached.files, cachedAt: cached.updatedAt });
      }
      const files = await scanLogSource(source);
      fileCache.set(source.id, { files, updatedAt: Date.now() });
      return json({ sourceId: source.id, files, cachedAt: Date.now() });
    }

    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const source = getSource(body?.sourceId ?? null);
      if (!source) {
        return json({ error: "Unknown log source." }, { status: 400 });
      }
      const files = await scanLogSource(source);
      fileCache.set(source.id, { files, updatedAt: Date.now() });
      return json({ sourceId: source.id, files, cachedAt: Date.now() });
    }

    if (url.pathname === "/api/lines") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return json({ error: "Path is required." }, { status: 400 });
      }
      try {
        const lineCount = parseLineCount(url.searchParams.get("lines"));
        const snapshot = await readLastLines(filePath, lineCount);
        return json({ path: filePath, ...snapshot });
      } catch (error) {
        return json({ error: "Unable to read file.", detail: String(error) }, { status: 500 });
      }
    }

    if (url.pathname === "/api/tail") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return json({ error: "Path is required." }, { status: 400 });
      }
      const lineCount = parseLineCount(url.searchParams.get("lines"));
      const stream = createTailStream(filePath, lineCount);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (url.pathname === "/api/search") {
      const filePath = url.searchParams.get("path");
      const term = url.searchParams.get("q");
      if (!filePath || !term) {
        return json({ error: "Path and query are required." }, { status: 400 });
      }
      const stream = createSearchStream(filePath, {
        term,
        caseSensitive: url.searchParams.get("case") === "true",
        regex: url.searchParams.get("regex") === "true",
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    if (url.pathname.startsWith("/api")) {
      return respondNotFound();
    }

    if (fs.existsSync(staticRoot)) {
      return serveStatic(request);
    }

    return new Response(
      "Web assets not found. Run `bun run build:web` in the project root.",
      { status: 404 }
    );
  },
});

console.log(`Log Reader running at http://localhost:${server.port}`);
