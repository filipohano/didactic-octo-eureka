import { NextResponse } from "next/server"

const TMDB_KEY = process.env.TMDB_API_KEY
const TMDB_BASE = "https://api.themoviedb.org/3"
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

if (!TMDB_KEY) {
  console.error("Missing TMDB_API_KEY in environment variables")
}

// 1. SEARCH (returns basic match + ID)
async function searchTitle(title: string) {
  const res = await fetch(
    `${TMDB_BASE}/search/multi?query=${encodeURIComponent(title)}&api_key=${TMDB_KEY}`
  )

  if (!res.ok) throw new Error("TMDB search failed")

  const data = await res.json()
  return data.results?.[0] || null
}

// 2. FETCH FULL DETAILS (runtime lives here)
async function fetchDetails(item: any) {
  if (!item?.id || !item?.media_type) return null

  if (item.media_type === "movie") {
    const res = await fetch(
      `${TMDB_BASE}/movie/${item.id}?api_key=${TMDB_KEY}`
    )
    if (!res.ok) return null
    return res.json()
  }

  if (item.media_type === "tv") {
    const res = await fetch(
      `${TMDB_BASE}/tv/${item.id}?api_key=${TMDB_KEY}`
    )
    if (!res.ok) return null
    return res.json()
  }

  return null
}

export async function POST(req: Request) {
  try {
    const { title } = await req.json()

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Invalid or missing title" },
        { status: 400 }
      )
    }

    // STEP 1: search
    const match = await searchTitle(title)

    if (!match) {
      return NextResponse.json(
        { error: "No TMDB match found" },
        { status: 404 }
      )
    }

    // STEP 2: fetch details
    const details = await fetchDetails(match)

    const isMovie = match.media_type === "movie"

    // STEP 3: normalize runtime
    let runtime: number | null = null

    if (isMovie) {
      runtime = details?.runtime ?? null
    } else {
      // TV shows: episode_run_time is array
      runtime = details?.episode_run_time?.[0] ?? null
    }

    // STEP 4: return clean object
    const enriched = {
      title: match.title || match.name || title,
      type: match.media_type || "unknown",
      runtime,
      description: details?.overview || match.overview || "",
      releaseDate: details?.release_date || details?.first_air_date || null,
      poster: details?.poster_path
        ? `${IMAGE_BASE}${details.poster_path}`
        : null,
      tmdbId: match.id,
    }

    return NextResponse.json(enriched)
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Enrichment failed",
        details: err?.message || String(err),
      },
      { status: 500 }
    )
  }
}