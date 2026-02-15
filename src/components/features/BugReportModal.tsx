/**
 * Bug Report Modal - User-friendly issue reporting
 * Auto-captures system context, allows screenshots, categorizes issues
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Bug,
  Lightbulb,
  Zap,
  TrendingUp,
  Palette,
  Database,
  HelpCircle,
  Camera,
  X,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { APP_VERSION } from '@/constants/version';

interface BugReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: string;
  defaultPage?: string;
}

const ISSUE_TYPES = [
  { value: 'bug', label: 'Bug / Error', icon: Bug, color: 'text-red-600', description: 'Something is broken or not working' },
  { value: 'feature_request', label: 'Feature Request', icon: Lightbulb, color: 'text-yellow-600', description: 'New functionality or capability' },
  { value: 'enhancement', label: 'Enhancement', icon: TrendingUp, color: 'text-blue-600', description: 'Improve existing feature' },
  { value: 'performance', label: 'Performance', icon: Zap, color: 'text-orange-600', description: 'Speed or efficiency issue' },
  { value: 'ui_ux', label: 'UI/UX', icon: Palette, color: 'text-purple-600', description: 'Design or usability concern' },
  { value: 'data_issue', label: 'Data Issue', icon: Database, color: 'text-green-600', description: 'Incorrect or missing data' },
  { value: 'other', label: 'Other', icon: HelpCircle, color: 'text-gray-600', description: 'Other type of issue' },
];

const SEVERITY_LEVELS = [
  { value: 'critical', label: 'Critical', description: 'App is unusable or data loss', color: 'bg-red-500' },
  { value: 'high', label: 'High', description: 'Major feature broken', color: 'bg-orange-500' },
  { value: 'medium', label: 'Medium', description: 'Feature partially broken', color: 'bg-yellow-500' },
  { value: 'low', label: 'Low', description: 'Minor issue or cosmetic', color: 'bg-blue-500' },
];

export function BugReportModal({ open, onOpenChange, defaultType, defaultPage }: BugReportModalProps) {
  const { user } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form fields
  const [issueType, setIssueType] = useState(defaultType || 'bug');
  const [severity, setSeverity] = useState('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [expectedBehavior, setExpectedBehavior] = useState('');
  const [actualBehavior, setActualBehavior] = useState('');
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [screenshotPreviews, setScreenshotPreviews] = useState<string[]>([]);

  // Auto-captured system info
  const [systemInfo, setSystemInfo] = useState({
    appVersion: APP_VERSION,
    currentPage: defaultPage || window.location.pathname,
    browserInfo: {} as any,
    deviceInfo: {} as any,
    networkStatus: navigator.onLine ? 'online' : 'offline',
  });

  // Capture system information on mount
  useEffect(() => {
    const browserInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      windowSize: `${window.innerWidth}x${window.innerHeight}`,
      colorDepth: window.screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
    };

    const deviceInfo = {
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      isTablet: /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent),
      isDesktop: !/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      touchSupport: 'ontouchstart' in window,
      maxTouchPoints: navigator.maxTouchPoints || 0,
    };

    setSystemInfo(prev => ({
      ...prev,
      browserInfo,
      deviceInfo,
    }));
  }, []);

  // Handle screenshot upload
  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    
    if (files.length + screenshots.length > 5) {
      toast.error('Maximum 5 screenshots allowed');
      return;
    }

    // Create previews
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setScreenshotPreviews(prev => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });

    setScreenshots(prev => [...prev, ...files]);
  };

  const removeScreenshot = (index: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== index));
    setScreenshotPreviews(prev => prev.filter((_, i) => i !== index));
  };

  // Capture console errors (last 10)
  const captureConsoleErrors = () => {
    try {
      const errors = (window as any).__consoleErrors || [];
      return errors.slice(-10);
    } catch {
      return [];
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !description.trim()) {
      toast.error('Please fill in title and description');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload screenshots first
      const screenshotUrls: string[] = [];
      const screenshotMetadata: any[] = [];

      for (let i = 0; i < screenshots.length; i++) {
        const file = screenshots[i];
        const fileName = `bug-reports/${user?.id}/${Date.now()}_${i}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('evidence')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('evidence')
          .getPublicUrl(fileName);

        screenshotUrls.push(publicUrl);
        screenshotMetadata.push({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          uploadedAt: new Date().toISOString(),
        });
      }

      // Create bug report
      const { error: reportError } = await supabase
        .from('bug_reports')
        .insert({
          organization_id: user?.organization_id,
          user_id: user?.id,
          issue_type: issueType,
          severity,
          title: title.trim(),
          description: description.trim(),
          steps_to_reproduce: stepsToReproduce.trim() || null,
          expected_behavior: expectedBehavior.trim() || null,
          actual_behavior: actualBehavior.trim() || null,
          app_version: systemInfo.appVersion,
          user_role: user?.role,
          current_page: systemInfo.currentPage,
          browser_info: systemInfo.browserInfo,
          device_info: systemInfo.deviceInfo,
          console_errors: captureConsoleErrors(),
          network_status: systemInfo.networkStatus,
          screenshots: screenshotUrls,
          screenshot_metadata: screenshotMetadata,
        });

      if (reportError) throw reportError;

      setSubmitted(true);
      toast.success('✅ Report submitted successfully!');

      // Reset form after 2 seconds and close
      setTimeout(() => {
        resetForm();
        onOpenChange(false);
        setSubmitted(false);
      }, 2000);

    } catch (error: any) {
      console.error('Failed to submit bug report:', error);
      toast.error(error.message || 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setStepsToReproduce('');
    setExpectedBehavior('');
    setActualBehavior('');
    setScreenshots([]);
    setScreenshotPreviews([]);
    setIssueType(defaultType || 'bug');
    setSeverity('medium');
  };

  const selectedIssueType = ISSUE_TYPES.find(t => t.value === issueType);
  const Icon = selectedIssueType?.icon || Bug;

  if (submitted) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="text-center py-8">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-bold mb-2">Report Submitted!</h3>
            <p className="text-muted-foreground text-sm">
              Thank you for helping us improve FreedomCamp Manager.
              <br />
              We'll review your report shortly.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="mx-auto mb-2 h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <Icon className={`h-7 w-7 ${selectedIssueType?.color || 'text-primary'}`} />
          </div>
          <DialogTitle className="text-center text-xl">Report an Issue</DialogTitle>
          <DialogDescription className="text-center">
            Help us improve by reporting bugs, requesting features, or suggesting enhancements
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Issue Type */}
          <div className="space-y-2">
            <Label>What type of issue is this?</Label>
            <div className="grid grid-cols-2 gap-2">
              {ISSUE_TYPES.map((type) => {
                const TypeIcon = type.icon;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setIssueType(type.value)}
                    className={`p-3 text-left border-2 rounded-lg transition-all ${
                      issueType === type.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <TypeIcon className={`h-5 w-5 ${type.color} shrink-0 mt-0.5`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{type.label}</p>
                        <p className="text-xs text-muted-foreground">{type.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severity (only for bugs) */}
          {issueType === 'bug' && (
            <div className="space-y-2">
              <Label>How severe is this issue?</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_LEVELS.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${level.color}`} />
                        <span className="font-semibold">{level.label}</span>
                        <span className="text-xs text-muted-foreground">- {level.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Brief summary of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              required
            />
          </div>

          {/* Steps to Reproduce (for bugs) */}
          {issueType === 'bug' && (
            <div className="space-y-2">
              <Label htmlFor="steps">Steps to Reproduce (optional)</Label>
              <Textarea
                id="steps"
                placeholder="1. Go to...\n2. Click on...\n3. See error..."
                value={stepsToReproduce}
                onChange={(e) => setStepsToReproduce(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {/* Expected vs Actual (for bugs) */}
          {issueType === 'bug' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expected">Expected Behavior</Label>
                <Textarea
                  id="expected"
                  placeholder="What should happen?"
                  value={expectedBehavior}
                  onChange={(e) => setExpectedBehavior(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actual">Actual Behavior</Label>
                <Textarea
                  id="actual"
                  placeholder="What actually happens?"
                  value={actualBehavior}
                  onChange={(e) => setActualBehavior(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Screenshots */}
          <div className="space-y-2">
            <Label>Screenshots (optional, max 5)</Label>
            <div className="space-y-2">
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={handleScreenshotSelect}
                disabled={screenshots.length >= 5}
                className="cursor-pointer"
              />
              {screenshotPreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {screenshotPreviews.map((preview, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={preview}
                        alt={`Screenshot ${index + 1}`}
                        className="w-full h-24 object-cover rounded-lg border"
                      />
                      <button
                        type="button"
                        onClick={() => removeScreenshot(index)}
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System Info Preview */}
          <Card className="bg-muted/50">
            <CardContent className="p-3">
              <p className="text-xs font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                Auto-captured System Information
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div><span className="text-muted-foreground">Version:</span> {systemInfo.appVersion}</div>
                <div><span className="text-muted-foreground">Page:</span> {systemInfo.currentPage}</div>
                <div><span className="text-muted-foreground">Device:</span> {systemInfo.deviceInfo.isMobile ? 'Mobile' : systemInfo.deviceInfo.isTablet ? 'Tablet' : 'Desktop'}</div>
                <div><span className="text-muted-foreground">Network:</span> {systemInfo.networkStatus}</div>
              </div>
            </CardContent>
          </Card>
        </form>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim() || !description.trim()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
