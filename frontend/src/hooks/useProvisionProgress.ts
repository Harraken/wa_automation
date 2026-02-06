import { useState, useCallback } from 'react';
import { ProgressStep } from '../components/ProgressBar';

export interface ProvisionProgress {
  isActive: boolean;
  currentStep: string;
  overallProgress: number;
  steps: ProgressStep[];
  provisionId: string | null;
  error: string | null;
}

const initialSteps: ProgressStep[] = [
  {
    id: 'init',
    title: '1. Initialisation',
    description: 'Configuration de la demande de provisioning...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'spawn_container',
    title: '2. Création du Conteneur',
    description: 'Création du conteneur Android émulateur...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'create_contact',
    title: '3. Création du Contact',
    description: 'Création du contact Android pour les tests WhatsApp...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'launch_whatsapp',
    title: '4. Lancement de WhatsApp',
    description: 'Démarrage de l\'application WhatsApp...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'buy_number',
    title: '5. Achat du Numéro',
    description: 'Achat du numéro de téléphone quand WhatsApp est prêt...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'enter_phone',
    title: '6. Saisie du Numéro',
    description: 'Soumission du numéro de téléphone à WhatsApp...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'wait_otp',
    title: '7. Attente du SMS',
    description: 'Surveillance du code SMS entrant...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'inject_otp',
    title: '8. Injection du Code',
    description: 'Saisie du code SMS dans WhatsApp...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'setup_profile',
    title: '9. Configuration du Profil',
    description: 'Finalisation de la configuration du profil WhatsApp...',
    status: 'pending',
    progress: 0
  },
  {
    id: 'complete',
    title: '10. Terminé',
    description: 'La session WhatsApp est prête !',
    status: 'pending',
    progress: 0
  }
];

export function useProvisionProgress() {
  const [progress, setProgress] = useState<ProvisionProgress>({
    isActive: false,
    currentStep: 'init',
    overallProgress: 0,
    steps: initialSteps,
    provisionId: null,
    error: null
  });

  const startProvision = useCallback((provisionId: string) => {
    setProgress({
      isActive: true,
      currentStep: 'init',
      overallProgress: 0,
      steps: initialSteps.map((step, index) => ({ 
        ...step, 
        status: index === 0 ? 'active' : 'pending', 
        progress: index === 0 ? 10 : 0 
      })),
      provisionId,
      error: null
    });
  }, []);

  const updateStep = useCallback((stepId: string, status: ProgressStep['status'], progress: number = 0) => {
    console.log(`🔄 [PROGRESS] Updating step ${stepId} to ${status} with ${progress}% progress`);
    setProgress(prev => {
      // Find the index of the target step
      const targetIndex = prev.steps.findIndex(s => s.id === stepId);
      
      const newSteps = prev.steps.map((step, index): ProgressStep => {
        if (step.id === stepId) {
          console.log(`✅ [PROGRESS] Step ${stepId} updated: ${step.title} -> ${status} (${progress}%)`);
          return { ...step, status, progress };
        }
        
        // If we're setting a step to 'active' or 'completed', 
        // ensure all previous steps are marked as 'completed'
        if ((status === 'active' || status === 'completed') && index < targetIndex) {
          if (step.status !== 'completed') {
            console.log(`✅ [PROGRESS] Auto-completing previous step: ${step.id}`);
            return { ...step, status: 'completed' as const, progress: 100 };
          }
        }
        
        // If we're setting a step to 'active',
        // ensure all following steps are marked as 'pending'
        if (status === 'active' && index > targetIndex) {
          if (step.status !== 'pending' && step.id !== 'complete') {
            console.log(`⏸️ [PROGRESS] Resetting future step to pending: ${step.id}`);
            return { ...step, status: 'pending' as const, progress: 0 };
          }
        }
        
        return step;
      });

      // Calculate overall progress
      const totalSteps = newSteps.length;
      const completedSteps = newSteps.filter(s => s.status === 'completed').length;
      const activeStep = newSteps.find(s => s.status === 'active');
      const activeProgress = activeStep ? activeStep.progress : 0;
      
      const overallProgress = Math.round(
        ((completedSteps + (activeStep ? activeProgress / 100 : 0)) / totalSteps) * 100
      );

      return {
        ...prev,
        currentStep: stepId,
        overallProgress,
        steps: newSteps
      };
    });
  }, []);

  const setError = useCallback((error: string) => {
    setProgress(prev => ({
      ...prev,
      error,
      isActive: true // Keep modal open to show the error
    }));
  }, []);

  const complete = useCallback(() => {
    setProgress(prev => ({
      ...prev,
      isActive: false,
      currentStep: 'complete',
      overallProgress: 100,
      steps: prev.steps.map(step => 
        step.id === 'complete' 
          ? { ...step, status: 'completed', progress: 100 }
          : step
      )
    }));
  }, []);

  const reset = useCallback(() => {
    setProgress({
      isActive: false,
      currentStep: 'init',
      overallProgress: 0,
      steps: initialSteps,
      provisionId: null,
      error: null
    });
  }, []);

  return {
    progress,
    startProvision,
    updateStep,
    setError,
    complete,
    reset
  };
}

