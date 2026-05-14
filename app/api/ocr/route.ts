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
  const category = guessCategory(rawText)

  const { data, error } = await supabase
    .from('receipts')
    .insert({ store_name, amount, receipt_date, raw_text: rawText, category })
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

  const skipPattern = /ありがとう|領収書|レシート|証明書|料金所|停車|ください|TEL|tel|〒|\d{3}-\d{4}/
  const store_name = lines.find((l) => l.length >= 2 && !skipPattern.test(l)) ?? null

  const amount = extractAmount(text)
  return { store_name, amount, receipt_date: extractDate(text) }
}

function extractAmount(text: string): number | null {
  const parse = (s: string) => parseInt(s.replace(/,/g, ''), 10)
  const currency = '[¥￥\\\\]'

  // お預かり・お釣り・おつりの行は除外（領収金額ではないため）
  const filtered = text
    .split('\n')
    .filter((l) => !/お?預り?金?|お預かり|おつり|お釣り|釣り銭|チェンジ|CHANGE|CASH|キャッシュ/.test(l))
    .join('\n')

  // 1. 合計・お会計・TOTAL・領収金額（最終金額キーワード）
  const totalMatch = filtered.match(new RegExp(`(領収金額|合\\s*計|お会計|TOTAL|Total)[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`))
  if (totalMatch) return parse(totalMatch[2])

  // 2. 通行料金（高速道路・交通系領収書）
  const tollMatch = filtered.match(new RegExp(`通行料金[^\\d¥￥\\\\\\n]{0,15}${currency}\\s*(\\d[\\d,]+)`))
  if (tollMatch) return parse(tollMatch[1])

  // 3. 税込合計
  const taxTotalMatch = filtered.match(new RegExp(`税込[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`))
  if (taxTotalMatch) return parse(taxTotalMatch[1])

  // 4. 通貨記号付きの金額の最大値（預り金除外済みテキストから）
  const yenMatches = [...filtered.matchAll(new RegExp(`${currency}\\s*(\\d[\\d,]+)`, 'g'))]
  if (yenMatches.length > 0)
    return Math.max(...yenMatches.map((m) => parse(m[1])))

  // 5. 小計（最終手段）
  const subtotalMatch = filtered.match(new RegExp(`小\\s*計[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`))
  if (subtotalMatch) return parse(subtotalMatch[1])

  return null
}

function guessCategory(text: string): string {
  const t = text

  if (/通行料金|高速|NEXCO|ETC|電車|タクシー|新幹線|鉄道|バス|JR|航空|飛行機/.test(t)) return '旅費交通費'
  if (/駐車場/.test(t)) return '旅費交通費'
  if (/ガソリン|給油|燃料/.test(t)) return '車両費'
  if (/ChatGPT|Claude|Notion|Canva|Zoom|Vercel|AWS|Azure|ドメイン|サブスク|subscription/.test(t)) return '通信費'
  if (/携帯|スマホ|docomo|ドコモ|SoftBank|ソフトバンク|au|NTT|インターネット|回線/.test(t)) return '通信費'
  if (/セミナー|研修|講習|ウェビナー/.test(t)) return '研修費'
  if (/書籍|本|図書|Amazon|ブックス/.test(t)) return '新聞図書費'
  if (/広告|LP制作|チラシ|展示会|名刺/.test(t)) return '広告宣伝費'
  if (/外注|デザイン|開発|フリーランス|業務委託/.test(t)) return '外注費'
  if (/振込手数料|手数料/.test(t)) return '支払手数料'
  if (/印紙|証明書|役所|行政/.test(t)) return '租税公課'
  if (/コワーキング|シェアオフィス|WeWork/.test(t)) return '地代家賃'
  if (/文房具|ステーショナリー|コクヨ|ロフト/.test(t)) return '消耗品費'
  if (/レストラン|居酒屋|焼肉|寿司|ランチ|ディナー|カフェ|飲食/.test(t)) return '接待交際費'

  return '未分類'
}

function extractDate(text: string): string | null {
  // 年月日形式（2桁・4桁の西暦、スペース混入含む）: 26年4月27日 / 2026年5月13日
  const nenMatch = text.match(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/)
  if (nenMatch) {
    const y = parseInt(nenMatch[1], 10)
    const year = y < 100 ? 2000 + y : y
    return `${year}-${nenMatch[2].padStart(2, '0')}-${nenMatch[3].padStart(2, '0')}`
  }
  // スラッシュ・ハイフン・ドット区切り: 2026/5/13 / 2026-5-13 / 2026.5.13
  const westernMatch = text.match(/(\d{4})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})/)
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
