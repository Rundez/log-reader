import fs from "fs/promises";
import path from "path";
import { globToRegex, normalizePath } from "./utils";
import type { LogSource } from "./logSources";

export type LogFileEntry = {
  path: string;
  name: string;
  size: number;
  lastModified: number;
};

const walkDir = async (root: string, onFile: (filePath: string) => Promise<void>) => {
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, onFile);
        return;
      }
      if (entry.isFile()) {
        await onFile(fullPath);
      }
    })
  );
};

export const scanLogSource = async (source: LogSource): Promise<LogFileEntry[]> => {
  const includePatterns = source.include.map(globToRegex);
  const excludePatterns = (source.exclude ?? []).map(globToRegex);
  const results: LogFileEntry[] = [];
  const root = source.basePath;
  const normalizedRoot = normalizePath(root);

  await walkDir(root, async (filePath) => {
    const normalized = normalizePath(filePath);
    const relative = normalized.startsWith(normalizedRoot)
      ? normalized.slice(normalizedRoot.length).replace(/^\//, "")
      : normalized;
    const matchesInclude = includePatterns.some((pattern) => pattern.test(relative));
    if (!matchesInclude) {
      return;
    }
    if (excludePatterns.some((pattern) => pattern.test(relative))) {
      return;
    }
    try {
      const stat = await fs.stat(filePath);
      results.push({
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        lastModified: stat.mtimeMs,
      });
    } catch {
      // Ignore files that disappear mid-scan.
    }
  });

  return results.sort((a, b) => b.lastModified - a.lastModified);
};
