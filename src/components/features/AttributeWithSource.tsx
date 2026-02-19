/**
 * AttributeWithSource - Display vehicle attribute with data provenance
 * 
 * Shows:
 * - Attribute value
 * - Source badge (Officer Edit / Enrichment API / NZSCV Register / Field Observation)
 * - Confidence score
 * - Last updated timestamp
 * - Changed by user name
 * - Precedence tooltip
 * 
 * Features:
 * - Real-time source fetching from canonical_vehicle_sources view
 * - Color-coded source badges
 * - Hover tooltip with provenance details
 * - Precedence hierarchy education
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface AttributeWithSourceProps {
  plateNumber: string;
  attribute: string;
  value: string | number | null;
  label: string;
}

interface SourceData {
  plate_number: string;
  attribute: string;
  current_value: string;
  source: string;
  source_label: string;
  confidence: number | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string;
}

export function AttributeWithSource({
  plateNumber,
  attribute,
  value,
  label,
}: AttributeWithSourceProps) {
  const [source, setSource] = useState<SourceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchSource() {
      if (!value) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('canonical_vehicle_sources')
          .select('*')
          .eq('plate_number', plateNumber)
          .eq('attribute', attribute)
          .single();

        if (error) {
          console.warn(`No source data for ${attribute}:`, error.message);
          return;
        }

        setSource(data);
      } catch (error: any) {
        console.error('Failed to fetch source:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSource();
  }, [plateNumber, attribute, value]);

  // Color coding for source types
  const sourceColors: Record<string, string> = {
    'Officer Edit': 'bg-green-600 hover:bg-green-700 text-white border-green-700',
    'Enrichment API': 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700',
    'NZSCV Register': 'bg-purple-600 hover:bg-purple-700 text-white border-purple-700',
    'Field Observation': 'bg-orange-600 hover:bg-orange-700 text-white border-orange-700',
    'System Default': 'bg-gray-600 hover:bg-gray-700 text-white border-gray-700',
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {label}:
        </span>
        <span className="text-sm font-semibold">
          {value || 'Unknown'}
        </span>
      </div>

      {source && value && !isLoading && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className={`gap-1 text-[10px] cursor-help ${
                    sourceColors[source.source_label] || 'bg-gray-500 text-white'
                  }`}
                >
                  {source.source_label}
                </Badge>

                <span className="text-muted-foreground">
                  {new Date(source.changed_at).toLocaleDateString('en-NZ', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>

                {source.confidence && (
                  <span className="text-muted-foreground font-medium">
                    • {(source.confidence * 100).toFixed(0)}%
                  </span>
                )}

                {source.changed_by_name && source.changed_by_name !== 'System' && (
                  <span className="text-muted-foreground">
                    • {source.changed_by_name}
                  </span>
                )}
              </div>
            </TooltipTrigger>

            <TooltipContent className="max-w-[320px] text-xs p-3">
              <div className="space-y-2">
                <div className="font-semibold text-sm border-b pb-1">
                  Data Provenance
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source:</span>
                    <span className="font-medium">{source.source_label}</span>
                  </div>

                  {source.confidence && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Confidence:</span>
                      <span className="font-medium">
                        {(source.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Updated:</span>
                    <span className="font-medium">
                      {new Date(source.changed_at).toLocaleString('en-NZ', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>

                  {source.changed_by_name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Changed by:</span>
                      <span className="font-medium">{source.changed_by_name}</span>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-2 border-t text-[10px] text-muted-foreground">
                  <div className="font-medium mb-1">Precedence Hierarchy:</div>
                  <div className="space-y-0.5">
                    <div>1️⃣ Officer Edit (highest trust)</div>
                    <div>2️⃣ Enrichment API</div>
                    <div>3️⃣ NZSCV Register</div>
                    <div>4️⃣ Field Observation (lowest trust)</div>
                  </div>
                  <div className="mt-1 italic">
                    Higher trust sources always win
                  </div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {isLoading && (
        <div className="text-xs text-muted-foreground animate-pulse">
          Loading source...
        </div>
      )}
    </div>
  );
}
