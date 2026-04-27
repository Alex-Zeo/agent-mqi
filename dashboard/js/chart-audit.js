/**
 * Validate a Chart.js v4 config. Returns an array of error strings
 * (empty == OK). The dev-mode wrapper installed at boot throws on any
 * non-empty array; production mode logs warn and continues.
 *
 * Rules:
 *   1. Every named axis in options.scales that is referenced by a dataset
 *      MUST have title.display === true and non-empty title.text.
 *   2. If data.datasets.length > 1, plugins.legend.display MUST NOT be false.
 */
export function auditChartConfig(config) {
  const errors = []
  const scales = config?.options?.scales || {}
  const datasets = config?.data?.datasets || []
  const usedX = new Set(datasets.map(d => d.xAxisID || 'x'))
  const usedY = new Set(datasets.map(d => d.yAxisID || 'y'))

  for (const id of Object.keys(scales)) {
    const ax = scales[id]
    if (!ax || typeof ax !== 'object') continue
    const referenced = usedX.has(id) || usedY.has(id) || id === 'x' || id === 'y'
    if (!referenced) continue
    const title = ax?.title
    if (!title || title.display !== true || !title.text || !String(title.text).trim()) {
      errors.push(`${id}-axis missing title.text (set scales.${id}.title = { display: true, text: '...' })`)
    }
  }

  if (datasets.length > 1) {
    const legendDisplay = config?.options?.plugins?.legend?.display
    if (legendDisplay === false) {
      errors.push(`${datasets.length} datasets present but plugins.legend.display = false - readers cannot identify series`)
    }
  }

  return errors
}

export function installChartAudit({ mode = 'dev' } = {}) {
  if (typeof window === 'undefined' || !window.Chart) return
  if (window.Chart.__audited) return
  const Original = window.Chart
  const Wrapped = function (ctx, config) {
    const canvasEl = ctx instanceof HTMLCanvasElement ? ctx : ctx?.canvas
    const errors = auditChartConfig(config)
    if (canvasEl && !canvasEl.getAttribute('aria-label')) {
      errors.push('canvas missing aria-label - set role="img" aria-label="<summary>" before new Chart()')
    }
    if (errors.length) {
      const hint = errors.map(e => `  - ${e}`).join('\n')
      const where = canvasEl?.id || '(canvas)'
      const msg = `chart-audit: "${where}" - ${errors.length} issue(s):\n${hint}`
      if (mode === 'dev') {
        if (canvasEl) {
          const g = canvasEl.getContext('2d')
          g.fillStyle = '#3a0000'
          g.fillRect(0, 0, canvasEl.width, canvasEl.height)
          g.fillStyle = '#ff6666'
          g.font = '12px monospace'
          g.fillText('UNLABELED CHART - see console', 10, 20)
          errors.forEach((e, i) => g.fillText('- ' + e, 10, 40 + i * 14))
        }
        throw new Error(msg)
      } else {
        console.warn(msg)
      }
    }
    return new Original(ctx, config)
  }
  Object.setPrototypeOf(Wrapped, Original)
  Object.assign(Wrapped, Original)
  window.Chart = Wrapped
  window.Chart.__audited = true
}

if (typeof window !== 'undefined') {
  const mode = location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'dev' : 'prod'
  installChartAudit({ mode })
}
