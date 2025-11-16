#!/usr/bin/env -S ts-node --esm
import axios, { AxiosResponse } from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const combinationSchema = z.object({
  term: z.string().min(1, "term is required"),
  campus: z.string().min(1, "campus is required"),
  subjects: z.array(z.string().min(1)).nonempty("at least one subject is required")
});

const configSchema = z.object({
  baseUrl: z.string().url(),
  endpoint: z.string().min(1),
  outputDir: z.string().min(1),
  logFile: z.string().min(1),
  queryDefaults: z.record(z.string()).default({}),
  requestIntervalMs: z.number().int().nonnegative().default(0),
  timeoutMs: z.number().int().positive().default(15000),
  combinations: z.array(combinationSchema).nonempty("at least one term/campus pair must be defined")
});

type SocProbeConfig = z.infer<typeof configSchema>;

type SocCombination = SocProbeConfig["combinations"][number];

type SnapshotBucket = {
  term: string;
  campus: string;
  subjects: Set<string>;
  records: unknown[];
};

type Stats = {
  requests: number;
  successes: number;
};

type RequestLog = {
  term: string;
  campus: string;
  subject: string;
  status: number;
  durationMs: number;
  count: number;
};

const USER_AGENT = "BetterCourseSchedulePlanner/0.1 soc_probe";

export type RunOptions = {
  cwd?: string;
};

async function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = await loadProbeConfig(configPath);
  await runProbe(config);
}

function parseArgs(argv: string[]) {
  let configPath = "configs/soc_probe.sample.json";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config" || arg === "-c") {
      configPath = argv[i + 1];
      i += 1;
    }
  }

  if (!configPath) {
    throw new Error("missing --config argument");
  }

  return { configPath: path.resolve(process.cwd(), configPath) };
}

export async function loadProbeConfig(configPath: string): Promise<SocProbeConfig> {
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  return configSchema.parse(parsed);
}

export async function runProbe(config: SocProbeConfig, options: RunOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  const absoluteOutputDir = path.resolve(cwd, config.outputDir);
  const absoluteLogFile = path.resolve(cwd, config.logFile);
  await fs.mkdir(absoluteOutputDir, { recursive: true });
  await fs.mkdir(path.dirname(absoluteLogFile), { recursive: true });

  const httpClient = axios.create({
    baseURL: normalizeUrl(config.baseUrl, config.endpoint),
    timeout: config.timeoutMs,
    headers: {
      "User-Agent": USER_AGENT
    }
  });

  const stats: Stats = { requests: 0, successes: 0 };
  const buckets = new Map<string, SnapshotBucket>();

  for (const combination of config.combinations) {
    for (const subject of combination.subjects) {
      stats.requests += 1;
      const bucket = getOrCreateBucket(buckets, combination);
      try {
        const result = await fetchSubject({
          client: httpClient,
          defaults: config.queryDefaults,
          combination,
          subject
        });
        bucket.records.push(...result.records);
        bucket.subjects.add(subject);

        const duration = Math.round(result.durationMs);
        await logRequest(absoluteLogFile, {
          term: combination.term,
          campus: combination.campus,
          subject,
          status: result.status,
          durationMs: duration,
          count: result.records.length
        });
        console.log(
          `[soc-probe] term=${combination.term} campus=${combination.campus} subject=${subject} status=${result.status} duration_ms=${duration} records=${result.records.length}`
        );
        stats.successes += 1;
      } catch (error) {
        await logRequest(absoluteLogFile, {
          term: combination.term,
          campus: combination.campus,
          subject,
          status: getStatusCode(error),
          durationMs: 0,
          count: 0
        });
        throw error;
      }

      if (config.requestIntervalMs > 0) {
        await sleep(config.requestIntervalMs);
      }
    }
  }

  const writePromises: Promise<void>[] = [];
  for (const bucket of buckets.values()) {
    const snapshot = {
      term: bucket.term,
      campus: bucket.campus,
      endpoint: config.endpoint,
      fetchedAt: new Date().toISOString(),
      subjects: Array.from(bucket.subjects),
      totalCourses: bucket.records.length,
      queryDefaults: config.queryDefaults,
      data: bucket.records
    };
    const fileName = `${bucket.term}-${bucket.campus}.json`;
    const fullPath = path.join(absoluteOutputDir, fileName);
    writePromises.push(
      fs.writeFile(fullPath, JSON.stringify(snapshot, null, 2), "utf-8").then(() => {
        console.log(
          `[soc-probe] wrote ${fileName} with ${bucket.records.length} course entries`
        );
      })
    );
  }

  await Promise.all(writePromises);
  console.log(
    `[soc-probe] completed successfully. requests=${stats.requests} succeeded=${stats.successes}`
  );
}

function getOrCreateBucket(
  buckets: Map<string, SnapshotBucket>,
  combination: SocCombination
): SnapshotBucket {
  const key = `${combination.term}-${combination.campus}`;
  const existing = buckets.get(key);
  if (existing) {
    return existing;
  }

  const bucket: SnapshotBucket = {
    term: combination.term,
    campus: combination.campus,
    subjects: new Set(),
    records: []
  };
  buckets.set(key, bucket);
  return bucket;
}

async function fetchSubject({
  client,
  defaults,
  combination,
  subject
}: {
  client: ReturnType<typeof axios.create>;
  defaults: Record<string, string>;
  combination: SocCombination;
  subject: string;
}): Promise<{ records: unknown[]; status: number; durationMs: number }> {
  const params = {
    ...defaults,
    term: combination.term,
    campus: combination.campus,
    subject
  };
  const start = performance.now();
  const response: AxiosResponse<unknown> = await client.get("", { params });
  const durationMs = performance.now() - start;
  const records = Array.isArray(response.data)
    ? response.data
    : [response.data];
  return { records, status: response.status, durationMs };
}

async function logRequest(logPath: string, entry: RequestLog) {
  const line = `${new Date().toISOString()} term=${entry.term} campus=${entry.campus} subject=${entry.subject} status=${entry.status} duration_ms=${entry.durationMs} records=${entry.count}\n`;
  await fs.appendFile(logPath, line, "utf-8");
}

function getStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response: unknown }).response === "object" &&
    (error as { response: { status?: number } }).response?.status
  ) {
    return (error as { response: { status?: number } }).response?.status ?? 0;
  }
  return 0;
}

function normalizeUrl(base: string, endpoint: string) {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const trimmedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;
  return `${trimmedBase}/${trimmedEndpoint}`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("[soc-probe] failed", error);
    process.exitCode = 1;
  });
}
