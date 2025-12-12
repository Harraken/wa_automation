import { useEffect, useState } from 'react';

export interface ProgressStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  progress: number; // 0-100
}

interface ProgressBarProps {
  steps: ProgressStep[];
  currentStep: string;
  overallProgress: number;
  isVisible: boolean;
}

export default function ProgressBar({ steps, currentStep: _currentStep, overallProgress, isVisible }: ProgressBarProps) {
  const [animatedProgress, setAnimatedProgress] = useState(0);

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        setAnimatedProgress(overallProgress);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setAnimatedProgress(0);
    }
  }, [overallProgress, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-2xl">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-gray-800 mb-2">Provisioning Progress</h3>
        <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
          <div 
            className="bg-gradient-to-r from-whatsapp-green to-whatsapp-light h-3 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${animatedProgress}%` }}
          />
        </div>
        <p className="text-sm text-gray-600">{Math.round(animatedProgress)}% Complete</p>
      </div>

      <div className="space-y-4">
        {steps.map((step, index) => (
          <div key={step.id} className="flex items-start space-x-4">
            {/* Step Icon */}
            <div className="flex-shrink-0">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${step.status === 'completed' 
                  ? 'bg-green-500 text-white' 
                  : step.status === 'active' 
                  ? 'bg-whatsapp-green text-white animate-pulse' 
                  : step.status === 'error'
                  ? 'bg-red-500 text-white'
                  : 'bg-gray-300 text-gray-600'
                }
              `}>
                {step.status === 'completed' ? '✓' : 
                 step.status === 'error' ? '✗' : 
                 index + 1}
              </div>
            </div>

            {/* Step Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className={`text-sm font-medium ${
                  step.status === 'active' ? 'text-whatsapp-green' : 
                  step.status === 'completed' ? 'text-green-600' :
                  step.status === 'error' ? 'text-red-600' :
                  'text-gray-500'
                }`}>
                  {step.title}
                </h4>
                {step.status === 'active' && (
                  <span className="text-xs text-whatsapp-green font-medium">
                    {step.progress}%
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">{step.description}</p>
              
              {/* Sub-progress bar for active step */}
              {step.status === 'active' && (
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-whatsapp-green h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${step.progress}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status Message */}
      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-whatsapp-green mr-3"></div>
          <p className="text-sm text-blue-800">
            {steps.find(s => s.status === 'active')?.description || 'Processing...'}
          </p>
        </div>
      </div>
    </div>
  );
}

