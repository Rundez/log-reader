import React, { useEffect, useMemo, useRef, useState } from "react";

type LogSource = {
  id: string;
  name: string;
  basePath: string;
  include: string[];
  exclude?: string[];
};

type LogFileEntry = {
  path: string;
  name: string;
  size: number;
  lastModified: number;
};

type LineEntry = {
  id: number;
  text: string;
};

type SearchMatch = {
  filePath: string;
  lineNumber: number;
  preview: string;
};

const MAX_LINES = 5000;
const DEFAULT_LINES = 2000;

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const formatDate = (value: number) => new Date(value).toLocaleString();

const getLogLevel = (text: string) => {
  const normalized = text.toLowerCase();
  if (normalized.includes("error")) return "error";
  if (normalized.includes("warn")) return "warn";
  if (normalized.includes("debug")) return "debug";
  if (normalized.includes("info")) return "info";
  return "";
};

const App = () => {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<LogSource | null>(null);
  const [files, setFiles] = useState<LogFileEntry[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<LogFileEntry | null>(null);
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [fontSize, setFontSize] = useState(13);
  const [status, setStatus] = useState<string | null>(null);
  const [lineFilter, setLineFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchCase, setSearchCase] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchScope, setSearchScope] = useState<"file" | "source">("file");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineCounter = useRef(0);

  useEffect(() => {
    fetch("/api/sources")
      .then((response) => response.json())
      .then((data) => {
        setSources(data.sources ?? []);
        setSelectedSource(data.sources?.[0] ?? null);
      })
      .catch(() => setStatus("Unable to load log sources."));
  }, []);

  useEffect(() => {
    if (!selectedSource) return;
    fetch(`/api/files?sourceId=${selectedSource.id}`)
      .then((response) => response.json())
      .then((data) => {
        setFiles(data.files ?? []);
        setSelectedFile(data.files?.[0] ?? null);
      })
      .catch(() => setStatus("Unable to load files."));
  }, [selectedSource]);

  useEffect(() => {
    if (!selectedFile) return;
    const params = new URLSearchParams({ path: selectedFile.path, lines: String(DEFAULT_LINES) });
    fetch(`/api/lines?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        lineCounter.current = 0;
        setLines(
          (data.lines ?? []).map((line: string) => ({
            id: ++lineCounter.current,
            text: line,
          }))
        );
        setStatus(null);
        setBookmarks(new Set());
        setSelectedLines(new Set());
      })
      .catch(() => setStatus("Unable to load file contents."));
  }, [selectedFile]);

  useEffect(() => {
    if (!selectedFile || !follow) {
      eventSourceRef.current?.close();
      return;
    }
    const params = new URLSearchParams({ path: selectedFile.path, lines: String(DEFAULT_LINES) });
    const eventSource = new EventSource(`/api/tail?${params.toString()}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      lineCounter.current = 0;
      setLines(
        (data.lines ?? []).map((line: string) => ({
          id: ++lineCounter.current,
          text: line,
        }))
      );
    });

    eventSource.addEventListener("reset", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      lineCounter.current = 0;
      setLines(
        (data.lines ?? []).map((line: string) => ({
          id: ++lineCounter.current,
          text: line,
        }))
      );
    });

    eventSource.addEventListener("line", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setLines((prev) => {
        const next = [...prev, { id: ++lineCounter.current, text: data.line }];
        return next.slice(-MAX_LINES);
      });
    });

    eventSource.addEventListener("error", () => {
      setStatus("Connection error while tailing file.");
    });

    return () => {
      eventSource.close();
    };
  }, [selectedFile, follow]);

  const filteredFiles = useMemo(() => {
    if (!fileFilter) return files;
    const term = fileFilter.toLowerCase();
    return files.filter((file) => file.name.toLowerCase().includes(term));
  }, [files, fileFilter]);

  const displayLines = useMemo(() => {
    if (!lineFilter) return lines;
    const term = lineFilter.toLowerCase();
    return lines.filter((line) => line.text.toLowerCase().includes(term));
  }, [lines, lineFilter]);

  const highlightText = (text: string) => {
    if (!searchTerm) return text;
    try {
      const flags = searchCase ? "g" : "gi";
      const matcher = searchRegex
        ? new RegExp(searchTerm, flags)
        : new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      const parts = text.split(matcher);
      const matches = text.match(matcher);
      if (!matches) return text;
      return parts.flatMap((part, index) => [
        part,
        matches[index] ? (
          <mark key={`${text}-${index}`} className="highlight">
            {matches[index]}
          </mark>
        ) : null,
      ]);
    } catch {
      return text;
    }
  };

  const jumpToEnd = () => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  };

  const refreshFiles = async () => {
    if (!selectedSource) return;
    const response = await fetch("/api/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: selectedSource.id }),
    });
    const data = await response.json();
    setFiles(data.files ?? []);
  };

  const toggleBookmark = (id: number) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectedLine = (id: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copySelectedLines = async () => {
    const text = lines
      .filter((line) => selectedLines.has(line.id))
      .map((line) => line.text)
      .join("\n");
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  const copyMatches = async () => {
    if (!searchTerm) return;
    const matches = displayLines
      .filter((line) => line.text.toLowerCase().includes(searchTerm.toLowerCase()))
      .map((line) => line.text)
      .join("\n");
    if (!matches) return;
    await navigator.clipboard.writeText(matches);
  };

  const runSearch = async () => {
    if (!searchTerm) return;
    setSearching(true);
    setSearchResults([]);
    const targets =
      searchScope === "file" ? (selectedFile ? [selectedFile] : []) : filteredFiles;

    for (const target of targets) {
      await new Promise<void>((resolve) => {
        const params = new URLSearchParams({
          path: target.path,
          q: searchTerm,
          case: String(searchCase),
          regex: String(searchRegex),
        });
        const eventSource = new EventSource(`/api/search?${params.toString()}`);
        eventSource.addEventListener("match", (event) => {
          const data = JSON.parse((event as MessageEvent).data);
          setSearchResults((prev) => [
            ...prev,
            { filePath: target.path, lineNumber: data.lineNumber, preview: data.preview },
          ]);
        });
        eventSource.addEventListener("end", () => {
          eventSource.close();
          resolve();
        });
        eventSource.addEventListener("error", () => {
          eventSource.close();
          resolve();
        });
      });
    }
    setSearching(false);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <header>
          <h1>Log Reader</h1>
          <p>Fast, local Windows log viewer</p>
        </header>
        <section>
          <div className="section-title">Log Sources</div>
          <div className="source-list">
            {sources.map((source) => (
              <button
                key={source.id}
                className={source.id === selectedSource?.id ? "active" : ""}
                onClick={() => setSelectedSource(source)}
              >
                <span>{source.name}</span>
                <small>{source.basePath}</small>
              </button>
            ))}
          </div>
        </section>
        <section>
          <div className="section-title">Search</div>
          <input
            type="text"
            placeholder="Search term"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <div className="toggles">
            <label>
              <input
                type="checkbox"
                checked={searchCase}
                onChange={(event) => setSearchCase(event.target.checked)}
              />
              Case sensitive
            </label>
            <label>
              <input
                type="checkbox"
                checked={searchRegex}
                onChange={(event) => setSearchRegex(event.target.checked)}
              />
              Regex
            </label>
          </div>
          <label className="toggle">
            <span>Scope</span>
            <select value={searchScope} onChange={(event) => setSearchScope(event.target.value as "file" | "source")}>
              <option value="file">Current file</option>
              <option value="source">All files in source</option>
            </select>
          </label>
          <button onClick={runSearch} disabled={searching || !searchTerm}>
            {searching ? "Searching..." : "Search file(s)"}
          </button>
          <button onClick={copyMatches} disabled={!searchTerm}>
            Copy matches in view
          </button>
        </section>
      </aside>

      <section className="file-pane">
        <div className="pane-header">
          <div>
            <strong>Files</strong>
            <button onClick={refreshFiles}>Refresh</button>
          </div>
          <input
            type="text"
            placeholder="Filter filenames"
            value={fileFilter}
            onChange={(event) => setFileFilter(event.target.value)}
          />
        </div>
        <div className="file-list">
          {filteredFiles.map((file) => (
            <button
              key={file.path}
              className={file.path === selectedFile?.path ? "active" : ""}
              onClick={() => setSelectedFile(file)}
            >
              <div className="file-name">{file.name}</div>
              <div className="file-meta">
                {formatBytes(file.size)} · {formatDate(file.lastModified)}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="viewer">
        <div className="pane-header">
          <div className="viewer-title">
            <strong>{selectedFile?.name ?? "Select a file"}</strong>
            {selectedFile && <span>{selectedFile.path}</span>}
          </div>
          <div className="controls">
            <button onClick={() => setFollow((prev) => !prev)}>
              {follow ? "Pause" : "Follow"}
            </button>
            <button onClick={jumpToEnd}>Jump to end</button>
            <button onClick={() => setWrap((prev) => !prev)}>
              {wrap ? "No wrap" : "Wrap"}
            </button>
            <button onClick={() => setFontSize((prev) => Math.max(10, prev - 1))}>A-</button>
            <button onClick={() => setFontSize((prev) => Math.min(20, prev + 1))}>A+</button>
            <button onClick={copySelectedLines} disabled={selectedLines.size === 0}>
              Copy selected lines
            </button>
          </div>
        </div>
        <div className="pane-subheader">
          <input
            type="text"
            placeholder="Filter lines"
            value={lineFilter}
            onChange={(event) => setLineFilter(event.target.value)}
          />
          {status && <span className="status">{status}</span>}
        </div>
        <div
          className={`log-lines ${wrap ? "wrap" : "nowrap"}`}
          style={{ fontSize }}
          ref={containerRef}
        >
          {displayLines.map((line) => (
            <div
              key={line.id}
              className={`log-line ${getLogLevel(line.text)} ${
                selectedLines.has(line.id) ? "selected" : ""
              }`}
            >
              <button
                className={bookmarks.has(line.id) ? "bookmark active" : "bookmark"}
                onClick={() => toggleBookmark(line.id)}
                title="Bookmark line"
              >
                ★
              </button>
              <button
                className={selectedLines.has(line.id) ? "select-line active" : "select-line"}
                onClick={() => toggleSelectedLine(line.id)}
                title="Select line"
              >
                ☐
              </button>
              <span className="line-text">{highlightText(line.text)}</span>
            </div>
          ))}
        </div>
        <div className="search-results">
          <div className="section-title">Search results ({searchResults.length})</div>
          <div className="results-list">
            {searchResults.map((result, index) => (
              <div key={`${result.filePath}-${index}`} className="result-item">
                <div>
                  <strong>{pathBasename(result.filePath)}</strong> · Line {result.lineNumber}
                </div>
                <div className="result-preview">{result.preview}</div>
                <button
                  onClick={() => navigator.clipboard.writeText(result.preview)}
                >
                  Copy match
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

const pathBasename = (value: string) => {
  const parts = value.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? value;
};

export default App;
