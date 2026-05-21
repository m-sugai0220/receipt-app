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
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

  let rawText = ''
  if (isPdf) {
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/files:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            inputConfig: { content: base64, mimeType: 'application/pdf' },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            pages: [1],
          }],
        }),
      }
    )
    const visionData = await visionRes.json()
    rawText = visionData.responses?.[0]?.responses?.[0]?.fullTextAnnotation?.text ?? ''
  } else {
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      }
    )
    const visionData = await visionRes.json()
    rawText = visionData.responses?.[0]?.fullTextAnnotation?.text ?? ''
  }

  const { store_name, amount, receipt_date } = extractReceiptInfo(rawText)
  const category = guessCategory(rawText)

  // Supabase Storage に画像をアップロード
  const ext = file.name.split('.').pop() ?? 'jpg'
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  let image_url: string | null = null
  const { error: storageError } = await supabase.storage
    .from('receipt-images')
    .upload(fileName, Buffer.from(bytes), {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    })
  if (!storageError) {
    const { data: urlData } = supabase.storage
      .from('receipt-images')
      .getPublicUrl(fileName)
    image_url = urlData.publicUrl
  }

  return NextResponse.json({ store_name, amount, receipt_date, raw_text: rawText, category, image_url })
}

// 全角数字・記号を半角に正規化（OCRが全角を返すケース対応）
function normalizeText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, '.').replace(/[，]/g, ',')
}

function extractReceiptInfo(text: string): {
  store_name: string | null
  amount: number | null
  receipt_date: string | null
} {
  const normalized = normalizeText(text)
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)

  // 事業者名フィールドが明記されている場合を最優先（インボイス対応領収書）
  const bizNameMatch = normalized.match(/事業者名[：:]\s*(.+)/)
  const store_name_from_biz = bizNameMatch?.[1].trim() ?? null

  // 店名として不適切な行を除外するパターン
  const skipPattern = new RegExp(
    'ありがとう|領収|レシート|証明書|料金所|停車|ください|上記|保管|印刷|但し' +
    '|TEL|tel|FAX|fax|〒|\\d{3}-\\d{4}' +               // 電話・郵便番号
    '|[¥￥\\\\]\\s*\\d|\\d[\\d,]+\\s*円' +               // 価格行
    '|^\\d[\\d,\\s]*$' +                                  // 数字のみ
    '|\\d{2,4}[年/\\-]\\d{1,2}[月/\\-]' +               // 日付行
    '|丁目|番地|番|号' +                                  // 住所
    '|合計|小計|会計|明細|内訳|税込|税抜|消費税|税率' +  // 集計行
    '|登録番号|事業者名|No\\.|POS|テーブル|担当|受付' +  // レシートメタデータ
    '|割引|値引|ポイント|御中|様$'                         // その他除外ワード
  )
  const store_name = store_name_from_biz ?? (lines.find((l) => l.length >= 3 && !skipPattern.test(l)) ?? null)

  const amount = extractAmount(normalized)
  return { store_name, amount, receipt_date: extractDate(normalized) }
}

function extractAmount(text: string): number | null {
  const parse = (s: string) => parseInt(s.replace(/,/g, ''), 10)
  const currency = '[¥￥\\\\]'

  // お預かり・おつり・現金（支払い行）と、その直後の単独金額行をセットで除外
  const cashReceivedRe = /預かり|お?預り|おつり|お?釣り?|釣銭|チェンジ|CHANGE|CASH|キャッシュ/
  const cashStandaloneRe = /^\s*現金\s*$/
  const standaloneAmountRe = /^\s*[¥￥\\]?\s*\d[\d,]*\s*円?\s*$/
  const lines = text.split('\n')
  const kept: string[] = []
  let dropNext = false
  for (const line of lines) {
    if (dropNext) {
      dropNext = false
      if (standaloneAmountRe.test(line)) continue
    }
    if (cashReceivedRe.test(line) || cashStandaloneRe.test(line)) { dropNext = true; continue }
    kept.push(line)
  }
  const filtered = kept.join('\n')

  // 0. 「領収書」以降3行以内の最初の¥金額（宛名が1行挟まる形式に対応）
  const receiptHeaderIdx = kept.findIndex(l => /領収書/.test(l))
  if (receiptHeaderIdx >= 0) {
    for (let i = receiptHeaderIdx + 1; i < Math.min(receiptHeaderIdx + 4, kept.length); i++) {
      const m = kept[i].match(new RegExp(`${currency}\\s*(\\d[\\d,]+)`))
      if (m) return parse(m[1])
    }
  }

  // 1. 合計・お会計・TOTAL等のキーワードと金額が同一行
  const totalMatch = filtered.match(new RegExp(
    `(領収金額|お買上[げ]?合計|ご?請求金額|お支払[い]?金額|合\\s*計|お会計|TOTAL|Total)` +
    `[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`
  ))
  if (totalMatch) return parse(totalMatch[2])

  // 1b. キーワードと金額が改行で分かれている場合
  const totalNextLineMatch = filtered.match(new RegExp(
    `(領収金額|お買上[げ]?合計|ご?請求金額|お支払[い]?金額|合\\s*計|お会計|TOTAL|Total)` +
    `\\s*\\n\\s*${currency}?\\s*(\\d[\\d,]+)`
  ))
  if (totalNextLineMatch) return parse(totalNextLineMatch[2])

  // 1c. 英語レシートの合計キーワード（Peach Aviation等、次行に金額）
  const engTotalMatch = filtered.match(new RegExp(
    `(THE SUM OF|TOTAL AMOUNT|AMOUNT DUE|GRAND TOTAL|AMOUNT PAID)` +
    `\\s*\\n\\s*${currency}?\\s*(\\d[\\d,]+)`
  ))
  if (engTotalMatch) return parse(engTotalMatch[2])

  // 2. 通行料金（高速道路・交通系領収書）
  const tollMatch = filtered.match(new RegExp(`通行料金[^\\d¥￥\\\\\\n]{0,15}${currency}\\s*(\\d[\\d,]+)`))
  if (tollMatch) return parse(tollMatch[1])

  // 3. 税込合計
  const taxTotalMatch = filtered.match(new RegExp(`税込[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`))
  if (taxTotalMatch) return parse(taxTotalMatch[1])

  // 4. 通貨記号付きの金額の最大値（預り金除外済みテキストから）
  const yenMatches = [...filtered.matchAll(new RegExp(`${currency}\\s*(\\d[\\d,]+)`, 'g'))]
  if (yenMatches.length > 0) {
    const amounts = yenMatches.map((m) => parse(m[1]))
    // 年号(2000-2099)と小額(100未満)を除外した候補を優先
    const plausible = amounts.filter(a => !(a >= 2000 && a <= 2099) && a >= 100)
    if (plausible.length > 0) return Math.max(...plausible)
    return Math.max(...amounts)
  }

  // 5. 円サフィックス付き金額の最大値（¥記号なしのレシート対応）
  const enMatches = [...filtered.matchAll(/(\d[\d,]+)円(?!\s*引き|割)/g)]
  if (enMatches.length > 0)
    return Math.max(...enMatches.map((m) => parse(m[1])))

  // 6. 小計（最終手段）
  const subtotalMatch = filtered.match(new RegExp(`小\\s*計[^\\d¥￥\\\\\\n]{0,15}${currency}?\\s*(\\d[\\d,]+)`))
  if (subtotalMatch) return parse(subtotalMatch[1])

  return null
}

function guessCategory(text: string): string {
  const t = text

  // 飲食を最優先（ホテル内レストランなど「HOTEL」が混入するケース対応）
  if (/レストラン|居酒屋|焼肉|寿司|ランチ|ディナー|カフェ|飲食|食事|お食事|ビール|日本酒|焼酎|ワイン|酎ハイ|ハイボール|サワー|コース料理|お食事代|酒場|ダイニング|バル|割烹/.test(t)) return '接待交際費'
  if (/通行料金|高速|NEXCO|ETC|電車|タクシー|新幹線|鉄道|バス|JR|航空|飛行機|搭乗|航空券|Peach|peach|ANA|JAL|LCC|Aviation|FLIGHT|flight|BOOKING REFERENCE|予約番号/.test(t)) return '旅費交通費'
  if (/駐車場/.test(t)) return '旅費交通費'
  if (/ホテル|旅館|宿泊|HOTEL|inn|INN/.test(t)) return '旅費交通費'
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
  if (/スターバックス|スタバ|STARBUCKS|ドトール|コメダ|タリーズ|エクセルシオール|珈琲館/.test(t)) return '会議費'
  if (/セブン[‐－-]?イレブン|ローソン|ファミリーマート|ファミマ|ミニストップ|デイリーヤマザキ/.test(t)) return '消耗品費'
  if (/マツモトキヨシ|マツキヨ|ウエルシア|ツルハ|スギ薬局|薬局|ドラッグ/.test(t)) return '消耗品費'
  if (/文房具|ステーショナリー|コクヨ|ロフト/.test(t)) return '消耗品費'

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
  // 2桁西暦スラッシュ区切り: 26/5/13 → 2026-05-13
  const shortYearMatch = text.match(/\b([2-9]\d)\/(\d{1,2})\/(\d{1,2})\b/)
  if (shortYearMatch) {
    const year = 2000 + parseInt(shortYearMatch[1], 10)
    return `${year}-${shortYearMatch[2].padStart(2, '0')}-${shortYearMatch[3].padStart(2, '0')}`
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
