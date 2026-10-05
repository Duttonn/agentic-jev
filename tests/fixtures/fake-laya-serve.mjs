#!/usr/bin/env node
// A stand-in for laya-serve: the same env contract (LAYA_HOST, LAYA_PORT, LAYA_API_KEY) and the Jev wire protocol.
// Answers are fixed; usage echoes the max_len it was sent so tests can check the client asks for the full window.
import { createServer } from "node:http";

const key = process.env.LAYA_API_KEY;
createServer((req, res) => {
  const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (key && req.headers.authorization !== `Bearer ${key}`) return send(401, { detail: "missing or wrong bearer" });
  if (req.method === "GET" && req.url === "/health") return send(200, { status: "ok" });
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const { questions, max_len } = JSON.parse(raw);
    const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      if (q.type === "noul") return [id, { type: "noul", noul: 0.9, confidence: 0.9 }];
      const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]));
      return [id, q.type === "choice"
        ? { type: "choice", choice: keys[0], probabilities, confidence: 1 }
        : { type: "score", score: 0, probabilities, confidence: 1, legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])) }];
    }));
    send(200, { model: "laya-fake", answers, usage: { input_tokens: 10, output_tokens: 0, max_len_seen: max_len ?? null } });
  });
}).listen(Number(process.env.LAYA_PORT), process.env.LAYA_HOST || "127.0.0.1");
