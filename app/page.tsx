"use client"

import { calculateProgress, estimateFinishDate } from "@/lib/progress"
import SyncButton from "./components/SyncButton"
import { supabase } from "@/lib/supabase"
import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  CheckCircle2,
  Clock3,
  Flame,
  Star,
  Calendar,
  Trophy,
  ChevronRight,
  Search,
  Undo2,
  Download,
  Upload,
} from "lucide-react"
import { useRef } from "react"

type Entry = {
  id: number
  title: string
  type: string

  season?: number | null
  episode?: number | null

  runtime?: number | null

  description?: string | null
  episode_title?: string | null
  poster?: string | null

  watched: boolean
  watchedAt: string | null
  notes: string
}

function formatRuntime(minutes?: number | null) {
  if (!minutes) return "Unknown runtime"

  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function getStreak(entries: Entry[]) {
  const days = [...new Set(
    entries
      .filter(e => e.watchedAt)
      .map(e => new Date(e.watchedAt!).toISOString().split("T")[0])
  )].sort().reverse()

  if (!days.length) return 0

  let streak = 1

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1])
    const curr = new Date(days[i])

    const diff =
      (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24)

    if (diff === 1) streak++
    else break
  }

  return streak
}

export default function StarWarsTracker() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState("all")
  const [selectedNotes, setSelectedNotes] = useState<Entry | null>(null)
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [progressData, setProgressData] = useState<ReturnType<
    typeof calculateProgress
  > | null>(null)

  const [eta, setEta] = useState<Date | null>(null)

useEffect(() => {
  async function load() {
    const { data: items } = await supabase
      .from("watch_items")
      .select("*")
      .order("order_index");

    const { data: progress } = await supabase
      .from("progress")
      .select("*");

    if (!items) return;

    const merged: Entry[] = items.map((item: any) => {
      const saved = progress?.find((p: any) => p.id === item.id);
      return {
        ...item, // Spread existing item properties
        watched: saved?.watched || false,
        watchedAt: saved?.watched_at || null,
        notes: saved?.notes || "",
      };
    });

    setEntries(merged);
    setProgressData(calculateProgress(merged));
    setEta(estimateFinishDate(merged));
  }

  load();

  // Listen for changes made on ANY device
  const channel = supabase
    .channel('schema-db-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'progress' },
      (payload) => {
        // If someone else (or your other device) updates a row
        if (payload.new && 'id' in payload.new) {
          const newData = payload.new as { 
            id: number; 
            watched: boolean; 
            watched_at: string | null; 
            notes: string 
          };

          setEntries((current) =>
            current.map((entry) =>
              entry.id === newData.id
                ? {
                    ...entry,
                    watched: newData.watched,
                    watchedAt: newData.watched_at,
                    notes: newData.notes,
                  }
                : entry
            )
          );
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, []);

  const totalRuntime = useMemo(
    () =>
      entries.reduce(
        (acc: number, item: Entry) => acc + (item.runtime || 0),
        0
      ),
    [entries]
  )

  const watchedRuntime = useMemo(
    () =>
      entries
        .filter((e: Entry) => e.watched)
        .reduce(
          (acc: number, item: Entry) => acc + (item.runtime || 0),
          0
        ),
    [entries]
  )

  const progress = totalRuntime
    ? Math.round((watchedRuntime / totalRuntime) * 100)
    : 0

  const nextUp = entries.find((e: Entry) => !e.watched)

  const watchedEntries = entries.filter((e: Entry) => e.watched)

  const avgMinutesPerDay = watchedEntries.length
    ? watchedRuntime / watchedEntries.length
    : 0

  const remaining = totalRuntime - watchedRuntime

  const estimatedDays = avgMinutesPerDay
    ? Math.ceil(remaining / avgMinutesPerDay)
    : null

  const estimatedDate = estimatedDays
    ? new Date(Date.now() + estimatedDays * 86400000)
    : null

  const streak = getStreak(entries)

async function toggleWatched(id: number) {
  const current = entries.find((e) => e.id === id)
  if (!current) return

  const watched = !current.watched
  const watchedAt = watched ? new Date().toISOString() : null

  await supabase.from("progress").upsert({
    id,
    watched,
    watched_at: watchedAt,
    notes: current.notes || "",
  })

  setEntries((prev) =>
    prev.map((e) =>
      e.id === id ? { ...e, watched, watchedAt } : e
    )
  )
}

async function syncFromSupabase() {
  const { data: items } = await supabase
    .from("watch_items")
    .select("*")
    .order("order_index")

  const { data: progress } = await supabase
    .from("progress")
    .select("*")

  if (!items) return

  // 🔥 build lookup map instead of .find()
  const progressMap = new Map(
    (progress || []).map((p: any) => [
      String(p.id),
      p,
    ])
  )

  const merged = items.map((item: any) => {
    const saved = progressMap.get(String(item.id))

    return {
      id: item.id,
      title: item.title,
      type: item.type,
      season: item.season,
      episode: item.episode,
      runtime: item.runtime,
      description: item.description,
      episode_title: item.episode_title,
      poster: item.poster,
      watched: saved?.watched ?? false,
      watchedAt: saved?.watched_at ?? null,
      notes: saved?.notes ?? "",
    }
  })

  setEntries(merged)
  console.log("PROGRESS RAW:", progress)
}

function updateNote(id: number, note: string) {
  // Update UI immediately for that "snappy" feeling
  setEntries((prev) =>
    prev.map((entry) =>
      entry.id === id ? { ...entry, notes: note } : entry
    )
  );

  if (saveTimeout.current) clearTimeout(saveTimeout.current);

  saveTimeout.current = setTimeout(async () => {
    // We just update the specific record in the DB
    // We don't need to check the local 'entries' state here anymore
    await supabase.from("progress").upsert({
      id: id,
      notes: note,
    });
  }, 1000); 
}

  function exportProgress() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    })

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = "starwars-progress.json"
    a.click()
  }

  function importProgress(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]

    if (!file) return

    const reader = new FileReader()

    reader.onload = (event: ProgressEvent<FileReader>) => {
      const result = event.target?.result

      if (typeof result === "string") {
        setEntries(JSON.parse(result))
      }
    }

    reader.readAsText(file)
  }

  const filteredEntries = entries.filter((entry: Entry) => {
    const matchesSearch = entry.title
      .toLowerCase()
      .includes(search.toLowerCase())

    if (filter === "watched") {
      return entry.watched && matchesSearch
    }

    if (filter === "unwatched") {
      return !entry.watched && matchesSearch
    }

    return matchesSearch
  })

return (
  <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white overflow-hidden relative">
    
    {/* Ambient glow background */}
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,215,0,0.15),transparent_55%)]" />
    <div className="absolute inset-0 backdrop-blur-3xl opacity-40" />

    <div className="relative z-10 max-w-7xl mx-auto px-4 py-10 md:px-8">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">

        <div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tight bg-gradient-to-r from-yellow-300 via-yellow-500 to-amber-300 bg-clip-text text-transparent">
            STAR WARS
          </h1>
          <p className="text-zinc-400 text-lg mt-2 tracking-wide">
            Chronological Marathon Tracker
          </p>
        </div>

        {/* ACTION BAR */}
        <div className="flex gap-3 flex-wrap">

          <button
            onClick={exportProgress}
            className="group relative px-5 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl hover:border-yellow-400/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.98]"
          >
            <span className="absolute inset-0 rounded-2xl bg-gradient-to-r from-yellow-500/0 via-yellow-500/10 to-yellow-500/0 opacity-0 group-hover:opacity-100 transition" />
            <span className="relative flex items-center gap-2">
              <Download size={18} /> Export
            </span>
          </button>

          <button
            onClick={async () => await syncFromSupabase()}
            className="group relative px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-400/20 backdrop-blur-xl hover:border-emerald-300/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.98]"
          >
            <span className="absolute inset-0 rounded-2xl bg-emerald-400/10 opacity-0 group-hover:opacity-100 transition" />
            <span className="relative flex items-center gap-2 text-emerald-200">
              Save / Sync
            </span>
          </button>

          <label className="group relative px-5 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl hover:border-yellow-400/40 transition-all duration-300 hover:scale-[1.03] cursor-pointer">
            <span className="relative flex items-center gap-2">
              <Upload size={18} /> Import
            </span>
            <input type="file" className="hidden" onChange={importProgress} />
          </label>

        </div>
      </div>

      {/* TOP GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-10">

        {/* PROGRESS CARD */}
        <div className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl p-8 shadow-[0_0_80px_-20px_rgba(255,215,0,0.25)]">

          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-zinc-400">Overall Progress</p>
              <h2 className="text-6xl font-black text-yellow-400">{progress}%</h2>
            </div>

            <div className="text-right">
              <p className="text-zinc-400">Watched Runtime</p>
              <p className="text-2xl font-bold">{formatRuntime(watchedRuntime)}</p>
            </div>
          </div>

          <div className="h-4 w-full rounded-full bg-white/10 overflow-hidden mb-8">
            <div
              className="h-full bg-gradient-to-r from-yellow-500 via-amber-400 to-yellow-300 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* STATS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            <div className="glassCard">
              <Clock3 size={16} className="text-zinc-400" />
              <p className="text-sm text-zinc-400">Remaining</p>
              <p className="text-lg font-bold">{formatRuntime(remaining)}</p>
            </div>

            <div className="glassCard">
              <Flame size={16} className="text-orange-400" />
              <p className="text-sm text-zinc-400">Streak</p>
              <p className="text-lg font-bold">{streak} days</p>
            </div>

            <div className="glassCard">
              <Calendar size={16} className="text-blue-300" />
              <p className="text-sm text-zinc-400">ETA</p>
              <p className="text-lg font-bold">
                {estimatedDate ? estimatedDate.toLocaleDateString() : "—"}
              </p>
            </div>

            <div className="glassCard">
              <Trophy size={16} className="text-yellow-300" />
              <p className="text-sm text-zinc-400">Completed</p>
              <p className="text-lg font-bold">
                {watchedEntries.length}/{entries.length}
              </p>
            </div>

          </div>
        </div>

        {/* NEXT UP */}
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-yellow-500/10 to-white/5 backdrop-blur-2xl p-6">

          <div className="flex items-center gap-2 text-yellow-300 font-bold mb-4">
            <Star size={18} /> UP NEXT
          </div>

          {nextUp && (
            <>
              <h3 className="text-xl font-black mb-2">{nextUp.title}</h3>

              {/* KEEP EPISODE DETAILS (IMPORTANT) */}
              {(nextUp.season || nextUp.episode) && (
                <p className="text-zinc-400 text-sm mb-2">
                  S{nextUp.season ?? "?"}E{nextUp.episode ?? "?"}
                </p>
              )}

              {nextUp.episode_title && (
                <p className="text-yellow-200 text-sm mb-2">
                  {nextUp.episode_title}
                </p>
              )}

              {/* KEEP DESCRIPTION (IMPORTANT — YOU ASKED FOR THIS) */}
              <p className="text-zinc-400 text-sm leading-relaxed mb-4">
                {nextUp.description}
              </p>

              <button
                onClick={() => toggleWatched(nextUp.id)}
                className="w-full py-3 rounded-2xl bg-yellow-400 text-black font-black hover:bg-yellow-300 transition active:scale-95"
              >
                MARK AS WATCHED
              </button>
            </>
          )}
        </div>
      </div>

      {/* TIMELINE */}
      <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl p-6">

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black">Timeline</h2>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="bg-black/40 border border-white/10 rounded-xl px-4 py-2 outline-none focus:border-yellow-400"
          />
        </div>

        <div className="space-y-4">

          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-2xl p-5 border backdrop-blur-xl transition hover:scale-[1.01] ${
                entry.watched
                  ? "bg-yellow-500/10 border-yellow-400/20"
                  : "bg-white/5 border-white/10"
              }`}
            >

              <div className="flex justify-between gap-4">

                <div className="flex gap-4">

                  <button onClick={() => toggleWatched(entry.id)}>
                    <CheckCircle2
                      className={entry.watched ? "text-yellow-400" : "text-zinc-600"}
                    />
                  </button>

                  <div>

                    <h3 className="font-bold text-lg">{entry.title}</h3>

                    {/* KEEP EPISODE INFO */}
                    {(entry.season || entry.episode) && (
                      <p className="text-zinc-500 text-sm">
                        S{entry.season ?? "?"}E{entry.episode ?? "?"}
                      </p>
                    )}

                    <p className="text-zinc-400 text-sm mt-2">
                      {entry.description}
                    </p>

                    {entry.watchedAt && (
                      <p className="text-xs text-zinc-500 mt-2">
                        Watched {new Date(entry.watchedAt).toLocaleString()}
                      </p>
                    )}

                  </div>
                </div>

                {/* KEEP UNDO BUTTON */}
                {entry.watched && (
                  <button
                    onClick={() => toggleWatched(entry.id)}
                    className="text-xs px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20"
                  >
                    Undo
                  </button>
                )}

              </div>
            </div>
          ))}

        </div>
      </div>
    </div>

    {/* small reusable style */}
    <style jsx>{`
      .glassCard {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        padding: 14px;
        backdrop-filter: blur(20px);
        display: flex;
        flex-direction: column;
        gap: 4px;
        transition: 0.2s;
      }

      .glassCard:hover {
        transform: translateY(-2px);
        border-color: rgba(255,215,0,0.3);
      }
    `}</style>
  </div>
)}