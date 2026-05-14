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

  // 合計キーワードの直後にある金額を優先、なければ最大の ¥ 金額
  const labeledMatch = text.match(/(合計|小計|お会計|TOTAL|Total|total|税込)[^\d¥￥\n]{0,10}[¥￥]?\s*(\d[\d,]+)/)
  if (labeledMatch) {
    const amount = parseInt(labeledMatch[2].replace(/,/g, ''), 10)
    return { store_name, amount, receipt_date: extractDate(text) }
  }
  const yenMatches = [...text.matchAll(/[¥￥]\s*(\d[\d,]+)/g)]
  const amount = yenMatches.length > 0
    ? Math.max(...yenMatches.map((m) => parseInt(m[1].replace(/,/g, ''), 10)))
    : null

  return { store_name, amount, receipt_date: extractDate(text) }
}

function extractDate(text: string): string | null {
  // 西暦: 2026年5月13日 / 2026/5/13 / 2026-5-13 / 2026.5.13
  const westernMatch = text.match(/(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/)
  if (westernMatch) {
    return `${westernMatch[1]}-${westernMatch[2].padStart(2, '0')}-${westernMatch[3].padStart(2, '0')}`
  }
  // 令和: 令和8年5月13日
  const reiwaMatch = text.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/)
  if (reiwaMatch) {
    const year = 2018 + parseInt(reiwaMatch[1], 10)
    return `${year}-${reiwaMatch[2].padStart(2, '0')}-${reiwaMatch[3].padStart(2, '0')}`
  }
  // R8.5.13 形式
  const rShortMatch = text.match(/R\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{1,2})/)
  if (rShortMatch) {
    const year = 2018 + parseInt(rShortMatch[1], 10)
    return `${year}-${rShortMatch[2].padStart(2, '0')}-${rShortMatch[3].padStart(2, '0')}`
  }
  return null
}
