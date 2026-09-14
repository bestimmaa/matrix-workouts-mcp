#!/usr/bin/env node
import { getTransportMode } from "./config.js";
import { startHttpServer } from "./http/server.js";
import { startServer } from "./server.js";

if (getTransportMode() === "http") {
  await startHttpServer();
} else {
  await startServer();
}
