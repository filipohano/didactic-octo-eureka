import { NextResponse } from "next/server"

const TMDB_KEY = process.env.TMDB_API_KEY
const TMDB_BASE = "https://api.themoviedb.org/3"
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

if (!TMDB_KEY) {
  console.error("Missing TMDB_API_KEY")
}

async function searchMovie(title: string) {
  const res = await fetch(
    `${TMDB_BASE}/search/movie?query=${encodeURIComponent(title)}&api_key=${TMDB_KEY}`
  )
  const data = await res.json()
  return data.results?.[0] || null
}

async function searchTV(title: string) {
  const res = await fetch(
    `${TMDB_BASE}/search/tv?query=${encodeURIComponent(title)}&api_key=${TMDB_KEY}`
  )
  const data = await res.json()
  return data.results?.[0] || null
}

async function getMovieDetails(id: number) {
  const res = await fetch(
    `${TMDB_BASE}/movie/${id}?api_key=${TMDB_KEY}`
  )
  return res.json()
}

async function getTVDetails(id: number) {
  const res = await fetch(
    `${TMDB_BASE}/tv/${id}?api_key=${TMDB_KEY}`
  )
  return res.json()
}

async function getEpisodeDetails(
  showId: number,
  season: number,
  episode: number
) {
  const res = await fetch(
    `${TMDB_BASE}/tv/${showId}/season/${season}/episode/${episode}?api_key=${TMDB_KEY}`
  )
  return res.json()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      title,
      type,
      season,
      episode,
    }: {
      title: string
      type: "movie" | "tv"
      season?: number
      episode?: number
    } = body

    if (!title || !type) {
      return NextResponse.json(
        { error: "Missing title or type" },
        { status: 400 }
      )
    }

    // -------------------------
    // MOVIE
    // -------------------------
    if (type === "movie") {
      const match = await searchMovie(title)
      if (!match) {
        return NextResponse.json({ error: "Movie not found" }, { status: 404 })
      }

      const details = await getMovieDetails(match.id)

      return NextResponse.json({
        title: match.title,
        type: "movie",
        runtime: details.runtime ?? null,
        description: details.overview ?? "",
        releaseDate: details.release_date ?? null,
        poster: details.poster_path
          ? `${IMAGE_BASE}${details.poster_path}`
          : null,
        tmdbId: match.id,
      })
    }

    // -------------------------
    // TV SHOW (SERIES LEVEL)
    // -------------------------
    if (type === "tv" && (!season || !episode)) {
      const match = await searchTV(title)
      if (!match) {
        return NextResponse.json({ error: "TV show not found" }, { status: 404 })
      }

      const details = await getTVDetails(match.id)

      return NextResponse.json({
        title: match.name,
        type: "tv",
        runtime: null,
        description: details.overview ?? "",
        releaseDate: details.first_air_date ?? null,
        poster: details.poster_path
          ? `${IMAGE_BASE}${details.poster_path}`
          : null,
        tmdbId: match.id,
      })
    }

    // -------------------------
    // TV EPISODE
    // -------------------------
    if (type === "tv" && season && episode) {
      const show = await searchTV(title)

      if (!show) {
        return NextResponse.json(
          { error: "TV show not found" },
          { status: 404 }
        )
      }

      const ep = await getEpisodeDetails(show.id, season, episode)

      return NextResponse.json({
        title: ep.name,
        type: "tv",
        runtime: ep.runtime ?? null,
        description: ep.overview ?? "",
        releaseDate: ep.air_date ?? null,
        poster: null,
        tmdbId: show.id,
        season,
        episode,
      })
    }

    return NextResponse.json(
      { error: "Invalid request format" },
      { status: 400 }
    )
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Server error",
        details: err?.message || String(err),
      },
      { status: 500 }
    )
  }
}