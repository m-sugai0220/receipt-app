import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const file = formData.get('image') as File

  if (!file) {
    return NextResponse.json({ error: '画像がありません' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64 },
            features: [{ type: 'TEXT_DETECTION' }],
          },
        ],
      }),
    }
  )

  const visionData = await visionRes.json()
  const rawText: string = visionData.responses?.[0]?.fullTextAnnotation?.text ?? ''

  const { store_name, amount, receipt_date } = extractReceiptInfo(rawText)

  const { data, error } = await supabase
    .from('receipts')
    .insert({ store_name, amount, receipt_date, raw_text: rawText })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ receipt: data, raw_text: rawText })
}

function extractReceiptInfo(text: string): {
  store_name: string | null
  amount: number | null
  receipt_date: string | null
} {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  const store_name = lines[0] ?? null

  const amountMatch = text.match(/[合計|計|TOTAL|total][\s\S]*?(\d[\d,]+)/)
  const amount = amountMatch
    ? parseInt(amountMatch[1].replace(/,/g, ''), 10)
    : null

  const dateMatch = text.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})/)
  const receipt_date = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    : null

  return { store_name, amount, receipt_date }
}
