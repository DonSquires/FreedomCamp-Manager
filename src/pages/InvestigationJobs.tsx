import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Plus,
  Search,
  Filter,
  FileText,
  MapPin,
  Calendar,
  User,
  Send,
  ExternalLink,
  Paperclip,
  AlertCircle,
  CheckCircle,
  Clock,
  X,
  Upload,
  Loader2,
  Sparkles,
  FileCheck,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useZones } from '@/hooks/useZones';
import { useUsers } from '@/hooks/useUsers';
import { supabase } from '@/lib/supabase';
import { pushNotificationManager } from '@/lib/pushNotifications';

interface InvestigationJob {
  id: string;
  reference_number: string;
  job_type: string;
  location_address: string;
  property_details: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  briefing_notes: string | null;
  instructions: string | null;
  client_name: string | null;
  client_reference: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
  created_by_user?: { first_name: string; last_name: string };
  assigned_to_user?: { first_name: string; last_name: string } | null;
  organization?: { name: string };
}

export function InvestigationJobs() {
  const { user } = useAuthStore();
  const { data: zones = [] } = useZones();
  const { data: users = [] } = useUsers();

  const [jobs, setJobs] = useState<InvestigationJob[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<InvestigationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Form state for new job
  const [newJob, setNewJob] = useState({
    reference_number: '',
    job_type: 'homeless_occupation',
    location_address: '',
    property_details: '',
    gps_latitude: '',
    gps_longitude: '',
    briefing_notes: '',
    instructions: '',
    client_name: '',
    client_reference: '',
    priority: 'medium',
    due_date: '',
    assigned_to: '',
  });

  // Document upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedDocuments, setUploadedDocuments] = useState<Array<{ name: string; url: string }>>([]);
  const [isProcessingDocument, setIsProcessingDocument] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [documentProcessed, setDocumentProcessed] = useState(false);

  useEffect(() => {
    loadJobs();
  }, [user?.id]);

  useEffect(() => {
    applyFilters();
  }, [jobs, filterStatus, filterPriority, searchQuery]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('investigation_jobs')
        .select(`
          *,
          created_by_user:user_profiles!created_by(first_name, last_name),
          assigned_to_user:user_profiles!assigned_to(first_name, last_name),
          organization:organizations(name)
        `)
        .order('created_at', { ascending: false });

      if (user?.role !== 'master' && user?.organization_id) {
        query = query.eq('organization_id', user.organization_id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setJobs(data || []);
    } catch (error: any) {
      console.error('Failed to load jobs:', error);
      toast.error('Failed to load investigation jobs');
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...jobs];

    if (filterStatus !== 'all') {
      filtered = filtered.filter(j => j.status === filterStatus);
    }

    if (filterPriority !== 'all') {
      filtered = filtered.filter(j => j.priority === filterPriority);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        j =>
          j.reference_number.toLowerCase().includes(query) ||
          j.location_address.toLowerCase().includes(query) ||
          j.client_name?.toLowerCase().includes(query)
      );
    }

    setFilteredJobs(filtered);
  };

  const handleCreateJob = async () => {
    try {
      if (!newJob.reference_number || !newJob.location_address) {
        toast.error('Please fill in all required fields');
        return;
      }

      const { data, error } = await supabase
        .from('investigation_jobs')
        .insert({
          organization_id: user?.organization_id,
          reference_number: newJob.reference_number,
          job_type: newJob.job_type,
          location_address: newJob.location_address,
          property_details: newJob.property_details || null,
          gps_latitude: newJob.gps_latitude ? parseFloat(newJob.gps_latitude) : null,
          gps_longitude: newJob.gps_longitude ? parseFloat(newJob.gps_longitude) : null,
          briefing_notes: newJob.briefing_notes || null,
          instructions: newJob.instructions || null,
          client_name: newJob.client_name || null,
          client_reference: newJob.client_reference || null,
          priority: newJob.priority,
          due_date: newJob.due_date || null,
          assigned_to: newJob.assigned_to || null,
          assigned_at: newJob.assigned_to ? new Date().toISOString() : null,
          assigned_by: newJob.assigned_to ? user?.id : null,
          status: newJob.assigned_to ? 'assigned' : 'pending',
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast.success(`Investigation job ${newJob.reference_number} created successfully`);
      setIsCreateDialogOpen(false);
      resetForm();
      loadJobs();
    } catch (error: any) {
      console.error('Failed to create job:', error);
      toast.error('Failed to create investigation job: ' + error.message);
    }
  };

  const handleAssignJob = async (jobId: string, userId: string) => {
    try {
      // Get job details first
      const job = jobs.find(j => j.id === jobId);
      if (!job) {
        toast.error('Job not found');
        return;
      }

      const { error } = await supabase
        .from('investigation_jobs')
        .update({
          assigned_to: userId,
          assigned_at: new Date().toISOString(),
          assigned_by: user?.id,
          status: 'assigned',
        })
        .eq('id', jobId);

      if (error) throw error;

      // Send push notification to assigned officer
      await pushNotificationManager.notifyJobAssignment({
        id: job.id,
        reference_number: job.reference_number,
        job_type: job.job_type,
        location_address: job.location_address,
        priority: job.priority,
        due_date: job.due_date || undefined,
      });

      toast.success('✅ Job assigned successfully - Officer notified');
      loadJobs();
    } catch (error: any) {
      console.error('Failed to assign job:', error);
      toast.error('Failed to assign job');
    }
  };

  const handleStatusChange = async (jobId: string, newStatus: string) => {
    try {
      const job = jobs.find(j => j.id === jobId);
      if (!job) {
        toast.error('Job not found');
        return;
      }

      const oldStatus = job.status;

      const { error } = await supabase
        .from('investigation_jobs')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      if (error) throw error;

      const statusLabel = newStatus.replace('_', ' ').toUpperCase();
      toast.success(`✅ Job status updated to ${statusLabel}`);
      
      loadJobs();
    } catch (error: any) {
      console.error('Failed to update status:', error);
      toast.error('Failed to update job status');
    }
  };

  const resetForm = () => {
    setNewJob({
      reference_number: '',
      job_type: 'homeless_occupation',
      location_address: '',
      property_details: '',
      gps_latitude: '',
      gps_longitude: '',
      briefing_notes: '',
      instructions: '',
      client_name: '',
      client_reference: '',
      priority: 'medium',
      due_date: '',
      assigned_to: '',
    });
    setUploadedDocuments([]);
    setDocumentProcessed(false);
    setProcessingProgress(0);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const maxSize = 10 * 1024 * 1024; // 10MB

    // Supported file types
    const supportedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'text/plain',
      'application/msword', // .doc
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    ];

    // Validate all files first
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > maxSize) {
        toast.error(`${file.name}: File size must be less than 10MB`);
        return;
      }
      if (!supportedTypes.includes(file.type)) {
        toast.error(`${file.name}: Unsupported file type. Please upload PDF, Word, image, or text files.`);
        return;
      }
    }

    // Process all files
    const totalFiles = files.length;
    let processedCount = 0;
    const extractedDataArray: any[] = [];

    setIsProcessingDocument(true);
    setProcessingProgress(10);

    try {
      const newUploadedDocs = [...uploadedDocuments];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progressBase = (i / totalFiles) * 100;
        const progressStep = 100 / totalFiles;

        console.log(`Processing file ${i + 1}/${totalFiles}: ${file.name}`);
        setProcessingProgress(progressBase + progressStep * 0.3);

        // Upload file to Supabase Storage
        const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const filePath = `${user?.id}/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        setProcessingProgress(progressBase + progressStep * 0.5);

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(filePath);

        console.log('File uploaded:', publicUrl);

        // Add to uploaded documents list
        newUploadedDocs.push({ name: file.name, url: publicUrl });

        setProcessingProgress(progressBase + progressStep * 0.6);

        // Process document with AI
        console.log('Processing document with AI...');
        const { data: processResult, error: processError } = await supabase.functions.invoke(
          'process-investigation-document',
          {
            body: {
              fileUrl: publicUrl,
              fileName: file.name,
              fileType: file.type,
            },
          }
        );

        setProcessingProgress(progressBase + progressStep * 0.9);

        if (processError) {
          console.error('Document processing error:', processError);
          toast.warning(`${file.name}: AI processing had issues, but file uploaded successfully`);
          continue;
        }

        console.log('AI processing result:', processResult);

        if (processResult?.success && processResult?.data) {
          extractedDataArray.push(processResult.data);
          toast.success(`✓ ${file.name} processed`);
        } else {
          toast.warning(`${file.name}: Uploaded but AI extraction incomplete`);
        }

        processedCount++;
      }

      // Update uploaded documents
      setUploadedDocuments(newUploadedDocs);

      // Merge extracted data from all documents (take first non-null value)
      if (extractedDataArray.length > 0) {
        const mergedData = {
          reference_number: newJob.reference_number,
          job_type: newJob.job_type,
          location_address: newJob.location_address,
          property_details: newJob.property_details,
          gps_latitude: newJob.gps_latitude,
          gps_longitude: newJob.gps_longitude,
          briefing_notes: newJob.briefing_notes,
          instructions: newJob.instructions,
          client_name: newJob.client_name,
          client_reference: newJob.client_reference,
          priority: newJob.priority,
          due_date: newJob.due_date,
        };

        // Merge extracted data (first non-null value wins)
        extractedDataArray.forEach((extracted) => {
          if (extracted.reference_number && !mergedData.reference_number) mergedData.reference_number = extracted.reference_number;
          if (extracted.job_type && mergedData.job_type === 'homeless_occupation') mergedData.job_type = extracted.job_type;
          if (extracted.location_address && !mergedData.location_address) mergedData.location_address = extracted.location_address;
          if (extracted.property_details && !mergedData.property_details) mergedData.property_details = extracted.property_details;
          if (extracted.gps_latitude && !mergedData.gps_latitude) mergedData.gps_latitude = extracted.gps_latitude.toString();
          if (extracted.gps_longitude && !mergedData.gps_longitude) mergedData.gps_longitude = extracted.gps_longitude.toString();
          if (extracted.briefing_notes && !mergedData.briefing_notes) mergedData.briefing_notes = extracted.briefing_notes;
          if (extracted.instructions && !mergedData.instructions) mergedData.instructions = extracted.instructions;
          if (extracted.client_name && !mergedData.client_name) mergedData.client_name = extracted.client_name;
          if (extracted.client_reference && !mergedData.client_reference) mergedData.client_reference = extracted.client_reference;
          if (extracted.priority && mergedData.priority === 'medium') mergedData.priority = extracted.priority;
          if (extracted.due_date && !mergedData.due_date) mergedData.due_date = extracted.due_date;
        });

        // Auto-populate form fields with merged data
        setNewJob({
          ...mergedData,
          assigned_to: newJob.assigned_to,
        });

        setDocumentProcessed(true);
        setProcessingProgress(100);
        toast.success(`✓ Successfully processed ${processedCount}/${totalFiles} document(s)`);
      } else {
        toast.warning(`Documents uploaded but AI extraction had issues. Please review fields.`);
        setProcessingProgress(100);
      }
    } catch (error: any) {
      console.error('Failed to process documents:', error);
      toast.error('Failed to process documents: ' + (error.message || 'Unknown error'));
    } finally {
      setIsProcessingDocument(false);
      setTimeout(() => setProcessingProgress(0), 1000);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'bg-amber-500/10 text-amber-500',
      assigned: 'bg-blue-500/10 text-blue-500',
      in_progress: 'bg-purple-500/10 text-purple-500',
      completed: 'bg-green-500/10 text-green-500',
      cancelled: 'bg-gray-500/10 text-gray-500',
    };

    return (
      <Badge variant="outline" className={variants[status as keyof typeof variants] || ''}>
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const variants = {
      low: 'bg-blue-500/10 text-blue-500',
      medium: 'bg-amber-500/10 text-amber-500',
      high: 'bg-orange-500/10 text-orange-500',
      urgent: 'bg-red-500/10 text-red-500',
    };

    return (
      <Badge variant="outline" className={variants[priority as keyof typeof variants] || ''}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const fieldOfficers = users.filter(u => u.role === 'officer');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Investigation Jobs</h2>
          <p className="text-muted-foreground">
            Manage homeless occupation and abandoned vehicle investigations
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Job
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search jobs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger>
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            {(filterStatus !== 'all' || filterPriority !== 'all' || searchQuery) && (
              <Button
                variant="outline"
                onClick={() => {
                  setFilterStatus('all');
                  setFilterPriority('all');
                  setSearchQuery('');
                }}
              >
                <X className="h-4 w-4 mr-2" />
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Jobs Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground">Loading investigation jobs...</div>
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No investigation jobs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredJobs.map((job) => (
                    <TableRow key={job.id} data-job-id={job.id}>
                      <TableCell className="font-medium">{job.reference_number}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {job.job_type.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{job.location_address}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{job.client_name || '-'}</TableCell>
                      <TableCell>
                        {job.assigned_to_user ? (
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">
                              {job.assigned_to_user.first_name} {job.assigned_to_user.last_name}
                            </span>
                          </div>
                        ) : (
                          <Select
                            value={job.assigned_to || ''}
                            onValueChange={(value) => handleAssignJob(job.id, value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Assign..." />
                            </SelectTrigger>
                            <SelectContent>
                              {fieldOfficers.map((officer) => (
                                <SelectItem key={officer.id} value={officer.id}>
                                  {officer.first_name} {officer.last_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      <TableCell>{getPriorityBadge(job.priority)}</TableCell>
                      <TableCell>
                        {user?.role === 'admin' || user?.role === 'master' || job.assigned_to === user?.id ? (
                          <Select
                            value={job.status}
                            onValueChange={(value) => handleStatusChange(job.id, value)}
                          >
                            <SelectTrigger className="h-8 w-32">
                              <SelectValue>
                                {getStatusBadge(job.status)}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="assigned">Assigned</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          getStatusBadge(job.status)
                        )}
                      </TableCell>
                      <TableCell>
                        {job.due_date ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {new Date(job.due_date).toLocaleDateString('en-NZ')}
                          </div>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm">
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Job Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Investigation Job</DialogTitle>
            <DialogDescription>
              Upload documents to auto-populate fields with AI, or enter details manually. Fields marked with * are required.
            </DialogDescription>
          </DialogHeader>

          {/* AI Document Upload Section */}
          <div className="border-2 border-dashed border-primary/20 rounded-lg p-6 bg-primary/5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">AI Document Processing</h3>
              </div>
              {documentProcessed && (
                <Badge variant="outline" className="bg-green-500/10 text-green-500">
                  <FileCheck className="h-3 w-3 mr-1" />
                  Processed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Upload one or more briefing documents, work orders, or emails. AI will extract job number (MSD#), location, client details, instructions, and merge data from all documents.
            </p>
            
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              accept=".pdf,.jpg,.jpeg,.png,.txt,.doc,.docx"
              multiple
              className="hidden"
              disabled={isProcessingDocument}
            />
            
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingDocument}
            >
              {isProcessingDocument ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing with AI...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Documents (PDF, Word, Image, Text)
                </>
              )}
            </Button>

            {isProcessingDocument && processingProgress > 0 && (
              <div className="mt-3">
                <Progress value={processingProgress} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {processingProgress < 50 ? 'Uploading...' : 
                   processingProgress < 90 ? 'AI analyzing document...' : 
                   'Extracting job details...'}
                </p>
              </div>
            )}

            {uploadedDocuments.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium">Uploaded Documents:</p>
                {uploadedDocuments.map((doc, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs bg-background rounded p-2">
                    <Paperclip className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1 truncate">{doc.name}</span>
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reference Number *</Label>
                <Input
                  value={newJob.reference_number}
                  onChange={(e) => setNewJob({ ...newJob, reference_number: e.target.value })}
                  placeholder="e.g., CL-2710195-13148"
                />
              </div>
              <div className="space-y-2">
                <Label>Job Type *</Label>
                <Select
                  value={newJob.job_type}
                  onValueChange={(value) => setNewJob({ ...newJob, job_type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="homeless_occupation">Homeless Occupation</SelectItem>
                    <SelectItem value="abandoned_vehicle">Abandoned Vehicle</SelectItem>
                    <SelectItem value="unauthorized_structure">Unauthorized Structure</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Location Address *</Label>
              <Input
                value={newJob.location_address}
                onChange={(e) => setNewJob({ ...newJob, location_address: e.target.value })}
                placeholder="e.g., Second Street, Kumara"
              />
            </div>

            <div className="space-y-2">
              <Label>Property Details</Label>
              <Textarea
                value={newJob.property_details}
                onChange={(e) => setNewJob({ ...newJob, property_details: e.target.value })}
                placeholder="Section 566 Town of Kumara SO 88979"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>GPS Latitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={newJob.gps_latitude}
                  onChange={(e) => setNewJob({ ...newJob, gps_latitude: e.target.value })}
                  placeholder="-42.123456"
                />
              </div>
              <div className="space-y-2">
                <Label>GPS Longitude</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={newJob.gps_longitude}
                  onChange={(e) => setNewJob({ ...newJob, gps_longitude: e.target.value })}
                  placeholder="171.123456"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Briefing Notes</Label>
              <Textarea
                value={newJob.briefing_notes}
                onChange={(e) => setNewJob({ ...newJob, briefing_notes: e.target.value })}
                placeholder="Background information about the site..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Instructions</Label>
              <Textarea
                value={newJob.instructions}
                onChange={(e) => setNewJob({ ...newJob, instructions: e.target.value })}
                placeholder="Please visit the site and obtain up-to-date photographs..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Client Name</Label>
                <Input
                  value={newJob.client_name}
                  onChange={(e) => setNewJob({ ...newJob, client_name: e.target.value })}
                  placeholder="e.g., LINZ, Downer"
                />
              </div>
              <div className="space-y-2">
                <Label>Client Reference</Label>
                <Input
                  value={newJob.client_reference}
                  onChange={(e) => setNewJob({ ...newJob, client_reference: e.target.value })}
                  placeholder="Client's reference number"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={newJob.priority}
                  onValueChange={(value) => setNewJob({ ...newJob, priority: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={newJob.due_date}
                  onChange={(e) => setNewJob({ ...newJob, due_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select
                  value={newJob.assigned_to}
                  onValueChange={(value) => setNewJob({ ...newJob, assigned_to: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select officer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {fieldOfficers.map((officer) => (
                      <SelectItem key={officer.id} value={officer.id}>
                        {officer.first_name} {officer.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateJob}>
              <Send className="h-4 w-4 mr-2" />
              Create & Dispatch Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
