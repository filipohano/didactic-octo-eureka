"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"

export default function SyncButton() {
  const [loading, setLoading] = useState(false)

  async function runSync() {
    setLoading(true)

    try {
      const res = await fetch("/api/sync?key=YOUR_CRON_SECRET")

      if (!res.ok) throw new Error("Sync failed")

      alert("Sync complete")
      window.location.reload()
    } catch (err) {
      alert("Sync failed")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={runSync}
      disabled={loading}
      className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-2xl flex items-center gap-2 hover:border-yellow-500 transition disabled:opacity-50"
    >
      <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
      {loading ? "Syncing..." : "Sync"}
    </button>
  )
}