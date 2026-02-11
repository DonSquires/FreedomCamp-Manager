import { useEffect, useState } from 'react';
import { Shield, Camera, MapPin, CheckCircle2 } from 'lucide-react';

interface LoadingStep {
  icon: any;
  label: string;
  duration: number;
}

const loadingSteps: LoadingStep[] = [
  { icon: Shield, label: 'Initializing Security...', duration: 800 },
  { icon: Camera, label: 'Loading Camera Systems...', duration: 600 },
  { icon: MapPin, label: 'Connecting to Patrol Zones...', duration: 700 },
  { icon: CheckCircle2, label: 'Ready!', duration: 400 },
];

export function FancyLoader() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let stepTimer: NodeJS.Timeout;
    let progressInterval: NodeJS.Timeout;
    let totalProgress = 0;

    const runStep = (stepIndex: number) => {
      if (stepIndex >= loadingSteps.length) {
        setProgress(100);
        return;
      }

      const step = loadingSteps[stepIndex];
      setCurrentStep(stepIndex);

      // Animate progress for this step
      const startProgress = totalProgress;
      const stepProgressIncrement = (100 / loadingSteps.length);
      const endProgress = startProgress + stepProgressIncrement;
      const progressSteps = 20;
      const progressIncrement = stepProgressIncrement / progressSteps;
      let currentProgress = startProgress;

      progressInterval = setInterval(() => {
        currentProgress += progressIncrement;
        if (currentProgress >= endProgress) {
          clearInterval(progressInterval);
          totalProgress = endProgress;
          setProgress(totalProgress);
        } else {
          setProgress(currentProgress);
        }
      }, step.duration / progressSteps);

      stepTimer = setTimeout(() => {
        runStep(stepIndex + 1);
      }, step.duration);
    };

    runStep(0);

    return () => {
      clearTimeout(stepTimer);
      clearInterval(progressInterval);
    };
  }, []);

  const CurrentIcon = loadingSteps[currentStep]?.icon || Shield;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="w-full max-w-md px-6 space-y-8">
        {/* Logo */}
        <div className="text-center space-y-4">
          <div className="relative mx-auto w-24 h-24 mb-6">
            <img 
              src="/iron-eagle-security-logo.png" 
              alt="Iron Eagle Security" 
              className="w-full h-full object-contain drop-shadow-2xl animate-pulse"
              style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.3))' }}
            />
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          </div>
          
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            FreedomCamp Manager
          </h1>
          <p className="text-sm text-muted-foreground">
            Patrol Operations & Enforcement
          </p>
        </div>

        {/* Current Step Icon */}
        <div className="flex justify-center">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
            <div className="relative w-16 h-16 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center">
              <CurrentIcon className="h-8 w-8 text-primary animate-bounce" />
            </div>
          </div>
        </div>

        {/* Loading Steps */}
        <div className="space-y-3">
          {loadingSteps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStep;
            const isCompleted = index < currentStep;
            
            return (
              <div
                key={index}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 ${
                  isActive
                    ? 'bg-primary/10 border-2 border-primary/50 scale-105'
                    : isCompleted
                    ? 'bg-green-500/5 border border-green-500/20'
                    : 'bg-muted/30 border border-border/50 opacity-50'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-primary text-primary-foreground animate-pulse'
                      : isCompleted
                      ? 'bg-green-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <StepIcon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={`text-sm font-medium transition-all ${
                    isActive
                      ? 'text-foreground'
                      : isCompleted
                      ? 'text-green-600 dark:text-green-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            >
              <div className="h-full w-full bg-white/30 animate-pulse" />
            </div>
          </div>
          <div className="flex justify-between items-center text-xs text-muted-foreground">
            <span>Loading...</span>
            <span className="font-mono font-bold">{Math.round(progress)}%</span>
          </div>
        </div>

        {/* Animated Dots */}
        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary/60 animate-bounce"
              style={{
                animationDelay: `${i * 0.15}s`,
                animationDuration: '1s',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
