import { useState } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MessageInputProps {
  onSend: (content: string) => Promise<void>
  loading?: boolean
  placeholder?: string
}

export function MessageInput({ onSend, loading = false, placeholder = 'Type message...' }: MessageInputProps) {
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!content.trim()) return

    setSending(true)
    try {
      await onSend(content)
      setContent('')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 p-3 border-t border-slate-800 bg-slate-900/50">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={loading || sending}
        rows={1}
        className="flex-1 px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
      />
      <Button
        onClick={handleSend}
        disabled={!content.trim() || loading || sending}
        size="sm"
        className="self-end"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  )
}
