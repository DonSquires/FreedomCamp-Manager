import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xbfnlzmpumthnjmtqufp.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiZm5sem1wdW10aG5qbXRxdWZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MzM3NjIsImV4cCI6MjA4NDUwOTc2Mn0.MkKNLUghGvrfnkLtOAPMPjUFM9WRIlFItR6fSIwHEnQ';

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});


