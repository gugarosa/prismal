// @ts-check
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const npmPath =
  process.env.npm_execpath ||
  (process.platform === "win32" ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js") : null);

/** Runs npm without relying on Windows executing a .cmd file. @param {string[]} args @param {{cwd: string}} options */
export function runNpm(args, options) {
  return npmPath ? exec(process.execPath, [npmPath, ...args], options) : exec("npm", args, options);
}
