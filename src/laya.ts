/**
 * Local Laya: start laya-serve when an agent needs it, stop it when no agent is left.
 *
 * Every jev call made with JEV_LAYA_LOCAL=1 registers the agent it runs under: the first ancestor process that is
 * not a shell (claude, codex, an editor). A detached supervisor keeps laya-serve up while any registered agent is
 * alive, checks every few seconds, and stops it LINGER_MS after the last one exits. Nothing has to say goodbye, so a
 * crashed session ends the same way as a closed one. No call or hook ever waits on a stop.
 *
 * Laya lives in $JEV_LAYA_HOME (default ~/.local/share/jev-laya): a venv with laya[serve], set up by `jev setup`.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { layaUrl } from "./core/client.ts";

export const LAYA_HOME = process.env.JEV_LAYA_HOME || join(process.env.XDG_DATA_HOME || join(homedir(), ".local/share"), "jev-laya");
const SERVE_BIN = process.env.JEV_LAYA_SERVE || join(LAYA_HOME, "venv/bin/laya-serve");
const CHECK_MS = Number(process.env.JEV_LAYA_CHECK_MS) || 5_000;
const LINGER_MS = Number(process.env.JEV_LAYA_LINGER_MS) || 60_000;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish", "ksh", "tcsh", "env", "timeout", "nohup", "xargs", "jev"]);

export const isLocalLaya = () => process.env.JEV_BACKEND === "laya" && process.env.JEV_LAYA_LOCAL === "1";

const dirs = (stateDir: string) => ({ root: join(stateDir, "laya"), agents: join(stateDir, "laya/agents") });
const alive = (pid: number) => { if (!(pid > 1)) return false; try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; } };
const readPid = (file: string) => { try { return Number(readFileSync(file, "utf8")) || 0; } catch { return 0; } };

/** The agent this call runs under: the first ancestor that is not a shell. 0 when there is none (launchd). */
export function agentPid(): { pid: number; name: string } {
  const table = new Map<number, { ppid: number; name: string }>();
  for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" }).split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), name: basename(m[3]).replace(/^-/, "") });
  }
  for (let pid = process.ppid, hops = 0; pid > 1 && hops < 32; hops++) {
    const p = table.get(pid);
    if (!p) break;
    if (!SHELLS.has(p.name)) return { pid, name: p.name };
    pid = p.ppid;
  }
  return { pid: 0, name: "" };
}

export async function healthy(timeoutMs = 1500): Promise<boolean> {
  try { return (await fetch(`${layaUrl()}/health`, { signal: AbortSignal.timeout(timeoutMs) })).ok; } catch { return false; }
}

/** Register the calling agent and make sure a supervisor runs. With waitMs, also wait until Laya answers. */
export async function ensureLaya(stateDir: string, waitMs = 0): Promise<void> {
  const d = dirs(stateDir);
  mkdirSync(d.agents, { recursive: true });
  const agent = agentPid();
  if (agent.pid && process.env.JEV_LAYA_NO_REGISTER !== "1") writeFileSync(join(d.agents, String(agent.pid)), agent.name);
  if (!alive(readPid(join(d.root, "supervisor.pid")))) {
    const log = openSync(join(d.root, "server.log"), "a");
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    spawn(process.execPath, [cli, "laya", "supervise"], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  }
  for (const end = Date.now() + waitMs; ;) {
    if (await healthy()) return;
    if (Date.now() >= end) {
      if (waitMs) throw new Error(`Laya did not answer at ${layaUrl()} within ${Math.round(waitMs / 1000)}s; see ${join(d.root, "server.log")}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Live agents; files of dead ones are removed. */
export function liveAgents(stateDir: string): { pid: number; name: string }[] {
  const d = dirs(stateDir);
  let names: string[] = [];
  try { names = readdirSync(d.agents); } catch { return []; }
  return names.flatMap((f) => {
    const pid = Number(f);
    if (pid && alive(pid)) return [{ pid, name: readFileSync(join(d.agents, f), "utf8") }];
    rmSync(join(d.agents, f), { force: true });
    return [];
  });
}

/** The detached supervisor: one laya-serve, alive while an agent is, gone LINGER_MS after the last. */
export async function supervise(stateDir: string): Promise<void> {
  const d = dirs(stateDir);
  const pidFile = join(d.root, "supervisor.pid");
  if (alive(readPid(pidFile)) && readPid(pidFile) !== process.pid) return; // another supervisor won the race
  writeFileSync(pidFile, String(process.pid));
  const url = new URL(layaUrl());
  const stamp = () => new Date().toISOString();
  console.log(`${stamp()} starting ${SERVE_BIN} on ${url.host}`);
  const server = spawn(SERVE_BIN, [], {
    stdio: "inherit",
    env: { ...process.env, LAYA_HOST: url.hostname, LAYA_PORT: url.port || "8765", LAYA_PRELOAD: "1", LAYA_MODELS: process.env.LAYA_MODELS || "english,multilingual", LAYA_IDLE_UNLOAD_SECONDS: process.env.LAYA_IDLE_UNLOAD_SECONDS || "900" },
  });
  let exited = false;
  server.on("exit", (code) => { exited = true; console.log(`${stamp()} laya-serve exited (${code})`); });
  const stop = (why: string) => {
    console.log(`${stamp()} stopping: ${why}`);
    if (!exited) server.kill("SIGTERM");
    rmSync(pidFile, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("asked to stop"));
  let lastSeen = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, CHECK_MS));
    if (exited) { rmSync(pidFile, { force: true }); process.exit(1); }
    if (liveAgents(stateDir).length) lastSeen = Date.now();
    else if (Date.now() - lastSeen >= LINGER_MS) stop("no agent left");
  }
}

export function stopLaya(stateDir: string): boolean {
  const pid = readPid(join(dirs(stateDir).root, "supervisor.pid"));
  if (!alive(pid)) return false;
  process.kill(pid, "SIGTERM");
  return true;
}

export async function status(stateDir: string) {
  const pid = readPid(join(dirs(stateDir).root, "supervisor.pid"));
  let installed = false;
  try { installed = statSync(SERVE_BIN).isFile(); } catch { /* not installed */ }
  return {
    url: layaUrl(),
    local: isLocalLaya(),
    installed: isLocalLaya() ? installed : undefined,
    supervisor: alive(pid) ? pid : null,
    healthy: await healthy(),
    agents: liveAgents(stateDir),
  };
}
