'use client'

import { useState, useEffect } from 'react'
import { supabase, Receipt } from '@/lib/supabase'

const CATEGORY_DOT: Record<string, string> = {
  旅費交通費: 'bg-sky-400',
  車両費: 'bg-cyan-400',
  接待交際費: 'bg-amber-400',
  会議費: 'bg-yellow-400',
  消耗品費: 'bg-emerald-400',
  通信費: 'bg-violet-400',
  研修費: 'bg-teal-400',
  新聞図書費: 'bg-lime-400',
  広告宣伝費: 'bg-rose-400',
  外注費: 'bg-indigo-400',
  支払手数料: 'bg-slate-400',
  租税公課: 'bg-red-400',
  地代家賃: 'bg-orange-400',
  未分類: 'bg-slate-600',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
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
      setMessage('保存しました')
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

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `経費精算_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const total = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#0d0d12] text-white">

      {/* ヘッダー */}
      <div className="relative px-5 pt-12 pb-20 overflow-hidden">
        {/* 背景の光彩 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Expense Tracker</p>
        <h1 className="text-2xl font-semibold text-white mb-8">領収書管理</h1>

        {/* 合計カード */}
        <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5">
          <p className="text-xs text-slate-400 tracking-wide mb-2">今月の合計経費</p>
          <p className="text-5xl font-bold text-amber-400 tracking-tight">
            ¥{total.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-2">{receipts.length} 件</p>
          {/* 右下装飾 */}
          <div className="absolute bottom-4 right-5 text-slate-700 text-6xl font-black select-none leading-none">
            ¥
          </div>
        </div>
      </div>

      {/* アクションボタン */}
      <div className="px-4 -mt-6 flex gap-3 mb-6">
        <label className="flex-1 cursor-pointer relative group">
          <div className="absolute inset-0 bg-amber-400 rounded-xl blur opacity-30 group-hover:opacity-50 transition-opacity" />
          <div className="relative bg-amber-400 hover:bg-amber-300 active:bg-amber-500 text-black font-semibold text-center py-4 rounded-xl transition-colors">
            {loading ? '読み取り中...' : '📷  撮影 / アップロード'}
          </div>
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
          className="px-5 py-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 text-slate-300 font-medium text-sm transition-colors"
        >
          CSV
        </button>
      </div>

      {message && (
        <div className="mx-4 mb-4 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm text-center">
          {message}
        </div>
      )}

      {/* レシート一覧 */}
      <div className="px-4 space-y-3 pb-12">
        {receipts.map((r) => {
          const dot = CATEGORY_DOT[r.category ?? ''] ?? CATEGORY_DOT['未分類']
          return (
            <div
              key={r.id}
              className="rounded-2xl border border-white/8 bg-white/4 backdrop-blur p-4 hover:bg-white/7 transition-colors"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-white truncate leading-tight">
                    {r.store_name ?? '店名不明'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{formatDate(r.receipt_date)}</p>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                    <span className="text-xs text-slate-400">{r.category ?? '未分類'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <p className="text-xl font-bold text-amber-400">
                    {r.amount != null ? `¥${r.amount.toLocaleString()}` : '—'}
                  </p>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-colors text-lg"
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
          <div className="text-center py-20 text-slate-600">
            <p className="text-5xl mb-4">🧾</p>
            <p className="text-sm">レシートがまだありません</p>
          </div>
        )}
      </div>
    </div>
  )
}
