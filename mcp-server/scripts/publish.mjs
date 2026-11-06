#!/usr/bin/env node
/**
 * 发布到 npmjs.org。
 *
 * 鉴权优先级：
 *   1. mcp-server/.npm-token（已 gitignore）—— 把 token 作为 npm 的 registry 配置项
 *      直接传进命令行，不依赖 .npmrc，也不依赖 NODE_AUTH_TOKEN（npm 不会自动读取）。
 *   2. 没有该文件时，回退到 npm 登录态（~/.npmrc 里 `npm login` 写入的 session token）。
 *
 * 发布前先跑 `npm whoami` 预检。原因：未认证时 npm 对 publish 会返回 404
 * （"is not in this registry"），这条信息是故意误导的，会让人以为包名有问题。
 * 预检能把真实原因（没登录 / token 失效 / 账号被冻结）直接暴露出来。
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokenFile = join(root, ".npm-token");
const registry = "https://registry.npmjs.org/";

// 优先使用当前 node 自带的 npm，避免 PATH 上是老版本 npm（如 6.x 不支持 granular token）
const npmExec = join(dirname(process.execPath), "npm");
const npmCmd = existsSync(npmExec) ? npmExec : "npm";

const authArgs = ["--registry", registry];
let authSource = "npm 登录态（~/.npmrc）";

if (existsSync(tokenFile)) {
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!token) {
    console.error("[publish] .npm-token 存在但为空。删掉它可回退到 npm 登录态。");
    process.exit(1);
  }
  authArgs.push(`--//registry.npmjs.org/:_authToken=${token}`);
  authSource = ".npm-token";
}

// npm 11 会把 ~/.npmrc 里的镜像遗留配置刷成几十行警告，过滤掉再展示
const tidy = (s) =>
  (s || "")
    .split("\n")
    .filter((line) => line.trim() && !/Unknown user config/.test(line))
    .join("\n")
    .trim();

// 预检：未认证时 publish 会回 404，先 whoami 把真实原因暴露出来
const who = spawnSync(npmCmd, ["whoami", ...authArgs], {
  cwd: root,
  encoding: "utf8",
});
if (who.status !== 0) {
  console.error("[publish] 认证失败，先别发。npm whoami 返回：");
  console.error(tidy(who.stderr) || tidy(who.stdout) || "(无输出)");
  console.error(
    `[publish] 当前凭据来源：${authSource}\n` +
      "  修复：npm login（npm 9+ 走浏览器）后重试；" +
      "或把 granular token 写入 mcp-server/.npm-token。",
  );
  process.exit(1);
}
console.log(`[publish] 已认证为 ${tidy(who.stdout)}（凭据来源：${authSource}）`);

const args = ["publish", "--access", "public", ...authArgs];

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
