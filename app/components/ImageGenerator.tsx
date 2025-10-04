"use client"

import React from 'react'

type ProcessingState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'processing' }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

const MAX_SIDE = 512

export default function ImageGenerator() {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [processingState, setProcessingState] = React.useState<ProcessingState>({ phase: 'idle' })
  const [originalPreviewUrl, setOriginalPreviewUrl] = React.useState<string | null>(null)
  const [finalPreviewUrl, setFinalPreviewUrl] = React.useState<string | null>(null)
  const [prompt, setPrompt] = React.useState<string>(
    '1. Describing the Overall Design. The image is a prime example of pixel art, a digital art form where images are created at the pixel level. The overall design evokes a sense of nostalgia, reminiscent of classic 8-bit and 16-bit video games. Here are the key characteristics of its design: Pixelated Aesthetic: Every element in the image is made of visible square pixels. There are no smooth curves or gradients; instead, edges are created by the careful placement of individual pixels, resulting in a blocky or jagged appearance. Bold Outlines: The character and the coin are defined by a dark, one-pixel-thick outline. This technique helps the subject stand out clearly from the background and gives the forms a crisp, defined look, which is very common in this art style. Limited Color Palette: The drawing uses a small selection of vibrant, saturated colors. This is a hallmark of early video game graphics, which were limited by hardware constraints. The colors are used in solid blocks, contributing to the clean and readable design. Simplistic Shading: Shading and highlights are created using a few different shades of the base colors rather than smooth gradients. For example, the blue overalls have a darker blue shade to indicate shadow, and the coin has a lighter yellow to show a highlight. This technique adds depth and form without sacrificing the pixelated look. Low Resolution: The entire piece is created on a small digital canvas, which is why the individual pixels are so prominent. The artist has intentionally worked in a low resolution to achieve this specific retro style.'
  )

  React.useEffect(() => {
    return () => {
      if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl)
      if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl)
    }
  }, [originalPreviewUrl, finalPreviewUrl])

  const resetOutputs = React.useCallback(() => {
    if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl)
    setFinalPreviewUrl(null)
  }, [finalPreviewUrl])

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    resetOutputs()
    setSelectedFile(file)
    if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl)
    const originalUrl = URL.createObjectURL(file)
    setOriginalPreviewUrl(originalUrl)
  }

  const onGenerate = async () => {
    try {
      if (!selectedFile) return
      setProcessingState({ phase: 'uploading' })
      const downscaled = await downscaleToPng(selectedFile, MAX_SIDE)
      setProcessingState({ phase: 'processing' })

      const fd = new FormData()
      fd.append('image', new File([downscaled], 'input.png', { type: 'image/png' }))
      fd.append('prompt', prompt)

      const res = await fetch('/api/image', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const info = await safeJson(res)
        throw new Error(info?.error || `Request failed (${res.status})`)
      }
      const blob = await res.blob()
      if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl)
      const outUrl = URL.createObjectURL(blob)
      setFinalPreviewUrl(outUrl)
      setProcessingState({ phase: 'done' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      setProcessingState({ phase: 'error', message })
    }
  }

  const isBusy = processingState.phase === 'uploading' || processingState.phase === 'processing'

  return (
    <section className="my-8">
      <h2 className="text-xl font-medium tracking-tight mb-4">Turn Everything into Smol1</h2>
      <div className="flex flex-col gap-4">
        <input type="file" accept="image/*" onChange={handleFileChange} disabled={isBusy} />

        <label className="text-sm text-neutral-600 dark:text-neutral-300">Prompt</label>
        <textarea
          className="border border-neutral-200 dark:border-neutral-800 rounded-md p-2 text-sm min-h-[80px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={isBusy}
        />

        <button
          onClick={onGenerate}
          disabled={!selectedFile || isBusy}
          className="px-3 py-2 rounded-md border border-neutral-200 dark:border-neutral-800 text-sm disabled:opacity-50"
        >
          {isBusy ? (processingState.phase === 'uploading' ? 'Uploading…' : 'Processing…') : 'Generate with AI'}
        </button>

        {processingState.phase === 'error' && (
          <p className="text-red-600 dark:text-red-400 text-sm">{processingState.message}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm mb-2 text-neutral-600 dark:text-neutral-300">Original</p>
            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md p-2 min-h-[200px] flex items-center justify-center">
              {originalPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={originalPreviewUrl} alt="Original" className="max-h-80 rounded" />
              ) : (
                <span className="text-neutral-400">No image selected</span>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm mb-2 text-neutral-600 dark:text-neutral-300">Result (PNG)</p>
            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md p-2 min-h-[200px] flex flex-col items-center justify-center gap-3">
              {finalPreviewUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={finalPreviewUrl} alt="Processed" className="max-h-80 rounded" />
                  <a href={finalPreviewUrl} download="image-processed.png" className="underline text-sm">
                    Download PNG
                  </a>
                </>
              ) : (
                <span className="text-neutral-400">No output yet</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

async function downscaleToPng(file: File, longestSide: number): Promise<Blob> {
  const img = await blobToImage(file)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  const currentLongest = Math.max(width, height)
  const scale = currentLongest > longestSide ? longestSide / currentLongest : 1
  const targetW = Math.max(1, Math.round(width * scale))
  const targetH = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get 2D context')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height, 0, 0, targetW, targetH)
  return await canvasToBlob(canvas, 'image/png')
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export image'))
        return
      }
      resolve(blob)
    }, type)
  })
}

async function safeJson(res: Response): Promise<any | null> {
  try {
    return await res.json()
  } catch {
    return null
  }
}


