'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message)
    } else {
      router.push('/')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#f7f6f3] font-sans flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl">🧾</span>
          <h1 className="text-xl font-semibold text-[#37352f] mt-3 tracking-tight">領収書管理</h1>
          <p className="text-sm text-[#9b9a97] mt-1">ログインしてください</p>
        </div>

        <div className="bg-white rounded-2xl border border-[#e9e9e7] p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#37352f] mb-1.5">メールアドレス</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="email@example.com"
                className="w-full text-sm text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2.5 outline-none focus:border-[#37352f] transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#37352f] mb-1.5">パスワード</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="パスワード"
                className="w-full text-sm text-[#37352f] bg-[#fafaf8] border border-[#e9e9e7] rounded-lg px-3 py-2.5 outline-none focus:border-[#37352f] transition-colors"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full text-sm font-medium text-white bg-[#37352f] hover:bg-[#2f2e2b] disabled:opacity-50 py-2.5 rounded-xl transition-colors"
            >
              {loading ? 'ログイン中...' : 'ログイン'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
