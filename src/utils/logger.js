/**
 * Neutron Launcher - Logger Utility
 * Winston-based structured logger writing to file and console
 */

const { app } = require('electron');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const fs = require('fs-extra');

let logDir;
try {
  logDir = app.getPath('userData');
} catch {
  logDir = require('os').homedir();
}

fs.ensureDirSync(logDir);

const logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  transports: [
    new transports.File({
      filename: path.join(logDir, 'neutron-launcher.log'),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 3,
      tailable: true,
    }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...rest }) => {
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `[${timestamp}] ${level}: ${message}${extra}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
