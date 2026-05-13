const express = require('express')
const router = express.Router()

/**
 * Proxy seguro a Gemini API.
 *
 * La API key vive solo en GEMINI_API_KEY del backend (variable de entorno).
 * El frontend nunca la ve. Cualquier costo/abuso queda controlado en el servidor.
 *
 * POST /api/ai/gemini-generate
 * body: {
 *   prompt: string,                                       // requerido
 *   images?: Array<{ mimeType: string, data: string }>,   // base64 sin prefijo
 *   model?: string,                                       // default 'gemini-2.5-flash'
 *   temperature?: number,                                 // default 0.7
 *   maxOutputTokens?: number                              // default 4096
 * }
 *
 * response: {
 *   text: string,   // contenido generado
 *   model: string,  // modelo usado (puede haber fallback)
 * }
 */
router.post('/gemini-generate', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en el servidor' })
  }

  const {
    prompt,
    images,
    model = 'gemini-2.5-flash',
    temperature = 0.7,
    maxOutputTokens = 4096
  } = req.body || {}

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt es requerido (string)' })
  }
  if (prompt.length > 30000) {
    return res.status(413).json({ error: 'prompt demasiado largo (max 30k caracteres)' })
  }

  const parts = [{ text: prompt }]
  if (Array.isArray(images)) {
    images.slice(0, 6).forEach((img) => {
      if (img && img.mimeType && img.data) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.data } })
      }
    })
  }

  // Lista de modelos a intentar en orden (fallback automático si uno falla)
  const fallbackModels = [model, 'gemini-2.0-flash', 'gemini-1.5-flash']
    .filter((m, idx, arr) => arr.indexOf(m) === idx) // dedupe

  let lastError = null
  for (const tryModel of fallbackModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent?key=${apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature, maxOutputTokens }
        })
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        lastError = `(${response.status}) ${errText.slice(0, 200)}`
        // Si es 4xx (request inválida) no intentar fallback con otro modelo
        if (response.status >= 400 && response.status < 500 && response.status !== 404) {
          return res.status(response.status).json({ error: `Gemini rechazó la solicitud: ${lastError}` })
        }
        continue
      }

      const data = await response.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        lastError = 'Gemini devolvió respuesta vacía'
        continue
      }

      return res.json({ text, model: tryModel })
    } catch (err) {
      lastError = err.message
      continue
    }
  }

  return res.status(502).json({ error: `Gemini falló en todos los modelos: ${lastError}` })
})

module.exports = router
