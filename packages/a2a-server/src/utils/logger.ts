/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import winston from 'winston';
import path from 'node:path';
import os from 'node:os';

/**
 * Determines the appropriate logging transport based on the environment.
 *
 * When NATIVE_HOST_MODE is set, we must NOT write to stdout/stderr
 * because that would corrupt the native messaging protocol (which uses stdio).
 * Instead, we write logs to a file in the temp directory.
 *
 * @returns The Winston transport to use
 */
function getTransport(): winston.transport {
  const isNativeHostMode = process.env['NATIVE_HOST_MODE'] === 'true';

  if (isNativeHostMode) {
    // In native host mode, write to file to avoid stdout pollution
    const logPath = path.join(os.tmpdir(), 'a2a-server.log');
    return new winston.transports.File({
      filename: logPath,
      maxsize: 5 * 1024 * 1024, // 5MB max file size
      maxFiles: 3, // Keep up to 3 log files
    });
  }

  // Default: use console transport for standalone mode
  return new winston.transports.Console();
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    // First, add a timestamp to the log info object
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS A', // Custom timestamp format
    }),
    // Here we define the custom output format
    winston.format.printf((info) => {
      const { level, timestamp, message, ...rest } = info;
      return (
        `[${level.toUpperCase()}] ${timestamp} -- ${message}` +
        `${Object.keys(rest).length > 0 ? `\n${JSON.stringify(rest, null, 2)}` : ''}`
      ); // Only print ...rest if present
    }),
  ),
  transports: [getTransport()],
});

export { logger };
