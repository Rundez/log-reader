import fs from "fs";
import fsPromises from "fs/promises";

const textEncoder = new TextEncoder();

export type TailSnapshot = {
  lines: string[];
  size: number;
  lastModified: number;
};

export const readLastLines = async (filePath: string, lineCount: number): Promise<TailSnapshot> => {
  const fileHandle = await fsPromises.open(filePath, "r");
  try {
    const stat = await fileHandle.stat();
    const chunkSize = 64 * 1024;
    let position = stat.size;
    let buffer = "";
    let lines: string[] = [];

    while (position > 0 && lines.length <= lineCount) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const chunk = Buffer.alloc(readSize);
      await fileHandle.read(chunk, 0, readSize, position);
      buffer = chunk.toString("utf8") + buffer;
      lines = buffer.split(/\r?\n/);
    }

    if (lines.length > lineCount) {
      lines = lines.slice(lines.length - lineCount);
    }

    return {
      lines,
      size: stat.size,
      lastModified: stat.mtimeMs,
    };
  } finally {
    await fileHandle.close();
  }
};

export const createTailStream = (filePath: string, lineCount: number) => {
  let watcher: fs.FSWatcher | undefined;
  let closed = false;
  let lastSize = 0;

  const send = (controller: ReadableStreamDefaultController, event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(textEncoder.encode(payload));
  };

  const startWatching = async (controller: ReadableStreamDefaultController) => {
    try {
      const snapshot = await readLastLines(filePath, lineCount);
      lastSize = snapshot.size;
      send(controller, "snapshot", snapshot);
    } catch (error) {
      send(controller, "error", { message: "Unable to read file.", detail: String(error) });
      return;
    }

    const checkForRotation = async () => {
      try {
        const stat = await fsPromises.stat(filePath);
        if (stat.size < lastSize) {
          const snapshot = await readLastLines(filePath, lineCount);
          lastSize = snapshot.size;
          send(controller, "reset", snapshot);
        }
      } catch {
        send(controller, "error", { message: "File is unavailable." });
      }
    };

    watcher = fs.watch(filePath, { persistent: false }, async (eventType) => {
      if (closed) {
        return;
      }
      if (eventType === "rename") {
        await checkForRotation();
        return;
      }
      try {
        const stat = await fsPromises.stat(filePath);
        if (stat.size < lastSize) {
          const snapshot = await readLastLines(filePath, lineCount);
          lastSize = snapshot.size;
          send(controller, "reset", snapshot);
          return;
        }
        if (stat.size === lastSize) {
          return;
        }
        const stream = fs.createReadStream(filePath, {
          start: lastSize,
          end: stat.size,
        });
        let chunkBuffer = "";
        stream.on("data", (chunk) => {
          chunkBuffer += chunk.toString("utf8");
          const parts = chunkBuffer.split(/\r?\n/);
          chunkBuffer = parts.pop() ?? "";
          parts.forEach((line) => send(controller, "line", { line }));
        });
        stream.on("end", () => {
          if (chunkBuffer) {
            send(controller, "line", { line: chunkBuffer });
          }
        });
        lastSize = stat.size;
      } catch (error) {
        send(controller, "error", { message: "Unable to stream file.", detail: String(error) });
      }
    });
  };

  const stream = new ReadableStream({
    start(controller) {
      startWatching(controller);
    },
    cancel() {
      closed = true;
      watcher?.close();
    },
  });

  return stream;
};
