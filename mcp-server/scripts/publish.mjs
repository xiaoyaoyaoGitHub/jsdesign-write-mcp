#!/usr/bin/env node
/**
 * 读取 mcp-server/.npm-token（已 gitignore）并发布到 npmjs.org。
 *
 * 鉴权方式：把 token 直接作为 npm 的 registry 配置项传入命令行参数，
 * 不依赖 .npmrc，也不依赖 NODE_AUTH_TOKEN 环境变量（npm 不会自动读取）。
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokenFile = join(root, ".npm-token");
const registry = "https://registry.npmjs.org/";

if (!existsSync(tokenFile)) {
  console.error(
    "[publish] 缺少 .npm-token。请在 mcp-server/.npm-token 写入 npm access token（已 gitignore）。",
  );
  process.exit(1);
}

const token = readFileSync(tokenFile, "utf8").trim();
if (!token) {
  console.error("[publish] .npm-token 为空");
  process.exit(1);
}

// 优先使用当前 node 自带的 npm，避免 PATH 上是老版本 npm（如 6.x 不支持 granular token）
const npmExec = join(dirname(process.execPath), "npm");
const npmCmd = existsSync(npmExec) ? npmExec : "npm";

const args = [
  "publish",
  "--access",
  "public",
  "--registry",
  registry,
  `--//registry.npmjs.org/:_authToken=${token}`,
];

// 账号开了 2FA 时，可先 export NPM_OTP=123456 再执行
if (process.env.NPM_OTP) {
  args.push("--otp", process.env.NPM_OTP);
}

const result = spawnSync(npmCmd, args, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
