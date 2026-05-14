'use client'

import { useState, useEffect } from 'react'
import { supabase, Receipt } from '@/lib/supabase'

const CATEGORY_COLORS: Record<string, string> = {
  旅費交通費: 'bg-blue-100 text-blue-700',
  車両費: 'bg-cyan-100 text-cyan-700',
  接待交際費: 'bg-orange-100 text-orange-700',
  会議費: 'bg-yellow-100 text-yellow-700',
  消耗品費: 'bg-green-100 text-green-700',
  通信費: 'bg-purple-100 text-purple-700',
  研修費: 'bg-teal-100 text-teal-700',
  新聞図書費: 'bg-lime-100 text-lime-700',
  広告宣伝費: 'bg-pink-100 text-pink-700',
  外注費: 'bg-indigo-100 text-indigo-700',
  支払手数料: 'bg-gray-100 text-gray-600',
  租税公課: 'bg-red-100 text-red-700',
  地代家賃: 'bg-amber-100 text-amber-700',
  未分類: 'bg-gray-100 text-gray-400',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '日付不明'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

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
    setMessage('')

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

  async function handleDelete(id: string) {
    await supabase.from('receipts').delete().eq('id', id)
    setReceipts((prev) => prev.filter((r) => r.id !== id))
  }

  function handleDownloadCSV() {
    const header = ['日付', '店名', '金額', '勘定科目']
    const rows = receipts.map((r) => [
      r.receipt_date ?? '',
      r.store_name ?? '',
      r.amount != null ? String(r.amount) : '',
      r.category ?? '',
    ])
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const bom = '﻿'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `経費精算_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const total = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-600 text-white px-5 pt-10 pb-16">
        <p className="text-sm text-slate-400 mb-1">経費管理</p>
        <h1 className="text-2xl font-bold mb-6">領収書管理</h1>
        <div className="bg-white/10 rounded-2xl p-4 backdrop-blur">
          <p className="text-slate-300 text-sm mb-1">今月の合計</p>
          <p className="text-4xl font-bold tracking-tight">¥{total.toLocaleString()}</p>
          <p className="text-slate-400 text-xs mt-1">{receipts.length}件</p>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="px-4 -mt-6">
        {/* アクションボタン */}
        <div className="flex gap-3 mb-5">
          <label className="flex-1 cursor-pointer bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-center py-3.5 rounded-xl font-semibold shadow-lg shadow-blue-200 transition-colors">
            {loading ? '読み取り中...' : '📷  撮影 / アップロード'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
              disabled={loading}
            />
          </label>
          <button
            onClick={handleDownloadCSV}
            disabled={receipts.length === 0}
            className="px-4 py-3.5 bg-white hover:bg-gray-50 disabled:opacity-40 text-slate-700 rounded-xl font-semibold shadow border border-gray-200 transition-colors text-sm"
          >
            CSV
          </button>
        </div>

        {message && (
          <div className="mb-4 px-4 py-2.5 bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl text-center">
            {message}
          </div>
        )}

        {/* レシート一覧 */}
        <div className="space-y-3 pb-8">
          {receipts.map((r) => {
            const badgeClass = CATEGORY_COLORS[r.category ?? ''] ?? CATEGORY_COLORS['未分類']
            return (
              <div key={r.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {r.store_name ?? '店名不明'}
                    </p>
                    <p className="text-sm text-slate-400 mt-0.5">{formatDate(r.receipt_date)}</p>
                    <span className={`inline-block mt-2 text-xs font-medium px-2.5 py-0.5 rounded-full ${badgeClass}`}>
                      {r.category ?? '未分類'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-xl font-bold text-slate-800">
                      {r.amount != null ? `¥${r.amount.toLocaleString()}` : '—'}
                    </p>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-full transition-colors text-lg"
                      aria-label="削除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {receipts.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <p className="text-4xl mb-3">🧾</p>
              <p className="text-sm">レシートがまだありません</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
