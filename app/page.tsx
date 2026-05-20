'use client'

import { useState, useEffect } from 'react'
import { supabase, Receipt } from '@/lib/supabase'

const CATEGORY_COLOR: Record<string, { dot: string; pill: string }> = {
  旅費交通費:  { dot: 'bg-blue-400',   pill: 'bg-blue-50 text-blue-600 border-blue-100' },
  車両費:      { dot: 'bg-cyan-400',   pill: 'bg-cyan-50 text-cyan-600 border-cyan-100' },
  接待交際費:  { dot: 'bg-orange-400', pill: 'bg-orange-50 text-orange-600 border-orange-100' },
  会議費:      { dot: 'bg-yellow-400', pill: 'bg-yellow-50 text-yellow-700 border-yellow-100' },
  消耗品費:    { dot: 'bg-emerald-400',pill: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  通信費:      { dot: 'bg-violet-400', pill: 'bg-violet-50 text-violet-600 border-violet-100' },
  研修費:      { dot: 'bg-teal-400',   pill: 'bg-teal-50 text-teal-600 border-teal-100' },
  新聞図書費:  { dot: 'bg-lime-500',   pill: 'bg-lime-50 text-lime-700 border-lime-100' },
  広告宣伝費:  { dot: 'bg-rose-400',   pill: 'bg-rose-50 text-rose-600 border-rose-100' },
  外注費:      { dot: 'bg-indigo-400', pill: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
  支払手数料:  { dot: 'bg-slate-400',  pill: 'bg-slate-50 text-slate-500 border-slate-100' },
  租税公課:    { dot: 'bg-red-400',    pill: 'bg-red-50 text-red-600 border-red-100' },
  地代家賃:    { dot: 'bg-amber-400',  pill: 'bg-amber-50 text-amber-600 border-amber-100' },
  未分類:      { dot: 'bg-gray-300',   pill: 'bg-gray-50 text-gray-400 border-gray-100' },
}

const CATEGORIES = Object.keys(CATEGORY_COLOR)

type ViewMode = 'all' | 'monthly' | 'category'

type EditForm = {
  store_name: string
  amount: string
  receipt_date: string
  category: string
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function formatMonthLabel(key: string): string {
  if (key === 'undated') return '日付なし'
  const [y, m] = key.split('-')
  return `${y}年${parseInt(m, 10)}月`
}

function groupByMonth(receipts: Receipt[]): [string, Receipt[]][] {
  const map = new Map<string, Receipt[]>()
  for (const r of receipts) {
    const key = r.receipt_date ? r.receipt_date.slice(0, 7) : 'undated'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()].sort(([a], [b]) => b.localeCompare(a))
}

function groupByCategory(receipts: Receipt[]): { cat: string; items: Receipt[]; total: number }[] {
  const map = new Map<string, Receipt[]>()
  for (const r of receipts) {
    const key = r.category ?? '未分類'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()]
    .map(([cat, items]) => ({ cat, items, total: items.reduce((s, r) => s + (r.amount ?? 0), 0) }))
    .sort((a, b) => b.total - a.total)
}

export default function Home() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('all')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [csvFrom, setCsvFrom] = useState('')
  const [csvTo, setCsvTo] = useState('')

  useEffect(() => { fetchReceipts() }, [])

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

  function startEdit(r: Receipt) {
    setEditingId(r.id)
    setEditForm({
      store_name: r.store_name ?? '',
      amount: r.amount != null ? String(r.amount) : '',
      receipt_date: r.receipt_date ?? '',
      category: r.category ?? '未分類',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  async function handleSave(id: string) {
    if (!editForm) return
    setSaving(true)
    const updates = {
      store_name: editForm.store_name || null,
      amount: editForm.amount !== '' ? Number(editForm.amount) : null,
      receipt_date: editForm.receipt_date || null,
      category: editForm.category || null,
    }
    await supabase.from('receipts').update(updates).eq('id', id)
    setReceipts((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    )
    setSaving(false)
    setEditingId(null)
    setEditForm(null)
  }

  function handleDownloadCSV() {
    const filtered = receipts.filter((r) => {
      const d = r.receipt_date ?? ''
      if (csvFrom && d && d < csvFrom) return false
      if (csvTo && d && d > csvTo) return false
      return true
    })
    const header = ['日付', '店名', '金額', '勘定科目']
    const rows = filtered.map((r) => [
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
    const suffix = csvFrom || csvTo ? `${csvFrom || ''}〜${csvTo || ''}` : new Date().toISOString().slice(0, 10)
    a.download = `経費精算_${suffix}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderReceiptRow(r: Receipt) {
    const style = CATEGORY_COLOR[r.category ?? ''] ?? CATEGORY_COLOR['未分類']
    const isEditing = editingId === r.id

    if (isEditing && editForm) {
      const editStyle = CATEGORY_COLOR[editForm.category] ?? CATEGORY_COLOR['未分類']
      return (
        <div key={r.id} className="px-4 py-3 bg-[#fafaf8]">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${editStyle.dot}`} />
            <input
              type="text"
              value={editForm.store_name}
              onChange={(e) => setEditForm({ ...editForm, store_name: e.target.value })}
              placeholder="店名"
              className="flex-1 text-sm font-medium text-[#37352f] bg-white border border-[#d9d9d6] rounded px-2 py-1 outline-none focus:border-[#37352f] transition-colors"
            />
            <input
              type="number"
              value={editForm.amount}
              onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
              placeholder="金額"
              className="w-24 text-sm font-semibold text-[#37352f] bg-white border border-[#d9d9d6] rounded px-2 py-1 outline-none focus:border-[#37352f] transition-colors text-right"
            />
          </div>
          <div className="flex items-center gap-2 pl-4">
            <select
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              className="text-xs bg-white border border-[#d9d9d6] rounded px-1.5 py-1 outline-none focus:border-[#37352f] transition-colors text-[#37352f]"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="date"
              value={editForm.receipt_date}
              onChange={(e) => setEditForm({ ...editForm, receipt_date: e.target.value })}
              className="text-xs text-[#9b9a97] bg-white border border-[#d9d9d6] rounded px-1.5 py-1 outline-none focus:border-[#37352f] transition-colors"
            />
            <div className="flex-1" />
            <button
              onClick={cancelEdit}
              className="text-xs text-[#9b9a97] hover:text-[#37352f] px-2 py-1 rounded hover:bg-[#f1f1ef] transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={() => handleSave(r.id)}
              disabled={saving}
              className="text-xs text-white bg-[#37352f] hover:bg-[#2f2e2b] disabled:opacity-50 px-3 py-1 rounded transition-colors"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )
    }

    return (
      <div
        key={r.id}
        className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#f7f6f3] transition-colors group"
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#37352f] truncate">
            {r.store_name ?? '店名不明'}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${style.pill}`}>
              {r.category ?? '未分類'}
            </span>
            <span className="text-xs text-[#9b9a97]">{formatDate(r.receipt_date)}</span>
          </div>
        </div>
        <p className="text-sm font-semibold text-[#37352f] flex-shrink-0">
          {r.amount != null ? `¥${r.amount.toLocaleString()}` : '—'}
        </p>
        {r.image_url && (
          <button
            onClick={() => setPreviewUrl(r.image_url)}
            className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[#9b9a97] hover:text-[#37352f] hover:bg-[#f1f1ef] transition-all text-sm flex-shrink-0"
            aria-label="画像プレビュー"
          >
            🖼
          </button>
        )}
        <button
          onClick={() => startEdit(r)}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[#9b9a97] hover:text-[#37352f] hover:bg-[#f1f1ef] transition-all text-sm flex-shrink-0"
          aria-label="編集"
        >
          ✎
        </button>
        <button
          onClick={() => handleDelete(r.id)}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-[#9b9a97] hover:text-red-500 hover:bg-red-50 transition-all text-base flex-shrink-0"
          aria-label="削除"
        >
          ×
        </button>
      </div>
    )
  }

  const total = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <div className="min-h-screen bg-[#f7f6f3] font-sans">

      {/* ナビゲーションバー */}
      <div className="bg-white border-b border-[#e9e9e7] px-5 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🧾</span>
          <span className="font-semibold text-[#37352f] text-sm tracking-tight">領収書管理</span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={csvFrom}
            onChange={(e) => setCsvFrom(e.target.value)}
            className="text-xs text-[#787774] border border-[#e9e9e7] rounded-md px-2 py-1.5 bg-white focus:outline-none"
          />
          <span className="text-xs text-[#9b9a97]">〜</span>
          <input
            type="date"
            value={csvTo}
            onChange={(e) => setCsvTo(e.target.value)}
            className="text-xs text-[#787774] border border-[#e9e9e7] rounded-md px-2 py-1.5 bg-white focus:outline-none"
          />
          <button
            onClick={handleDownloadCSV}
            disabled={receipts.length === 0}
            className="flex items-center gap-1.5 text-xs text-[#787774] hover:text-[#37352f] hover:bg-[#f1f1ef] disabled:opacity-40 px-3 py-1.5 rounded-md transition-colors border border-[#e9e9e7]"
          >
            ↓ CSV出力
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-8 pb-16">

        {/* サマリー */}
        <div className="mb-8">
          <p className="text-xs text-[#9b9a97] uppercase tracking-widest mb-1">Total expenses</p>
          <p className="text-5xl font-bold text-[#37352f] tracking-tight leading-none">
            ¥{total.toLocaleString()}
          </p>
          <p className="text-sm text-[#9b9a97] mt-2">{receipts.length} 件の領収書</p>
        </div>

        {/* アップロードボタン */}
        <label className="block cursor-pointer mb-2">
          <div className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#37352f] hover:bg-[#2f2e2b] active:bg-[#25241f] text-white text-sm font-medium transition-colors">
            {loading ? (
              <span className="text-[#9b9a97]">読み取り中...</span>
            ) : (
              <>
                <span>📷</span>
                <span>撮影 / アップロード</span>
              </>
            )}
          </div>
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={loading} />
        </label>

        {message && (
          <p className="text-xs text-center text-[#9b9a97] mb-4">{message}</p>
        )}

        {/* タブ */}
        <div className="flex gap-1 mt-6 mb-4 bg-[#eeede9] rounded-lg p-1">
          {(['all', 'monthly', 'category'] as ViewMode[]).map((mode) => {
            const labels: Record<ViewMode, string> = { all: 'すべて', monthly: '月別', category: 'カテゴリ' }
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors font-medium ${
                  viewMode === mode
                    ? 'bg-white text-[#37352f] shadow-sm'
                    : 'text-[#9b9a97] hover:text-[#37352f]'
                }`}
              >
                {labels[mode]}
              </button>
            )
          })}
        </div>

        {/* すべて */}
        {viewMode === 'all' && (
          <div className="bg-white rounded-xl border border-[#e9e9e7] overflow-hidden divide-y divide-[#e9e9e7]">
            {receipts.map((r) => renderReceiptRow(r))}
            {receipts.length === 0 && <EmptyState />}
          </div>
        )}

        {/* 月別 */}
        {viewMode === 'monthly' && (
          <div className="space-y-4">
            {receipts.length === 0 && (
              <div className="bg-white rounded-xl border border-[#e9e9e7]"><EmptyState /></div>
            )}
            {groupByMonth(receipts).map(([key, items]) => {
              const monthTotal = items.reduce((s, r) => s + (r.amount ?? 0), 0)
              return (
                <div key={key} className="bg-white rounded-xl border border-[#e9e9e7] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#fafaf8] border-b border-[#e9e9e7]">
                    <span className="text-xs font-semibold text-[#37352f]">{formatMonthLabel(key)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#9b9a97]">{items.length}件</span>
                      <span className="text-xs font-semibold text-[#37352f]">¥{monthTotal.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-[#e9e9e7]">
                    {items.map((r) => renderReceiptRow(r))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* カテゴリ別 */}
        {viewMode === 'category' && (
          <div className="bg-white rounded-xl border border-[#e9e9e7] overflow-hidden divide-y divide-[#e9e9e7]">
            {receipts.length === 0 && <EmptyState />}
            {(() => {
              const groups = groupByCategory(receipts)
              const maxTotal = groups[0]?.total ?? 1
              return groups.map(({ cat, items, total: catTotal }) => {
                const style = CATEGORY_COLOR[cat] ?? CATEGORY_COLOR['未分類']
                const barWidth = Math.round((catTotal / maxTotal) * 100)
                return (
                  <div key={cat} className="px-4 py-3.5">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                      <span className="flex-1 text-sm font-medium text-[#37352f]">{cat}</span>
                      <span className="text-xs text-[#9b9a97]">{items.length}件</span>
                      <span className="text-sm font-semibold text-[#37352f]">¥{catTotal.toLocaleString()}</span>
                    </div>
                    <div className="ml-5 h-1 bg-[#f1f1ef] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${style.dot}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )}
      </div>

      {/* 画像プレビューモーダル */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="relative max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 w-7 h-7 bg-white rounded-full flex items-center justify-center text-[#37352f] shadow-md text-sm font-bold z-10"
              aria-label="閉じる"
            >
              ×
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt="レシート画像"
              className="w-full rounded-xl shadow-xl object-contain max-h-[80vh]"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="py-16 text-center">
      <p className="text-3xl mb-3">🧾</p>
      <p className="text-sm text-[#9b9a97]">レシートがまだありません</p>
      <p className="text-xs text-[#c4c3bf] mt-1">上のボタンから撮影して追加できます</p>
    </div>
  )
}
