import path from "path";

export const normalizePath = (value: string) => value.replace(/\\/g, "/");

export const globToRegex = (pattern: string) => {
  const normalized = normalizePath(pattern);
  const escaped = normalized.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const withGlob = escaped
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*")
    .replace(/\\\?/g, ".");
  return new RegExp(`^${withGlob}$`, "i");
};

export const ensureWindowsPath = (value: string) =>
  value.includes(":") ? value : path.win32.resolve(value);
