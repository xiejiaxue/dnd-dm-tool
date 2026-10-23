import { HttpError, isRecord, json } from "../http";
import { moduleMonsterCard, moduleToken, searchModules } from "../modules/registry";
import {
  consumeOnlineLookupBudget,
  getOnlineCompendiumEntry,
  onlineEntryReference,
  searchOnlineCompendium,
} from "../online-compendium";
import { parseOnlineSearchRequest } from "../online-compendium-data";
import type { ApiContext, Route } from "./router";

export const compendiumRoutes: Route<ApiContext>[] = [
  {
    methods: ["GET"],
    path: "/search",
    async handle({ env, url }) {
      return searchCompendium(env, url);
    },
  },
  {
    methods: ["GET"],
    path: "/search/online",
    async handle({ request, env, ctx, session, url }) {
      let onlineRequest;
      try {
        onlineRequest = parseOnlineSearchRequest(url);
      } catch (error) {
        throw new HttpError(
          400,
          "INVALID_INPUT",
          error instanceof Error ? error.message : "资料查询无效",
        );
      }
      if (!onlineRequest.query) return json([]);
      await consumeOnlineLookupBudget(env, request, session.userId);
      return searchOnlineCompendium(ctx, onlineRequest);
    },
  },
  {
    methods: ["GET"],
    path: "/entry/:type/:id",
    async handle({ request, env, ctx, session }, { type, id }) {
      const onlineReference = onlineEntryReference(type, id);
      if (onlineReference) {
        await consumeOnlineLookupBudget(env, request, session.userId);
        return getOnlineCompendiumEntry(ctx, onlineReference);
      }
      return getCompendiumEntry(env, type, id);
    },
  },
  {
    methods: ["GET"],
    path: "/token/:id",
    async handle({ env }, { id }) {
      return getCompendiumToken(env, id);
    },
  },
];

interface CompendiumIndexRow {
  type: string;
  id: string;
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  cr?: string;
  level?: number;
  lookupKey?: string;
}

async function searchCompendium(env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
  const requestedType = url.searchParams.get("type") ?? "all";
  if (!query) return json([]);
  const index = await env.REFERENCE_DATA.get("compendium/index.json");
  if (!index) return json(searchModules(query, requestedType).slice(0, 50));
  const source: unknown = await index.json();
  if (!Array.isArray(source)) return json(searchModules(query, requestedType).slice(0, 50));
  const entries = source.flatMap((item) =>
    asCompendiumIndexRow(item) ? [item] : [],
  );
  const matches = [...searchModules(query, requestedType), ...entries]
    .filter((entry) => {
      if (requestedType !== "all" && entry.type !== requestedType) return false;
      return `${entry.nameZh} ${entry.nameEn} ${entry.id} ${entry.source}`
        .toLocaleLowerCase()
        .includes(query);
    })
    .slice(0, 50);
  return json(matches);
}

async function getCompendiumEntry(
  env: Env,
  type: string,
  id: string,
): Promise<Response> {
  if (!isCompendiumType(type))
    throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  if (!id || id.length > 180)
    throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const builtin = type === "monster" ? moduleMonsterCard(id) : undefined;
  if (builtin) return json(builtin);
  const indexObject = await env.REFERENCE_DATA.get("compendium/index.json");
  if (!indexObject) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const index: unknown = await indexObject.json();
  const match = Array.isArray(index)
    ? index
        .map(asCompendiumIndexRow)
        .find(
          (entry): entry is CompendiumIndexRow =>
            entry !== null && entry.type === type && entry.id === id,
        )
    : undefined;
  if (!match) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");

  const safeBookPath = match.bookFile
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const book = await env.REFERENCE_DATA.get(`compendium/books/${safeBookPath}`);
  if (!book) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  const source: unknown = await book.json();
  const records = compendiumRecords(source, type);
  const entry = records.find((record) => {
    if (!isRecord(record)) return false;
    const name =
      typeof record.ENG_name === "string" ? record.ENG_name : record.name;
    const key = match.lookupKey
      ? `${typeof record.className === "string" ? record.className : ""}|${name ?? ""}|${typeof record.level === "number" ? record.level : ""}`
      : name;
    return (
      key === (match.lookupKey ?? match.nameEn) &&
      (record.source === match.source || record.classSource === match.source)
    );
  });
  if (!entry) throw new HttpError(404, "NOT_FOUND", "找不到资料条目");
  return json(entry, {
    headers: {
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function getCompendiumToken(env: Env, id: string): Promise<Response> {
  if (!id || id.length > 180)
    throw new HttpError(404, "NOT_FOUND", "找不到 Token");
  const builtin = moduleToken(id);
  if (builtin) return new Response(builtin, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  const token = await env.REFERENCE_DATA.get(
    `compendium/tokens/${encodeURIComponent(id)}.webp`,
  );
  if (token)
    return new Response(token.body, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  const label = escapeXml(id.split("__").at(-1)?.slice(0, 2) || "?");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${label}"><rect width="64" height="64" rx="32" fill="#3f3f46"/><text x="32" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fbbf24">${label}</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

function asCompendiumIndexRow(value: unknown): CompendiumIndexRow | null {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.id !== "string" ||
    typeof value.nameZh !== "string" ||
    typeof value.nameEn !== "string" ||
    typeof value.source !== "string" ||
    typeof value.bookFile !== "string"
  )
    return null;
  return {
    type: value.type,
    id: value.id,
    nameZh: value.nameZh,
    nameEn: value.nameEn,
    source: value.source,
    bookFile: value.bookFile,
    ...(typeof value.cr === "string" ? { cr: value.cr } : {}),
    ...(typeof value.level === "number" ? { level: value.level } : {}),
    ...(typeof value.lookupKey === "string"
      ? { lookupKey: value.lookupKey }
      : {}),
  };
}

function isCompendiumType(value: string): boolean {
  return [
    "monster",
    "spell",
    "item",
    "feat",
    "condition",
    "race",
    "subrace",
    "background",
    "class",
    "subclass",
    "classFeature",
    "subclassFeature",
    "optionalFeature",
    "language",
    "vehicle",
    "action",
    "reward",
  ].includes(value);
}

function compendiumRecords(value: unknown, type: string): unknown[] {
  if (!isRecord(value)) return [];
  const keyByType: Record<string, string> = {
    monster: "monster",
    spell: "spell",
    item: "item",
    feat: "feat",
    condition: "condition",
    race: "race",
    subrace: "subrace",
    background: "background",
    class: "class",
    subclass: "subclass",
    classFeature: "classFeature",
    subclassFeature: "subclassFeature",
    optionalFeature: "optionalfeature",
    language: "language",
    vehicle: "vehicle",
    action: "action",
    reward: "reward",
  };
  const candidate = value[keyByType[type] ?? type];
  return Array.isArray(candidate) ? candidate : [];
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}
