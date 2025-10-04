import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('image') as File | null
    const prompt = (formData.get('prompt') as string | null) ?? ''

    if (!file) {
      return NextResponse.json({ error: 'Missing image file' }, { status: 400 })
    }

    const apiKey = process.env.OPENAI_API_KEY_V1
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfiguration: missing OPEN_AI_API_KEY' }, { status: 500 })
    }

    const client = new OpenAI({ apiKey })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const uploadable = await toFile(buffer, file.name || 'input.png', { type: file.type || 'image/png' })

    // Use image edit so we can steer with a prompt (no mask provided)
    const result = await client.images.edit({
      model: 'gpt-image-1',
      image: uploadable,
      prompt: prompt || 'Recreate the subject in a clean, modern style suitable for web display. Keep subject recognizable. No text, watermark, or logos. Square composition on a simple background.',
      size: '1024x1024',
      // You can add: quality: 'high' // if supported in future SDK versions
    })

    const b64 = result.data?.[0]?.b64_json
    if (!b64) {
      return NextResponse.json({ error: 'No image returned from provider' }, { status: 502 })
    }

    const bytes = Buffer.from(b64, 'base64')
    const body = new Uint8Array(bytes)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="result.png"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}



