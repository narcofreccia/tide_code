import * as net from "node:net";
import * as fs from "node:fs";
import { Transport } from "./ipc/transport.js";
import { handleMessage } from "./ipc/handler.js";

function parseArgs(): { socket: string } {
  const args = process.argv.slice(2);
  const socketIdx = args.indexOf("--socket");
  if (socketIdx === -1 || socketIdx + 1 >= args.length) {
    console.error("Usage: tide-engine --socket <path>");
    process.exit(1);
  }
  return { socket: args[socketIdx + 1] };
}

function cleanupSocket(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // ignore
  }
}

const { socket: socketPath } = parseArgs();

cleanupSocket(socketPath);

const server = net.createServer((connection) => {
  console.log("[engine] Client connected");
  const transport = new Transport(connection);

  transport.onMessage((msg) => {
    handleMessage(msg, transport);
  });

  transport.onClose(() => {
    console.log("[engine] Client disconnected");
  });
});

server.listen(socketPath, () => {
  console.log(`[engine] Listening on ${socketPath}`);
});

process.on("SIGTERM", () => {
  console.log("[engine] SIGTERM received, shutting down");
  server.close();
  cleanupSocket(socketPath);
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[engine] SIGINT received, shutting down");
  server.close();
  cleanupSocket(socketPath);
  process.exit(0);
});
