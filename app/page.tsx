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
  <div className="min-h-screen text-white relative overflow-hidden bg-[#050505]">

    {/* ambient background */}
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,215,0,0.15),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(0,180,255,0.08),transparent_60%)]" />
      <div className="absolute inset-0 backdrop-blur-[120px]" />
    </div>

    <div className="relative z-10 max-w-7xl mx-auto px-6 py-10">

      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">

        <div>
          <h1 className="text-6xl md:text-7xl font-black tracking-tight bg-gradient-to-r from-yellow-200 via-yellow-400 to-yellow-600 bg-clip-text text-transparent">
            STAR WARS
          </h1>
          <p className="text-zinc-400 mt-2 tracking-wide">
            Chronological Marathon Tracker
          </p>
        </div>

        {/* ACTION BAR */}
        <div className="flex gap-3 flex-wrap">

          {/* EXPORT */}
          <button
            onClick={exportProgress}
            className="group relative px-5 py-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden transition active:scale-[0.98]"
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-r from-yellow-500/20 to-orange-500/10" />
            <span className="relative flex items-center gap-2">
              <Download size={18} /> Export
            </span>
          </button>

          {/* SYNC */}
          <button
            onClick={async () => await syncFromSupabase()}
            className="group relative px-5 py-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 backdrop-blur-xl overflow-hidden transition active:scale-[0.98]"
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-emerald-400/10" />
            <span className="relative flex items-center gap-2 text-emerald-300">
              Save / Sync
            </span>
          </button>

          {/* IMPORT */}
          <label className="group relative px-5 py-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl cursor-pointer overflow-hidden transition active:scale-[0.98]">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-white/10" />
            <span className="relative flex items-center gap-2">
              <Upload size={18} /> Import
            </span>
            <input type="file" className="hidden" onChange={importProgress} />
          </label>

        </div>
      </div>

      {/* TOP GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-10">

        {/* MAIN PROGRESS */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-3 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl p-8 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 via-transparent to-blue-500/10 opacity-60" />

          <div className="relative flex justify-between items-start mb-8">
            <div>
              <p className="text-zinc-400">Overall Progress</p>
              <h2 className="text-5xl font-black text-yellow-300">{progress}%</h2>
            </div>

            <div className="text-right">
              <p className="text-zinc-400">Watched</p>
              <p className="text-xl font-semibold">{formatRuntime(watchedRuntime)}</p>
            </div>
          </div>

          {/* BAR */}
          <div className="h-4 bg-white/5 rounded-full overflow-hidden mb-8">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 1 }}
              className="h-full bg-gradient-to-r from-yellow-400 via-orange-400 to-amber-200"
            />
          </div>

          {/* STATS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

            {[
              { icon: Clock3, label: "Remaining", value: formatRuntime(remaining) },
              { icon: Flame, label: "Streak", value: `${streak} days` },
              { icon: Calendar, label: "ETA", value: estimatedDate ? estimatedDate.toLocaleDateString() : "—" },
              { icon: Trophy, label: "Done", value: `${watchedEntries.length}/${entries.length}` },
            ].map((s, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl hover:bg-white/10 transition"
              >
                <div className="flex items-center gap-2 text-zinc-400 text-sm mb-2">
                  <s.icon size={16} /> {s.label}
                </div>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            ))}

          </div>
        </motion.div>

        {/* NEXT UP */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl p-6 relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-yellow-500/10 to-transparent" />

          <div className="relative">
            <div className="text-yellow-300 font-bold mb-4 flex items-center gap-2">
              <Star size={16} /> Next Up
            </div>

            {nextUp && (
              <>
                <h3 className="text-xl font-black mb-2">{nextUp.title}</h3>
                <p className="text-zinc-400 text-sm mb-4 line-clamp-3">
                  {nextUp.description}
                </p>

                <button
                  onClick={() => toggleWatched(nextUp.id)}
                  className="w-full px-4 py-3 rounded-2xl bg-gradient-to-r from-yellow-400 to-amber-300 text-black font-bold hover:scale-[1.02] active:scale-[0.98] transition"
                >
                  Mark Watched
                </button>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* LIST */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        <div className="xl:col-span-2 space-y-4">

          <div className="flex gap-3 mb-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the saga..."
              className="flex-1 px-4 py-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl outline-none focus:border-yellow-400"
            />

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10"
            >
              <option value="all">All</option>
              <option value="watched">Watched</option>
              <option value="unwatched">Unwatched</option>
            </select>
          </div>

          {filteredEntries.map((entry) => (
            <motion.div
              key={entry.id}
              layout
              className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 hover:bg-white/10 transition"
            >
              <div className="flex justify-between items-start gap-4">

                <div className="flex gap-4">

                  <button onClick={() => toggleWatched(entry.id)}>
                    <CheckCircle2
                      className={entry.watched ? "text-yellow-400" : "text-zinc-600"}
                      size={28}
                    />
                  </button>

                  <div>
                    <h3 className="font-bold text-lg">{entry.title}</h3>
                    <p className="text-zinc-400 text-sm">{entry.description}</p>

                    {entry.watchedAt && (
                      <p className="text-xs text-zinc-500 mt-2">
                        Watched {new Date(entry.watchedAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                </div>

                <button
                  onClick={() => setSelectedNotes(entry)}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition text-sm"
                >
                  Notes
                </button>

              </div>
            </motion.div>
          ))}

        </div>

        {/* ACTIVITY */}
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
          <h2 className="font-black text-xl mb-4">Recent Activity</h2>

          <div className="space-y-4">
            {watchedEntries.slice().reverse().slice(0, 5).map((e) => (
              <div key={e.id} className="border-b border-white/5 pb-3">
                <p className="font-semibold">{e.title}</p>
                <p className="text-xs text-zinc-500">
                  {e.watchedAt && new Date(e.watchedAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* MODAL */}
      {selectedNotes && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xl flex items-center justify-center p-4 z-50">
          <div className="w-full max-w-xl rounded-3xl bg-black/70 border border-white/10 p-6">
            <h2 className="text-xl font-black mb-4">
              Notes — {selectedNotes.title}
            </h2>

            <textarea
              value={selectedNotes.notes}
              onChange={(e) => updateNote(selectedNotes.id, e.target.value)}
              className="w-full h-40 rounded-2xl bg-white/5 border border-white/10 p-4 outline-none"
            />

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setSelectedNotes(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  </div>
)}