import { pino } from "pino";

// Pretty output when a human is watching, plain JSON lines otherwise (CI, files, log shippers).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.stdout.isTTY
    ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
    : undefined,
});
