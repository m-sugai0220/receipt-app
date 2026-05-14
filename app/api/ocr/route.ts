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

  const amount = extractAmount(text)
  return { store_name, amount, receipt_date: extractDate(text) }
}

function extractAmount(text: string): number | null {
  const parse = (s: string) => parseInt(s.replace(/,/g, ''), 10)

  // 1. 合計・お会計・TOTAL を最優先（小計・税込より後に出る最終金額）
  const totalMatch = text.match(/(合\s*計|お会計|TOTAL|Total)[^\d¥￥\n]{0,15}[¥￥]?\s*(\d[\d,]+)/)
  if (totalMatch) return parse(totalMatch[2])

  // 2. 税込合計
  const taxTotalMatch = text.match(/税込[^\d¥￥\n]{0,15}[¥￥]?\s*(\d[\d,]+)/)
  if (taxTotalMatch) return parse(taxTotalMatch[1])

  // 3. ¥/￥ 付きの金額がある場合は最大値（明細の最大 = 合計に近い）
  const yenMatches = [...text.matchAll(/[¥￥]\s*(\d[\d,]+)/g)]
  if (yenMatches.length > 0)
    return Math.max(...yenMatches.map((m) => parse(m[1])))

  // 4. 小計（最終手段）
  const subtotalMatch = text.match(/小\s*計[^\d¥￥\n]{0,15}[¥￥]?\s*(\d[\d,]+)/)
  if (subtotalMatch) return parse(subtotalMatch[1])

  return null
}

function extractDate(text: string): string | null {
  // 西暦: 2026年5月13日 / 2026/5/13 / 2026-5-13 / 2026. 5.13（スペース混入含む）
  const westernMatch = text.match(/(\d{4})\s*[年\/\-\.]\s*(\d{1,2})\s*[月\/\-\.]\s*(\d{1,2})/)
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
