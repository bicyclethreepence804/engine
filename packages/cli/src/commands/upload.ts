import { readFile } from "node:fs/promises";
import path from "node:path";

export type UploadCliArgs = {
  filePath: string;
  dryRun: boolean;
  json: boolean;
  localAnalyzePath?: string;
  apiBaseUrl: string;
  apiKey: string;
  skipStatus: boolean;
};

function normalizeResultsPayload(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { results?: unknown }).results)) {
    return (parsed as { results: unknown[] }).results;
  }
  return [parsed];
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { body?: unknown }).body = body;
    throw err;
  }
  return body;
}

export async function runUpload(args: UploadCliArgs): Promise<void> {
  const abs = path.resolve(process.cwd(), args.filePath);
  const raw = await readFile(abs, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const results = normalizeResultsPayload(parsed);

  if (args.localAnalyzePath) {
    const localAbs = path.resolve(process.cwd(), args.localAnalyzePath);
    const localRaw = await readFile(localAbs, "utf8");
    const localParsed = JSON.parse(localRaw) as { metadata?: unknown };
    const metadata = localParsed.metadata ?? localParsed;
    const first = results[0];
    if (first && typeof first === "object") {
      (first as Record<string, unknown>).kiploksLocalEngine = { metadata };
    }
  }

  const base = args.apiBaseUrl.replace(/\/$/, "");

  if (!args.skipStatus) {
    try {
      const status = (await fetchJson(`${base}/api/integration/analyze-status`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          Accept: "application/json",
        },
      })) as {
        monthlyRemaining?: number;
        monthlyLimit?: number;
        storageUsed?: number;
        storageLimit?: number;
        storageFull?: boolean;
        monthlyResetAt?: string;
      };
      const mr = status.monthlyRemaining ?? 0;
      const ml = status.monthlyLimit ?? 0;
      const su = status.storageUsed ?? 0;
      const sl = status.storageLimit ?? 0;
      if (!args.json) {
        process.stdout.write(
          `Cloud quota: ${mr}/${ml} analyses remaining this month (resets ${status.monthlyResetAt ?? "n/a"}). Storage: ${su}/${sl}.\n`,
        );
      }
      if (status.storageFull) {
        process.stderr.write("Storage full. Delete tests or upgrade before upload.\n");
        process.exitCode = 1;
        return;
      }
      if (mr < results.length) {
        process.stderr.write(
          `Not enough monthly quota (${mr} remaining, ${results.length} result(s) in file). See funnel.upgradeUrl in API response or billing settings.\n`,
        );
        process.exitCode = 1;
        return;
      }
    } catch (e) {
      process.stderr.write(
        `Warning: could not preflight analyze-status (${e instanceof Error ? e.message : String(e)}). Continuing.\n`,
      );
    }
  }

  const bodyObj = {
    results,
    source: "kiploks-cli",
  };

  if (args.dryRun) {
    process.stdout.write(
      args.json
        ? `${JSON.stringify({ dryRun: true, resultCount: results.length, endpoint: `${base}/api/integration/results` })}\n`
        : `Dry run: would POST ${results.length} result(s) to ${base}/api/integration/results\n`,
    );
    return;
  }

  const response = await fetchJson(`${base}/api/integration/results`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(bodyObj),
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return;
  }

  const r = response as {
    resultIds?: string[];
    analyzeUrls?: string[];
    parity?: { status: string; resultIndex: number }[];
    funnel?: { monthlyRemaining?: number; upgradeUrl?: string; freeTier?: boolean };
  };
  process.stdout.write("Upload OK.\n");
  if (r.resultIds?.length) {
    process.stdout.write(`Result IDs: ${r.resultIds.join(", ")}\n`);
  }
  if (r.analyzeUrls?.length) {
    process.stdout.write(`Analyze URLs:\n${r.analyzeUrls.map((u) => `  ${u}`).join("\n")}\n`);
  }
  if (r.parity?.length) {
    process.stdout.write(
      `Engine parity: ${r.parity.map((p) => `#${p.resultIndex}=${p.status}`).join(", ")}\n`,
    );
  }
  if (r.funnel) {
    process.stdout.write(
      `Remaining this month: ${r.funnel.monthlyRemaining ?? "n/a"}${r.funnel.freeTier ? " (free tier)" : ""}\n`,
    );
    if (r.funnel.upgradeUrl) {
      process.stdout.write(`Upgrade / billing: ${r.funnel.upgradeUrl}\n`);
    }
  }
}
