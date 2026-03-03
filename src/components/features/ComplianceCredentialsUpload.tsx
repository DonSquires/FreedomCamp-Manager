import { useState, useRef } from 'react'
import { Upload, FileText, Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ExistingDocument {
  url: string
  type: string
  uploadedAt: string
}

interface ComplianceCredentialsUploadProps {
  vehicleId: string
  plateNumber: string
  onUploadComplete?: (documentUrl: string, docType: string) => void
  existingDocuments?: ExistingDocument[]
}

const DOC_TYPES = [
  { value: 'coa', label: 'COA Certificate' },
  { value: 'wof', label: 'Warrant of Fitness' },
  { value: 'compliance', label: 'Compliance Certificate' },
]

export function ComplianceCredentialsUpload({
  vehicleId,
  plateNumber,
  onUploadComplete,
  existingDocuments = [],
}: ComplianceCredentialsUploadProps) {
  const [selectedType, setSelectedType] = useState(DOC_TYPES[0].value)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (file: File | null) => {
    if (!file) return
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      toast.error('Only PDF or image files are accepted.')
      return
    }
    setSelectedFile(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0] ?? null
    handleFileChange(file)
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error('Please select a file first.')
      return
    }
    setIsUploading(true)
    try {
      // TODO: Replace with actual Supabase storage upload
      await new Promise((res) => setTimeout(res, 800))
      const blobUrl = URL.createObjectURL(selectedFile)
      try {
        toast.success('Document uploaded')
        if (onUploadComplete) onUploadComplete(blobUrl, selectedType)
      } finally {
        // Revoke immediately — caller should use the URL synchronously or store a copy
        URL.revokeObjectURL(blobUrl)
      }
      setSelectedFile(null)
    } catch {
      toast.error('Upload failed. Please try again.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-500">
        Vehicle: <span className="font-mono font-semibold text-gray-800">{plateNumber}</span>
      </div>

      {/* Document type selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt.value} value={dt.value}>{dt.label}</option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 py-8 cursor-pointer transition-colors',
          isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        )}
      >
        <Upload className="h-8 w-8 text-gray-400" />
        {selectedFile ? (
          <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
            <FileText className="h-4 w-4" />
            {selectedFile.name}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            <span className="font-medium text-blue-600">Click to upload</span> or drag and drop credential document
          </p>
        )}
        <p className="text-xs text-gray-400">PDF, JPG, PNG accepted</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button
        onClick={handleUpload}
        disabled={!selectedFile || isUploading}
        className="w-full"
      >
        <Upload className="h-4 w-4 mr-2" />
        {isUploading ? 'Uploading...' : 'Upload Document'}
      </Button>

      {/* Existing documents */}
      {existingDocuments.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Existing Documents</h4>
          <div className="space-y-2">
            {existingDocuments.map((doc, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border rounded-md px-3 py-2 bg-white text-sm"
              >
                <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {DOC_TYPES.find((d) => d.value === doc.type)?.label ?? doc.type}
                  </p>
                  <p className="text-xs text-gray-400">
                    Uploaded {new Date(doc.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-blue-600 hover:text-blue-700"
                  title="Download"
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  className="flex-shrink-0 text-red-400 hover:text-red-600"
                  title="Delete"
                  onClick={() => toast.info('Delete not implemented')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
