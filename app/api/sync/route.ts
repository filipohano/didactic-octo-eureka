import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { parse } from "csv-parse/sync"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SHEET_URL = process.env.SHEET_CSV_URL!
const TMDB_KEY = process.env.TMDB_API_KEY!
const TMDB_BASE = "https://api.themoviedb.org/3"

type SheetRow = {
  title: string
  type: "movie" | "tv"
  season?: string
  episode?: string
}

async function fetchSheet(): Promise<SheetRow[]> {
  const res = await fetch(SHEET_URL)
  const csv = await res.text()

 return parse(csv, {
  columns: true,
  skip_empty_lines: true,
}) as SheetRow[]
}

async function enrich(row: any) {
  const { title, type, season, episode } = row

  const endpoint =
    type === "movie"
      ? `${TMDB_BASE}/search/movie`
      : `${TMDB_BASE}/search/tv`

  const searchRes = await fetch(
    `${endpoint}?query=${encodeURIComponent(title)}&api_key=${TMDB_KEY}`
  ).then(r => r.json())

  const match = searchRes.results?.[0]
  if (!match) return null

  if (type === "movie") {
    const details = await fetch(
      `${TMDB_BASE}/movie/${match.id}?api_key=${TMDB_KEY}`
    ).then(r => r.json())

    return {
      tmdb_id: match.id,
      runtime: details.runtime ?? null,
      description: details.overview ?? "",
      poster: details.poster_path
        ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
        : null,
    }
  }

  if (type === "tv" && season && episode) {
    const ep = await fetch(
      `${TMDB_BASE}/tv/${match.id}/season/${season}/episode/${episode}?api_key=${TMDB_KEY}`
    ).then(r => r.json())

    return {
      tmdb_id: match.id,
      runtime: ep.runtime ?? null,
      description: ep.overview ?? "",
      poster: null,
    }
  }

  const details = await fetch(
    `${TMDB_BASE}/tv/${match.id}?api_key=${TMDB_KEY}`
  ).then(r => r.json())

  return {
    tmdb_id: match.id,
    runtime: null,
    description: details.overview ?? "",
    poster: details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : null,
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = url.searchParams.get("key")

  // simple protection
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sheet = await fetchSheet()

  const { data: existing } = await supabase
    .from("watch_items")
    .select("*")

  const map = new Map(existing?.map(i => [i.title, i]) || [])

  let order = 0

  for (const row of sheet) {
    order++

    const existingItem = map.get(row.title)
    const enriched = await enrich(row)

    if (!enriched) continue

    await supabase.from("watch_items").upsert({
      title: row.title,
      type: row.type,
      season: row.season ? Number(row.season) : null,
      episode: row.episode ? Number(row.episode) : null,

      ...enriched,

      watched: existingItem?.watched ?? false,
      watched_at: existingItem?.watched_at ?? null,
      order_index: order,
    })
  }

  return NextResponse.json({ ok: true })
}