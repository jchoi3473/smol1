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
  const [pixelSize, setPixelSize] = React.useState<number>(8)
  const [progress, setProgress] = React.useState<number>(0)
  const [removeBg, setRemoveBg] = React.useState<boolean>(true)
  const [palette, setPalette] = React.useState<PaletteName>('pico8')
  const [ditherEnabled, setDitherEnabled] = React.useState<boolean>(true)
  const [ditherStrength, setDitherStrength] = React.useState<number>(0.2)
  const [outlineThickness, setOutlineThickness] = React.useState<number>(0.5)
  const [normalizeEnabled, setNormalizeEnabled] = React.useState<boolean>(true)
  const [normalizeLongestSide, setNormalizeLongestSide] = React.useState<number>(512)

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
      let workingBlob: Blob = file

      // Optional: pre-normalize very large images for stability and speed
      if (normalizeEnabled) {
        setProgress(0.15)
        workingBlob = await normalizeImageBlob(file, normalizeLongestSide)
      }
      if (shouldRemoveBg) {
        setProcessingState({ phase: 'removing-background' })
        setProgress(0.25)
        // Ensure File type for library compatibility
        const workingFile = new File([workingBlob], 'input.png', { type: 'image/png' })
        workingBlob = await removeBackground(workingFile)
      }

      setProcessingState({ phase: 'pixelating' })
      setProgress(shouldRemoveBg ? 0.6 : 0.4)
      const pixelatedBlob = await pixelateImage(workingBlob, pixelBlockSize)

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
    // Load input
    const img = await blobToImage(blob)
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height

    // Stage 1: draw original to source canvas and read alpha for subject mask
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = width
    sourceCanvas.height = height
    const sctx = sourceCanvas.getContext('2d')
    if (!sctx) throw new Error('Failed to get 2D context')
    sctx.drawImage(img, 0, 0, width, height)

    // If we have transparency (from background removal), crop to subject bounds to feel like a sprite
    const srcImage = sctx.getImageData(0, 0, width, height)
    const cropBounds = getOpaqueBounds(srcImage, 16) || { x: 0, y: 0, w: width, h: height }

    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = Math.max(1, cropBounds.w)
    cropCanvas.height = Math.max(1, cropBounds.h)
    const cropCtx = cropCanvas.getContext('2d')
    if (!cropCtx) throw new Error('Failed to get crop 2D context')
    cropCtx.imageSmoothingEnabled = false
    cropCtx.drawImage(sourceCanvas, cropBounds.x, cropBounds.y, cropBounds.w, cropBounds.h, 0, 0, cropBounds.w, cropBounds.h)

    // Stage 2: scale down to small sprite resolution derived from blockSize
    const smallW = Math.max(8, Math.floor(cropBounds.w / Math.max(1, blockSize)))
    const smallH = Math.max(8, Math.floor(cropBounds.h / Math.max(1, blockSize)))
    const smallCanvas = document.createElement('canvas')
    smallCanvas.width = smallW
    smallCanvas.height = smallH
    const smallCtx = smallCanvas.getContext('2d')
    if (!smallCtx) throw new Error('Failed to get small 2D context')
    smallCtx.imageSmoothingEnabled = false
    smallCtx.drawImage(cropCanvas, 0, 0, cropBounds.w, cropBounds.h, 0, 0, smallW, smallH)

    // Stage 3: apply palette quantization with optional ordered dithering on the small sprite
    const smallImage = smallCtx.getImageData(0, 0, smallW, smallH)
    const paletteRgb = PALETTES[palette]
    const ditherAmt = ditherEnabled ? ditherStrength : 0
    const quantized = quantizeImageToPalette(smallImage, paletteRgb, ditherAmt)
    smallCtx.putImageData(quantized, 0, 0)

    // Stage 4: create 1-3 px outline from alpha at small resolution
    const outlineCanvas = document.createElement('canvas')
    outlineCanvas.width = smallW
    outlineCanvas.height = smallH
    const outlineCtx = outlineCanvas.getContext('2d')
    if (!outlineCtx) throw new Error('Failed to get outline 2D context')
    const outlineImage = createPixelOutline(quantized, Math.max(0, Math.floor(outlineThickness)))
    outlineCtx.putImageData(outlineImage, 0, 0)

    // Stage 5: draw to final square canvas with nearest-neighbor upscaling
    const square = Math.max(cropBounds.w, cropBounds.h)
    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = square
    finalCanvas.height = square
    const fctx = finalCanvas.getContext('2d')
    if (!fctx) throw new Error('Failed to get final 2D context')
    fctx.imageSmoothingEnabled = false

    // background
    fctx.fillStyle = BACKGROUND_FILL
    fctx.fillRect(0, 0, square, square)

    // Composite outline then sprite, scaled to ~60% coverage of longest side and centered
    const coverage = 0.6
    const smallLongest = Math.max(smallW, smallH)
    const scaledLongest = Math.max(1, Math.floor(square * coverage))
    const k = scaledLongest / smallLongest
    const targetW = Math.max(1, Math.floor(smallW * k))
    const targetH = Math.max(1, Math.floor(smallH * k))
    const offsetX = Math.floor((square - targetW) / 2)
    const offsetY = Math.floor((square - targetH) / 2)

    fctx.drawImage(outlineCanvas, 0, 0, smallW, smallH, offsetX, offsetY, targetW, targetH)
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

  // ==== Pixel-art helpers ====

  async function normalizeImageBlob(input: Blob, longestSide: number): Promise<Blob> {
    const img = await blobToImage(input)
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    const currentLongest = Math.max(width, height)
    if (currentLongest <= longestSide) {
      return input
    }
    const scale = longestSide / currentLongest
    const targetW = Math.max(1, Math.round(width * scale))
    const targetH = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D context for normalize')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height, 0, 0, targetW, targetH)
    return await canvasToBlob(canvas, 'image/png')
  }

  type PaletteName = 'gb' | 'nes' | 'ega' | 'c64' | 'pico8'

  // Small curated palettes for retro look
  const PALETTES: Record<PaletteName, Array<[number, number, number]>> = {
    gb: [
      [15, 56, 15],
      [48, 98, 48],
      [139, 172, 15],
      [155, 188, 15],
    ],
    nes: [
      // Subset of NES-like colors (16)
      [124, 124, 124], [0, 0, 252], [0, 0, 188], [68, 40, 188],
      [148, 0, 132], [168, 0, 32], [168, 16, 0], [136, 20, 0],
      [80, 48, 0], [0, 120, 0], [0, 104, 0], [0, 88, 0],
      [0, 64, 88], [0, 0, 0], [188, 188, 188], [248, 248, 248],
    ],
    ega: [
      [0, 0, 0], [0, 0, 170], [0, 170, 0], [0, 170, 170],
      [170, 0, 0], [170, 0, 170], [170, 85, 0], [170, 170, 170],
      [85, 85, 85], [85, 85, 255], [85, 255, 85], [85, 255, 255],
      [255, 85, 85], [255, 85, 255], [255, 255, 85], [255, 255, 255],
    ],
    c64: [
      [0, 0, 0], [255, 255, 255], [136, 0, 0], [170, 255, 238],
      [204, 68, 204], [0, 204, 85], [0, 0, 170], [238, 238, 119],
      [221, 136, 85], [102, 68, 0], [255, 119, 119], [51, 51, 51],
      [119, 119, 119], [170, 255, 102], [0, 136, 255], [187, 187, 187],
    ],
    pico8: [
      [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
      [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
      [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
      [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
    ],
  }

  const BAYER_4X4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]

  function getOpaqueBounds(image: ImageData, alphaThreshold: number): { x: number; y: number; w: number; h: number } | null {
    const { data, width, height } = image
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const a = data[idx + 3]
        if (a > alphaThreshold) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < minX || maxY < minY) return null
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  }

  function quantizeImageToPalette(src: ImageData, palette: Array<[number, number, number]>, ditherStrength01: number): ImageData {
    const { data, width, height } = src
    const out = new ImageData(width, height)
    const outData = out.data
    const ditherAmp = Math.max(0, Math.min(1, ditherStrength01)) * 32 // up to ~12% shift
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const a = data[idx + 3]
        if (a < 5) {
          outData[idx] = 0
          outData[idx + 1] = 0
          outData[idx + 2] = 0
          outData[idx + 3] = 0
          continue
        }
        let r = data[idx]
        let g = data[idx + 1]
        let b = data[idx + 2]

        if (ditherAmp > 0) {
          const t = BAYER_4X4[y & 3][x & 3] / 15 // 0..1
          const offset = (t - 0.5) * 2 * ditherAmp
          // bias luminance while keeping hue roughly stable
          const yLum = 0.2126 * r + 0.7152 * g + 0.0722 * b
          r = clamp255(r + offset * (r / (yLum + 1)))
          g = clamp255(g + offset * (g / (yLum + 1)))
          b = clamp255(b + offset * (b / (yLum + 1)))
        }

        const [qr, qg, qb] = findNearestInPalette(r, g, b, palette)
        outData[idx] = qr
        outData[idx + 1] = qg
        outData[idx + 2] = qb
        outData[idx + 3] = 255
      }
    }
    return out
  }

  function clamp255(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v
  }

  function findNearestInPalette(r: number, g: number, b: number, palette: Array<[number, number, number]>): [number, number, number] {
    let bestIdx = 0
    let bestD = Number.POSITIVE_INFINITY
    // perceptual weighting toward green, then red, then blue
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i]
      const dr = r - pr
      const dg = g - pg
      const db = b - pb
      const d = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    return palette[bestIdx]
  }

  function createPixelOutline(src: ImageData, thickness: number): ImageData {
    const { width, height, data } = src
    const mask = new Uint8Array(width * height)
    for (let i = 0; i < width * height; i++) mask[i] = data[i * 4 + 3] > 10 ? 1 : 0

    if (thickness <= 0) {
      return new ImageData(width, height) // fully transparent
    }

    let dilated = mask
    for (let t = 0; t < thickness; t++) {
      const next = new Uint8Array(width * height)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (dilated[i]) {
            next[i] = 1
            continue
          }
          // 8-neighborhood
          let any = false
          for (let dy = -1; dy <= 1 && !any; dy++) {
            for (let dx = -1; dx <= 1 && !any; dx++) {
              if (dx === 0 && dy === 0) continue
              const nx = x + dx
              const ny = y + dy
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (dilated[ny * width + nx]) any = true
              }
            }
          }
          if (any) next[i] = 1
        }
      }
      dilated = next
    }

    const out = new ImageData(width, height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const inside = mask[i] === 1
        const grown = dilated[i] === 1
        const outline = grown && !inside
        const idx = i * 4
        if (outline) {
          out.data[idx] = 0
          out.data[idx + 1] = 0
          out.data[idx + 2] = 0
          out.data[idx + 3] = 255
        } else {
          out.data[idx + 3] = 0
        }
      }
    }
    return out
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

        {/* Hidden controls removed: Pixel size */}

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

        {/* Hidden controls removed: Normalize input size toggle and size slider */}

        {/* Hidden controls removed: Palette select, Outline slider, Dither toggle & strength */}

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


