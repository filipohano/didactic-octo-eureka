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
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;

  const nextWatched = !entry.watched;
  const nextDate = nextWatched ? new Date().toISOString() : null;

  // 1. Update local UI immediately (Snappy vibe)
  setEntries((prev) =>
    prev.map((e) => (e.id === id ? { ...e, watched: nextWatched, watchedAt: nextDate } : e))
  );

  // 2. Push to Supabase (Sync vibe)
  await supabase.from("progress").upsert({
    id: id,
    watched: nextWatched,
    watched_at: nextDate,
  });
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

  const merged = items.map((item: any) => {
    const saved = progress?.find((p: any) => p.id === item.id)

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
      watched: saved?.watched || false,
      watchedAt: saved?.watched_at || null,
      notes: saved?.notes || "",
    }
  })

  setEntries(merged)
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
    <div className="min-h-screen bg-black text-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,196,0,0.18),transparent_45%)]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8 md:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-10">
          <div>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight">
              STAR WARS
            </h1>
            <p className="text-zinc-400 text-lg mt-2">
              Chronological Marathon Tracker
            </p>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button
              onClick={exportProgress}
              className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-2xl flex items-center gap-2 hover:border-yellow-500 transition"
            >
              <Download size={18} /> Export
            </button>

            <button
            onClick={async () => {
            await syncFromSupabase()
            }}
            className="bg-green-500/10 border border-green-500/30 px-4 py-3 rounded-2xl flex items-center gap-2 hover:border-green-400 transition"
            >
            Save / Sync
            </button>

            <label className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-2xl flex items-center gap-2 hover:border-yellow-500 transition cursor-pointer">
              <Upload size={18} /> Import
              <input
                type="file"
                className="hidden"
                onChange={importProgress}
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="lg:col-span-3 rounded-3xl border border-yellow-500/20 bg-zinc-950/70 backdrop-blur-xl p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-zinc-400 mb-2">Overall Progress</p>
                <h2 className="text-5xl font-black text-yellow-400">
                  {progress}%
                </h2>
              </div>

              <div className="text-right">
                <p className="text-zinc-400">Runtime Watched</p>
                <p className="text-2xl font-bold">
                  {formatRuntime(watchedRuntime)}
                </p>
              </div>
            </div>

            <div className="w-full bg-zinc-900 rounded-full h-5 overflow-hidden mb-6">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1 }}
                className="h-full bg-gradient-to-r from-yellow-500 to-amber-300"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-zinc-900/70 rounded-2xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Clock3 size={16} /> Remaining
                </div>
                <p className="font-bold text-xl">
                  {formatRuntime(remaining)}
                </p>
              </div>

              <div className="bg-zinc-900/70 rounded-2xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Flame size={16} /> Streak
                </div>
                <p className="font-bold text-xl">{streak} days</p>
              </div>

              <div className="bg-zinc-900/70 rounded-2xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Calendar size={16} /> ETA
                </div>
                <p className="font-bold text-lg">
                  {estimatedDate
                    ? estimatedDate.toLocaleDateString()
                    : "Not enough data"}
                </p>
              </div>

              <div className="bg-zinc-900/70 rounded-2xl p-4 border border-zinc-800">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Trophy size={16} /> Completed
                </div>
                <p className="font-bold text-xl">
                  {watchedEntries.length}/{entries.length}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-3xl border border-yellow-500/20 bg-gradient-to-b from-yellow-500/10 to-zinc-950/80 p-6"
          >
            <div className="flex items-center gap-2 mb-4 text-yellow-400 font-bold">
              <Star size={18} /> UP NEXT
            </div>

            {nextUp && (
              <>
                <h3 className="text-2xl font-black mb-3">
                  {nextUp.title}
                </h3>

                {nextUp.episode_title && (
                  <p className="text-yellow-300 mb-2 text-sm">
                    {nextUp.episode_title}
                  </p>
                )}

                {nextUp.season && nextUp.episode && (
                  <p className="text-zinc-500 mb-2 text-sm">
                    Season {nextUp.season} • Episode {nextUp.episode}
                  </p>
                )}

                <p className="text-zinc-400 mb-4 text-sm leading-relaxed">
                  {nextUp.description}
                </p>

                <div className="flex gap-2 flex-wrap mb-6">
                  <span className="bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full text-sm">
                    {nextUp.type}
                  </span>

                  <span className="bg-zinc-800 px-3 py-1 rounded-full text-sm">
                    {formatRuntime(nextUp.runtime)}
                  </span>
                </div>

                <button
                  onClick={() => toggleWatched(nextUp.id)}
                  className="w-full bg-yellow-400 hover:bg-yellow-300 transition text-black font-black py-4 rounded-2xl"
                >
                  MARK AS WATCHED
                </button>
              </>
            )}
          </motion.div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6 backdrop-blur-xl">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
              <h2 className="text-2xl font-black">Full Timeline</h2>

              <div className="flex gap-3 flex-wrap">
                <div className="relative">
                  <Search
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                  />

                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    className="bg-zinc-900 border border-zinc-800 rounded-2xl pl-10 pr-4 py-3 outline-none focus:border-yellow-500"
                  />
                </div>

                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 outline-none focus:border-yellow-500"
                >
                  <option value="all">All</option>
                  <option value="watched">Watched</option>
                  <option value="unwatched">Unwatched</option>
                </select>
              </div>
            </div>

            <div className="space-y-4 max-h-[900px] overflow-y-auto pr-2">
              {filteredEntries.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  className={`rounded-2xl border p-5 transition ${
                    entry.watched
                      ? "bg-yellow-500/10 border-yellow-500/30"
                      : "bg-zinc-900/60 border-zinc-800"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <button
                        onClick={() => toggleWatched(entry.id)}
                        className="mt-1"
                      >
                        <CheckCircle2
                          className={`transition ${
                            entry.watched
                              ? "text-yellow-400"
                              : "text-zinc-700"
                          }`}
                          size={30}
                        />
                      </button>

                      <div>
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                          <h3 className="font-bold text-xl">
                            {entry.title}
                          </h3>

                          {entry.season && entry.episode && (
                            <span className="bg-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-300">
                              S{entry.season}E{entry.episode}
                            </span>
                          )}

                          <span className="bg-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-300">
                            {entry.type}
                          </span>

                          <span className="bg-zinc-800 px-3 py-1 rounded-full text-xs text-zinc-300">
                            {formatRuntime(entry.runtime)}
                          </span>
                        </div>

                        {entry.episode_title && (
                          <p className="text-yellow-300 mb-2 text-sm">
                            {entry.episode_title}
                          </p>
                        )}

                        <p className="text-zinc-400 mb-3">
                          {entry.description}
                        </p>

                        <div className="flex items-center gap-3 flex-wrap text-sm text-zinc-500">
                          {entry.watchedAt && (
                            <span>
                              Watched {new Date(entry.watchedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedNotes(entry)}
                        className="bg-zinc-800 hover:bg-zinc-700 transition px-4 py-2 rounded-xl text-sm"
                      >
                        Notes
                      </button>

                      {entry.watched && (
                        <button
                          onClick={() => toggleWatched(entry.id)}
                          className="bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition px-4 py-2 rounded-xl text-sm flex items-center gap-2"
                        >
                          <Undo2 size={14} /> Undo
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-6">
              <h2 className="text-2xl font-black mb-6">Recent Activity</h2>

              <div className="space-y-4">
                {watchedEntries
                  .slice()
                  .reverse()
                  .slice(0, 5)
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between border-b border-zinc-800 pb-4"
                    >
                      <div>
                        <p className="font-semibold">{entry.title}</p>
                        <p className="text-zinc-500 text-sm">
                          {entry.watchedAt
                            ? new Date(entry.watchedAt).toLocaleString()
                            : "Not watched"}
                        </p>
                      </div>

                      <ChevronRight className="text-zinc-600" />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {selectedNotes && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6 w-full max-w-xl">
              <h2 className="text-2xl font-black mb-4">
                Notes — {selectedNotes.title}
              </h2>

              <textarea
                value={selectedNotes.notes}
                onChange={(e) =>
                  updateNote(selectedNotes.id, e.target.value)
                }
                className="w-full h-40 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 outline-none focus:border-yellow-500"
                placeholder="Write anything about your watch session..."
              />

              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => setSelectedNotes(null)}
                  className="bg-zinc-800 px-5 py-3 rounded-2xl"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}