/**
 * Camera Permission Help Component
 * Provides browser-specific instructions for granting camera access
 */

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Camera, Info } from 'lucide-react';

interface CameraPermissionHelpProps {
  onRequestPermission: () => void;
  onSwitchToManual: () => void;
}

export function CameraPermissionHelp({
  onRequestPermission,
  onSwitchToManual,
}: CameraPermissionHelpProps) {
  return (
    <Card className="border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-8 w-8 text-amber-600 shrink-0 mt-1" />
          <div className="space-y-3">
            <h3 className="font-bold text-lg text-amber-900 dark:text-amber-100">
              📷 Browser Camera Permission Needed
            </h3>
            <div className="bg-blue-50 dark:bg-blue-950/30 border-2 border-blue-300 rounded-lg p-3">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>Important:</strong> This is a web app. Camera permission is controlled by your <strong>browser</strong>, not your phone's app settings.
                </span>
              </p>
            </div>
            
            <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
              When you tap the button below, your browser will show a popup asking to use your camera. This is normal and safe.
            </p>
            
            <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border-2 border-amber-300 space-y-3">
              <p className="font-semibold text-sm text-amber-900 dark:text-amber-100">
                📱 How to Grant Permission:
              </p>
              <ol className="text-sm space-y-2 text-gray-700 dark:text-gray-300 list-decimal list-inside pl-2">
                <li className="leading-relaxed">
                  <strong>Tap "Request Camera Permission"</strong> button below
                </li>
                <li className="leading-relaxed">
                  <strong>Your browser will show a popup</strong> (usually at the top of the screen) asking: <em>"Allow onspace.build to use your camera?"</em>
                </li>
                <li className="leading-relaxed">
                  <strong>Tap "Allow"</strong> or "Yes" in the popup
                </li>
                <li className="leading-relaxed">
                  <strong>Camera will start automatically</strong> once permission is granted
                </li>
              </ol>
              
              <div className="pt-3 border-t border-amber-200 dark:border-amber-800 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">
                  💡 If you previously blocked camera access:
                </p>
                <ol className="text-xs space-y-1.5 text-muted-foreground list-decimal list-inside pl-2">
                  <li>Look for the 🔒 <strong>lock icon</strong> or ⓘ <strong>info icon</strong> in your browser's address bar (top of screen)</li>
                  <li>Tap it to open site settings</li>
                  <li>Find <strong>"Camera"</strong> permissions</li>
                  <li>Change from "Blocked" to <strong>"Allow"</strong></li>
                  <li>Refresh this page and try again</li>
                </ol>
              </div>
              
              <div className="pt-3 border-t border-amber-200 dark:border-amber-800 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">
                  ❌ Won't find in Phone Settings:
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed pl-2">
                  You <strong>will not</strong> see "Camera" permission in your phone's Settings → Apps → FreedomCamp. That's normal for web apps. All camera permissions are managed by your browser.
                </p>
              </div>
            </div>
            
            <div className="grid gap-3 pt-2">
              <Button
                onClick={onRequestPermission}
                className="w-full h-14 text-base font-bold bg-amber-600 hover:bg-amber-700 touch-manipulation"
              >
                <Camera className="h-5 w-5 mr-2" />
                Request Camera Permission
              </Button>
              
              <Button
                variant="outline"
                onClick={onSwitchToManual}
                className="w-full h-12 text-sm touch-manipulation"
              >
                Use Manual Entry Instead
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
