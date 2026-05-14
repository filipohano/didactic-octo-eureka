import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
console.log("SUPABASE_URL:", process.env.SUPABASE_URL)
import { createClient } from "@supabase/supabase-js"
import { parse } from "csv-parse/sync"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SHEET_URL = process.env.SHEET_CSV_URL!
const TMDB_API = process.env.TMDB_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

type SheetRow = {
  title: string
  type: "movie" | "tv"
  season?: number
  episode?: number
}

// --------------------
// FETCH SHEET
// --------------------
async function fetchSheet(): Promise<SheetRow[]> {
  const res = await fetch(SHEET_URL)
  const csv = await res.text()

  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
  })

  return records.map((r: any) => ({
    title: r.title?.trim(),
    type: r.type?.trim(),
    season: r.season ? Number(r.season) : undefined,
    episode: r.episode ? Number(r.episode) : undefined,
  }))
}

// --------------------
// TMDB ENRICH (reuse your API logic idea)
// --------------------
async function enrich(row: SheetRow) {
  const res = await fetch("http://localhost:3000/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(row),
  })

  if (!res.ok) return null
  return res.json()
}

// --------------------
// MAIN SYNC
// --------------------
export async function syncSheet() {
  const sheet = await fetchSheet()

  const { data: existing } = await supabase
    .from("watch_items")
    .select("*")

  const existingMap = new Map(
    (existing || []).map((item) => [item.title, item])
  )

  let orderIndex = 0

  for (const row of sheet) {
    orderIndex++

    const existingItem = existingMap.get(row.title)

    // ENRICH NEW OR UPDATED ITEM
    let enriched = existingItem

    if (!existingItem) {
      enriched = await enrich(row)
    }

    if (!enriched) continue

    // UPSERT INTO SUPABASE
    await supabase.from("watch_items").upsert({
      title: row.title,
      type: row.type,
      season: row.season ?? null,
      episode: row.episode ?? null,

      tmdb_id: enriched.tmdbId ?? null,
      runtime: enriched.runtime ?? null,
      description: enriched.description ?? null,
      poster: enriched.poster ?? null,

      watched: existingItem?.watched ?? false,
      watched_at: existingItem?.watched_at ?? null,

      order_index: orderIndex,
    })
  }

  // --------------------
  // REMOVE ITEMS NOT IN SHEET
  // --------------------
  const sheetTitles = new Set(sheet.map((r) => r.title))

  for (const item of existing || []) {
    if (!sheetTitles.has(item.title)) {
      await supabase
        .from("watch_items")
        .delete()
        .eq("title", item.title)
    }
  }

  console.log("Sync complete")
}

// Run directly
syncSheet()