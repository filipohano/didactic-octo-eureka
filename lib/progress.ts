export function calculateProgress(items: any[]) {
  const watchedItems = items.filter(i => i.watched)

  const totalRuntime = items.reduce((sum, item) => {
    return sum + (item.runtime ?? 0)
  }, 0)

  const watchedRuntime = watchedItems.reduce((sum, item) => {
    return sum + (item.runtime ?? 0)
  }, 0)

  const remainingRuntime = totalRuntime - watchedRuntime

  const progressPercent =
    totalRuntime === 0 ? 0 : (watchedRuntime / totalRuntime) * 100

  return {
    totalRuntime,
    watchedRuntime,
    remainingRuntime,
    progressPercent: Math.round(progressPercent * 10) / 10,
  }
}

export function estimateFinishDate(items: any[]) {
  const watched = items.filter(i => i.watched && i.watched_at)

  if (watched.length < 2) return null

  const times = watched.map(i => new Date(i.watched_at).getTime())

  const span = Math.max(...times) - Math.min(...times)
  const days = span / (1000 * 60 * 60 * 24)

  const avgPerDay =
    watched.reduce((sum, i) => sum + (i.runtime ?? 0), 0) / Math.max(days, 1)

  const remainingRuntime = items
    .filter(i => !i.watched)
    .reduce((sum, i) => sum + (i.runtime ?? 0), 0)

  const daysLeft = remainingRuntime / Math.max(avgPerDay, 1)

  const finish = new Date()
  finish.setDate(finish.getDate() + daysLeft)

  return finish
}