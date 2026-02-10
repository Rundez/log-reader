import fs from "fs";
import readline from "readline";

const textEncoder = new TextEncoder();

export type SearchOptions = {
  term: string;
  caseSensitive: boolean;
  regex: boolean;
};

export const createSearchStream = (filePath: string, options: SearchOptions) => {
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(textEncoder.encode(payload));
      };

      const input = fs.createReadStream(filePath, { encoding: "utf8" });
      input.on("error", (error) => {
        send("error", { message: "Unable to search file.", detail: String(error) });
        controller.close();
      });

      const matcher = (() => {
        if (options.regex) {
          try {
            return new RegExp(options.term, options.caseSensitive ? "g" : "gi");
          } catch (error) {
            send("error", { message: "Invalid regex.", detail: String(error) });
            controller.close();
            return null;
          }
        }
        const escaped = options.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(escaped, options.caseSensitive ? "g" : "gi");
      })();

      if (!matcher) {
        return;
      }

      let lineNumber = 0;
      const rl = readline.createInterface({ input, crlfDelay: Infinity });

      rl.on("line", (line) => {
        lineNumber += 1;
        if (!matcher.test(line)) {
          matcher.lastIndex = 0;
          return;
        }
        matcher.lastIndex = 0;
        send("match", { lineNumber, line, preview: line.slice(0, 300) });
      });

      rl.on("close", () => {
        send("end", { complete: true });
        controller.close();
      });
    },
  });

  return stream;
};
