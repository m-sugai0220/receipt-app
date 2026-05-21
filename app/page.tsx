'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, Receipt } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

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
  memo: string
}

type OcrPreviewData = {
  store_name: string
  amount: string
  receipt_date: string
  category: string
  memo: string
  raw_text: string
  image_url: string | null
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
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const router = useRouter()

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

  const [searchQuery, setSearchQuery] = useState('')
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [ocrPreview, setOcrPreview] = useState<OcrPreviewData | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
      if (!session) router.push('/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (!session) router.push('/login')
    })

    return () => subscription.unsubscribe()
  }, [router])

  useEffect(() => {
    if (user) fetchReceipts()
  }, [user])

  const filteredReceipts = useMemo(() => {
    if (!searchQuery.trim()) return receipts
    const q = searchQuery.toLowerCase()
    return receipts.filter((r) =>
      (r.store_name ?? '').toLowerCase().includes(q) ||
      (r.memo ?? '').toLowerCase().includes(q)
    )
  }, [receipts, searchQuery])

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
      setOcrPreview({
        store_name: json.store_name ?? '',
        amount: json.amount != null ? String(json.amount) : '',
        receipt_date: json.receipt_date ?? '',
        category: json.category ?? '未分類',
        memo: '',
        raw_text: json.raw_text ?? '',
        image_url: json.image_url ?? null,
      })
    }
    setLoading(false)
    e.target.value = ''
  }

  async function handleConfirmSave() {
    if (!ocrPreview) return
    setSaving(true)
    const { data, error } = await supabase
      .from('receipts')
      .insert({
        store_name: ocrPreview.store_name || null,
        amount: ocrPreview.amount !== '' ? Number(ocrPreview.amount) : null,
        receipt_date: ocrPreview.receipt_date || null,
        category: ocrPreview.category || null,
        memo: ocrPreview.memo || null,
        raw_text: ocrPreview.raw_text || null,
        image_url: ocrPreview.image_url || null,
      })
      .select()
      .single()

    if (error) {
      setMessage(`保存エラー: ${error.message}`)
    } else {
      setReceipts((prev) => [data, ...prev])
      setMessage('保存しました')
    }
    setSaving(false)
    setOcrPreview(null)
  }

  async function handleDelete(id: string) {
    await supabase.from('receipts').delete().eq('id', id)
    setReceipts((prev) => prev.filter((r) => r.id !== id))
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = [...selectedIds]
    await supabase.from('receipts').delete().in('id', ids)
    setReceipts((prev) => prev.filter((r) => !selectedIds.has(r.id)))
    setSelectedIds(new Set())
    setIsSelectMode(false)
    setBulkDeleting(false)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function startEdit(r: Receipt) {
    setEditingId(r.id)
    setEditForm({
      store_name: r.store_name ?? '',
      amount: r.amount != null ? String(r.amount) : '',
      receipt_date: r.receipt_date ?? '',
      category: r.category ?? '未分類',
      memo: r.memo ?? '',
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
      memo: editForm.memo || null,
    }
    await supabase.from('receipts').update(updates).eq('id', id)
    setReceipts((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    )
    setSaving(false)
    setEditingId(null)
    setEditForm(null)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function handleDownloadCSV() {
    const filtered = receipts.filter((r) => {
      const d = r.receipt_date ?? ''
      if (csvFrom && d && d < csvFrom) return false
      if (csvTo && d && d > csvTo) return false
      return true
    })
    const header = ['日付', '店名', '金額', '勘定科目', 'メモ']
    const rows = filtered.map((r) => [
      r.receipt_date ?? '',
      r.store_name ?? '',
      r.amount != null ? String(r.amount) : '',
      r.category ?? '',
      r.memo ?? '',
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
    const isSelected = selectedIds.has(r.id)

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
          <div className="flex items-center gap-2 pl-4 mb-2">
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
          </div>
          <div className="pl-4 mb-2">
            <input
              type="text"
              value={editForm.memo}
              onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
              placeholder="メモ（備考・経費申請コメントなど）"
              className="w-full text-xs text-[#37352f] bg-white border border-[#d9d9d6] rounded px-2 py-1.5 outline-none focus:border-[#37352f] transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 pl-4">
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
        className={`flex items-center gap-3 px-4 py-3.5 hover:bg-[#f7f6f3] transition-colors group ${isSelected ? 'bg-blue-50' : ''}`}
      >
        {isSelectMode && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(r.id)}
            className="w-4 h-4 rounded border-[#d9d9d6] accent-[#37352f] flex-shrink-0 cursor-pointer"
          />
        )}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#37352f] truncate">
            {r.store_name ?? '店名不明'}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${style.pill}`}>
              {r.category ?? '未分類'}
            </span>
            <span className="text-xs text-[#9b9a97]">{formatDate(r.receipt_date)}</span>
            {r.memo && (
              <span className="text-xs text-[#9b9a97] truncate max-w-[160px]" title={r.memo}>
                📝 {r.memo}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm font-semibold text-[#37352f] flex-shrink-0">
          {r.amount != null ? `¥${r.amount.toLocaleString()}` : '—'}
        </p>
        {!isSelectMode && (
          <>
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
          </>
        )}
      </div>
    )
  }

  const monthlyGroups = useMemo(() => groupByMonth(filteredReceipts), [filteredReceipts])
  const monthlyTotals = useMemo(() =>
    monthlyGroups.map(([key, items]) => ({
      key,
      total: items.reduce((s, r) => s + (r.amount ?? 0), 0),
      count: items.length,
    })),
    [monthlyGroups]
  )
  const maxMonthlyTotal = Math.max(1, ...monthlyTotals.map((m) => m.total))
  const total = receipts.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#f7f6f3] flex items-center justify-center">
        <p className="text-sm text-[#9b9a97]">読み込み中...</p>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#f7f6f3] font-sans">

      {/* ナビゲーションバー */}
      <div className="bg-white border-b border-[#e9e9e7] px-5 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🧾</span>
          <span className="font-semibold text-[#37352f] text-sm tracking-tight">領収書管理</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
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
          <button
            onClick={handleSignOut}
            className="text-xs text-[#9b9a97] hover:text-[#37352f] hover:bg-[#f1f1ef] px-2 py-1.5 rounded-md transition-colors border border-[#e9e9e7]"
          >
            ログアウト
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
        <label className="block cursor-pointer mb-4">
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

        {/* 検索バー */}
        <div className="relative mb-3">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9b9a97] text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="店名・メモで検索..."
            className="w-full text-sm text-[#37352f] bg-white border border-[#e9e9e7] rounded-lg px-3 py-2.5 pl-8 outline-none focus:border-[#37352f] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9b9a97] hover:text-[#37352f] text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        {/* 選択モード */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => {
              setIsSelectMode(!isSelectMode)
              setSelectedIds(new Set())
            }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors border ${
              isSelectMode
                ? 'text-[#37352f] border-[#37352f] bg-[#f1f1ef]'
                : 'text-[#9b9a97] border-[#e9e9e7] hover:text-[#37352f] hover:bg-[#f1f1ef]'
            }`}
          >
            {isSelectMode ? '選択終了' : '選択'}
          </button>
          {isSelectMode && selectedIds.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="text-xs text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors"
            >
              {bulkDeleting ? '削除中...' : `削除 (${selectedIds.size}件)`}
            </button>
          )}
          {searchQuery && (
            <p className="text-xs text-[#9b9a97]">{filteredReceipts.length} 件ヒット</p>
          )}
        </div>

        {/* タブ */}
        <div className="flex gap-1 mb-4 bg-[#eeede9] rounded-lg p-1">
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
            {filteredReceipts.map((r) => renderReceiptRow(r))}
            {filteredReceipts.length === 0 && <EmptyState />}
          </div>
        )}

        {/* 月別 */}
        {viewMode === 'monthly' && (
          <div className="space-y-4">
            {/* 支出推移グラフ */}
            {monthlyTotals.length > 0 && (
              <div className="bg-white rounded-xl border border-[#e9e9e7] p-4">
                <p className="text-xs font-semibold text-[#9b9a97] uppercase tracking-widest mb-3">支出推移</p>
                <div className="space-y-2.5">
                  {monthlyTotals.map(({ key, total: t, count }) => {
                    const barWidth = Math.round((t / maxMonthlyTotal) * 100)
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-[#37352f] font-medium">{formatMonthLabel(key)}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[#9b9a97]">{count}件</span>
                            <span className="text-xs font-semibold text-[#37352f]">¥{t.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-[#f1f1ef] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#37352f] rounded-full transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {filteredReceipts.length === 0 && (
              <div className="bg-white rounded-xl border border-[#e9e9e7]"><EmptyState /></div>
            )}
            {monthlyGroups.map(([key, items]) => {
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
            {filteredReceipts.length === 0 && <EmptyState />}
            {(() => {
              const groups = groupByCategory(filteredReceipts)
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

      {/* OCR確認モーダル */}
      {ocrPreview && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#37352f]">読み取り結果を確認</h2>
              <button
                onClick={() => setOcrPreview(null)}
                className="w-6 h-6 flex items-center justify-center text-[#9b9a97] hover:text-[#37352f] text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex gap-4 mb-4">
              {ocrPreview.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={ocrPreview.image_url}
                  alt="レシート"
                  className="w-20 h-20 object-cover rounded-lg border border-[#e9e9e7] flex-shrink-0"
                />
              ) : (
                <div className="w-20 h-20 bg-[#f1f1ef] rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-2xl">🧾</span>
                </div>
              )}
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={ocrPreview.store_name}
                  onChange={(e) => setOcrPreview({ ...ocrPreview, store_name: e.target.value })}
                  placeholder="店名"
                  className="w-full text-sm font-medium text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2 outline-none focus:border-[#37352f] transition-colors"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={ocrPreview.amount}
                    onChange={(e) => setOcrPreview({ ...ocrPreview, amount: e.target.value })}
                    placeholder="金額"
                    className="flex-1 text-sm font-semibold text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2 outline-none focus:border-[#37352f] transition-colors"
                  />
                  <input
                    type="date"
                    value={ocrPreview.receipt_date}
                    onChange={(e) => setOcrPreview({ ...ocrPreview, receipt_date: e.target.value })}
                    className="flex-1 text-xs text-[#9b9a97] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2 outline-none focus:border-[#37352f] transition-colors"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 mb-5">
              <select
                value={ocrPreview.category}
                onChange={(e) => setOcrPreview({ ...ocrPreview, category: e.target.value })}
                className="w-full text-sm text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2 outline-none focus:border-[#37352f] transition-colors"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <input
                type="text"
                value={ocrPreview.memo}
                onChange={(e) => setOcrPreview({ ...ocrPreview, memo: e.target.value })}
                placeholder="メモ（備考・経費申請コメントなど）"
                className="w-full text-sm text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2 outline-none focus:border-[#37352f] transition-colors"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setOcrPreview(null)}
                className="flex-1 text-sm text-[#37352f] bg-[#f1f1ef] hover:bg-[#eeede9] py-2.5 rounded-xl transition-colors font-medium"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={saving}
                className="flex-1 text-sm text-white bg-[#37352f] hover:bg-[#2f2e2b] disabled:opacity-50 py-2.5 rounded-xl transition-colors font-medium"
              >
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
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
