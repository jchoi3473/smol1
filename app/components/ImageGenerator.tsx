"use client"

import React from 'react'
import { removeBackground } from '@imgly/background-removal'

const BACKGROUND_FILL = '#ed8d26'

type ProcessingState =
  | { phase: 'idle' }
  | { phase: 'removing-background' }
  | { phase: 'pixelating' }
  | { phase: 'done' }
  | { phase: 'error'; message: string }

export default function ImageGenerator() {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [processingState, setProcessingState] = React.useState<ProcessingState>({ phase: 'idle' })
  const [pixelSize, setPixelSize] = React.useState<number>(15)
  const [progress, setProgress] = React.useState<number>(0)
  const [removeBg, setRemoveBg] = React.useState<boolean>(true)

  const [originalPreviewUrl, setOriginalPreviewUrl] = React.useState<string | null>(null)
  const [finalPreviewUrl, setFinalPreviewUrl] = React.useState<string | null>(null)

  // Revoke object URLs on unmount or when changing
  React.useEffect(() => {
    return () => {
      if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl)
      if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetOutputs = React.useCallback(() => {
    if (finalPreviewUrl) URL.revokeObjectURL(finalPreviewUrl)
    setFinalPreviewUrl(null)
  }, [finalPreviewUrl])

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset existing outputs and state
    resetOutputs()
    setSelectedFile(file)
    setProgress(0)

    if (originalPreviewUrl) URL.revokeObjectURL(originalPreviewUrl)
    const originalUrl = URL.createObjectURL(file)
    setOriginalPreviewUrl(originalUrl)

    await processImage(file, pixelSize, removeBg)
  }

  const processImage = async (file: File, pixelBlockSize: number, shouldRemoveBg: boolean) => {
    try {
      let inputForPixelate: Blob = file
      if (shouldRemoveBg) {
        setProcessingState({ phase: 'removing-background' })
        setProgress(0.25)
        inputForPixelate = await removeBackground(file)
      }

      setProcessingState({ phase: 'pixelating' })
      setProgress(shouldRemoveBg ? 0.6 : 0.4)
      const pixelatedBlob = await pixelateImage(inputForPixelate, pixelBlockSize)

      const outUrl = URL.createObjectURL(pixelatedBlob)
      setFinalPreviewUrl(outUrl)
      setProcessingState({ phase: 'done' })
      setProgress(1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      setProcessingState({ phase: 'error', message })
      setProgress(0)
    }
  }

  const pixelateImage = async (blob: Blob, blockSize: number): Promise<Blob> => {
    const img = await blobToImage(blob)
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height

    // Draw original to an offscreen canvas
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = width
    sourceCanvas.height = height
    const sctx = sourceCanvas.getContext('2d')
    if (!sctx) throw new Error('Failed to get 2D context')
    sctx.drawImage(img, 0, 0, width, height)

    // Scale down to create pixelated effect
    const smallW = Math.max(1, Math.floor(width / Math.max(1, blockSize)))
    const smallH = Math.max(1, Math.floor(height / Math.max(1, blockSize)))
    const smallCanvas = document.createElement('canvas')
    smallCanvas.width = smallW
    smallCanvas.height = smallH
    const smallCtx = smallCanvas.getContext('2d')
    if (!smallCtx) throw new Error('Failed to get small 2D context')
    smallCtx.imageSmoothingEnabled = false
    smallCtx.drawImage(sourceCanvas, 0, 0, smallW, smallH)

    // Draw back up onto a square canvas without smoothing
    const square = Math.max(width, height)
    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = square
    finalCanvas.height = square
    const fctx = finalCanvas.getContext('2d')
    if (!fctx) throw new Error('Failed to get final 2D context')
    fctx.imageSmoothingEnabled = false
    // Fill background first to replace transparency with the requested color
    fctx.fillStyle = BACKGROUND_FILL
    fctx.fillRect(0, 0, square, square)

    // Composite pixelated subject scaled to 70% and centered
    const scale = 0.7
    const targetW = Math.max(1, Math.floor(width * scale))
    const targetH = Math.max(1, Math.floor(height * scale))
    const offsetX = Math.floor((square - targetW) / 2)
    const offsetY = Math.floor((square - targetH) / 2)

    fctx.drawImage(smallCanvas, 0, 0, smallW, smallH, offsetX, offsetY, targetW, targetH)

    const outBlob = await canvasToBlob(finalCanvas, 'image/png')
    return outBlob
  }

  const blobToImage = (blob: Blob): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = (e) => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to load image'))
      }
      img.src = url
    })
  }

  const canvasToBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob> => {
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

  const onPixelSizeChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const next = Number(e.target.value)
    setPixelSize(next)
    if (selectedFile) {
      // Reprocess with the new pixel size
      setProgress(0)
      await processImage(selectedFile, next, removeBg)
    }
  }

  const onRemoveBgToggle: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const next = e.target.checked
    setRemoveBg(next)
    if (selectedFile) {
      setProgress(0)
      await processImage(selectedFile, pixelSize, next)
    }
  }

  const isBusy = processingState.phase === 'removing-background' || processingState.phase === 'pixelating'

  return (
    <section className="my-8">
      <h2 className="text-xl font-medium tracking-tight mb-4">Image Generator</h2>
      <div className="flex flex-col gap-4">
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={isBusy}
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="pixelRange" className="text-sm text-neutral-600 dark:text-neutral-300">
            Pixel size: {pixelSize}
          </label>
          <input
            id="pixelRange"
            type="range"
            min={2}
            max={50}
            step={1}
            value={pixelSize}
            onChange={onPixelSizeChange}
            disabled={!selectedFile || isBusy}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="removeBg"
            type="checkbox"
            checked={removeBg}
            onChange={onRemoveBgToggle}
            disabled={isBusy}
          />
          <label htmlFor="removeBg" className="text-sm text-neutral-600 dark:text-neutral-300">
            Remove Background?
          </label>
        </div>

        {processingState.phase === 'error' && (
          <p className="text-red-600 dark:text-red-400 text-sm">{processingState.message}</p>
        )}

        {isBusy && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              {processingState.phase === 'removing-background' && 'Removing background…'}
              {processingState.phase === 'pixelating' && 'Applying pixelation…'}
            </p>
            <div className="w-full h-2 bg-neutral-200 dark:bg-neutral-800 rounded overflow-hidden">
              <div
                className="h-full bg-neutral-800 dark:bg-neutral-200 transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          </div>
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
            <p className="text-sm mb-2 text-neutral-600 dark:text-neutral-300">Processed (PNG)</p>
            <div className="border border-neutral-200 dark:border-neutral-800 rounded-md p-2 min-h-[200px] flex flex-col items-center justify-center gap-3">
              {finalPreviewUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={finalPreviewUrl} alt="Processed" className="max-h-80 rounded" />
                  <a
                    href={finalPreviewUrl}
                    download="image-processed.png"
                    className="underline text-sm"
                  >
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


