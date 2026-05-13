'use client'

import { useState, useEffect } from 'react'
import { supabase, Receipt } from '@/lib/supabase'

export default function Home() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetchReceipts()
  }, [])

  async function fetchReceipts() {
    const { data } = await supabase
      .from('receipts')
      .select('*')
      .order('created_at', { ascending: false })
    setReceipts(data ?? [])
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    setMessage('読み取り中...')

    const formData = new FormData()
    formData.append('image', file)

    const res = await fetch('/api/ocr', { method: 'POST', body: formData })
    const json = await res.json()

    if (json.error) {
      setMessage(`エラー: ${json.error}`)
    } else {
      setMessage('保存しました！')
      fetchReceipts()
    }

    setLoading(false)
    e.target.value = ''
  }

  const total = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <main className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">領収書管理</h1>

      <div className="flex gap-2 mb-2">
        <label className="flex-1 cursor-pointer bg-blue-500 hover:bg-blue-600 text-white text-center py-3 rounded-lg">
          {loading ? '処理中...' : '📷 撮影'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleUpload}
            disabled={loading}
          />
        </label>
        <label className="flex-1 cursor-pointer bg-gray-500 hover:bg-gray-600 text-white text-center py-3 rounded-lg">
          {loading ? '処理中...' : '🖼️ アップロード'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUpload}
            disabled={loading}
          />
        </label>
      </div>

      {message && <p className="text-sm text-center text-gray-600 mb-4">{message}</p>}

      <div className="bg-gray-100 rounded-lg p-3 mb-4 text-right">
        <span className="text-sm text-gray-500">合計金額</span>
        <p className="text-2xl font-bold">¥{total.toLocaleString()}</p>
      </div>

      <div className="space-y-3">
        {receipts.map((r) => (
          <div key={r.id} className="bg-white border rounded-lg p-3 shadow-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{r.store_name ?? '店名不明'}</p>
                <p className="text-sm text-gray-500">{r.receipt_date ?? '日付不明'}</p>
              </div>
              <p className="text-lg font-bold text-blue-600">
                {r.amount != null ? `¥${r.amount.toLocaleString()}` : '金額不明'}
              </p>
            </div>
          </div>
        ))}
        {receipts.length === 0 && (
          <p className="text-center text-gray-400 py-8">レシートがまだありません</p>
        )}
      </div>
    </main>
  )
}
