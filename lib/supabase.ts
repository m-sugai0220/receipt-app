import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Receipt = {
  id: string
  store_name: string | null
  amount: number | null
  receipt_date: string | null
  raw_text: string | null
  image_url: string | null
  created_at: string
}
