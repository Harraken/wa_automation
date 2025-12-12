import { useState, useEffect, useRef } from 'react';

interface Session {
  id: string;
  phone: string | null;
  state: string;
  isActive: boolean;
}

interface ScreenshotsViewProps {
  session: Session;
}

export default function ScreenshotsView({ session }: ScreenshotsViewProps) {
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Track previous screenshots to detect changes
  const previousScreenshotsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);

  // Update ref when currentIndex changes
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Fetch screenshots list
  const fetchScreenshots = async () => {
    try {
      const response = await fetch(`/api/screenshots/${session.id}/list`);
      if (response.ok) {
        const data = await response.json();
        const filenames = data.screenshots || [];
        
        // Only update if the list actually changed
        if (JSON.stringify(filenames) !== JSON.stringify(previousScreenshotsRef.current)) {
          const oldLength = previousScreenshotsRef.current.length;
          previousScreenshotsRef.current = filenames;
          setScreenshots(filenames);
          
          // If new screenshots were added and we're at the end, auto-advance
          if (filenames.length > oldLength && currentIndexRef.current === oldLength - 1) {
            setCurrentIndex(filenames.length - 1);
          }
          // If this is the first load, show the latest
          else if (oldLength === 0 && filenames.length > 0) {
            setCurrentIndex(filenames.length - 1);
          }
        }
        
        setIsLoading(false);
        setImageError(filenames.length === 0);
      } else {
        setImageError(true);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Failed to fetch screenshots:', error);
      setImageError(true);
      setIsLoading(false);
    }
  };

  // Auto-refresh every 2 seconds
  useEffect(() => {
    // Reset when session changes
    setCurrentIndex(0);
    setScreenshots([]);
    setIsLoading(true);
    previousScreenshotsRef.current = [];
    currentIndexRef.current = 0;
    
    fetchScreenshots();
    const interval = setInterval(fetchScreenshots, 2000);
    return () => clearInterval(interval);
  }, [session.id]);

  // Navigation handlers
  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setImageError(false);
    }
  };

  const goToNext = () => {
    if (currentIndex < screenshots.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setImageError(false);
    }
  };

  const goToLatest = () => {
    setCurrentIndex(screenshots.length - 1);
    setImageError(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, screenshots.length]);

  // Current screenshot URL
  const currentScreenshot = screenshots[currentIndex];
  const imageUrl = currentScreenshot 
    ? `/api/screenshots/${session.id}/${currentScreenshot}?t=${Date.now()}`
    : '';

  return (
    <div className="flex-1 flex flex-col">
      {/* Header with navigation */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-700">
              Screenshots {screenshots.length > 0 && `(${currentIndex + 1} / ${screenshots.length})`}
            </h3>
            {currentScreenshot && (
              <p className="text-xs text-gray-500 mt-1">
                {currentScreenshot.replace(/\.(png|jpg|jpeg)$/, '')}
              </p>
            )}
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={goToPrevious}
              disabled={currentIndex === 0}
              className={`px-3 py-2 text-sm font-semibold rounded transition-colors ${
                currentIndex === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
              title="Précédent (←)"
            >
              ← Précédent
            </button>

            <button
              onClick={goToLatest}
              disabled={currentIndex === screenshots.length - 1}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                currentIndex === screenshots.length - 1
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-whatsapp-green text-white hover:bg-whatsapp-light'
              }`}
              title="Dernier"
            >
              📷 Dernier
            </button>

            <button
              onClick={goToNext}
              disabled={currentIndex === screenshots.length - 1}
              className={`px-3 py-2 text-sm font-semibold rounded transition-colors ${
                currentIndex === screenshots.length - 1
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
              }`}
              title="Suivant (→)"
            >
              Suivant →
            </button>
          </div>
        </div>
      </div>

      {/* Screenshot Display */}
      <div className="flex-1 flex items-center justify-center bg-black relative">
        {isLoading ? (
          <div className="text-center text-gray-400">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Chargement des screenshots...</p>
          </div>
        ) : imageError || screenshots.length === 0 ? (
          <div className="text-center text-gray-400">
            <svg
              className="w-24 h-24 mx-auto mb-4 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h2 className="text-xl font-semibold mb-2">Aucun screenshot disponible</h2>
            <p>Les screenshots apparaîtront ici pendant le provisioning</p>
          </div>
        ) : (
          <>
            <img
              src={imageUrl}
              alt={`Screenshot ${currentIndex + 1}`}
              className="max-w-full max-h-full cursor-pointer"
              onError={() => setImageError(true)}
              onClick={() => setSelectedImage(imageUrl)}
              style={{ maxHeight: 'calc(100vh - 200px)', objectFit: 'contain' }}
            />
            
            {/* Arrow Navigation Overlay */}
            {currentIndex > 0 && (
              <button
                onClick={goToPrevious}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-75 text-white rounded-full w-12 h-12 flex items-center justify-center transition-all"
                title="Précédent (←)"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            
            {currentIndex < screenshots.length - 1 && (
              <button
                onClick={goToNext}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 hover:bg-opacity-75 text-white rounded-full w-12 h-12 flex items-center justify-center transition-all"
                title="Suivant (→)"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* Fullscreen Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black bg-opacity-95 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <button
              className="absolute top-4 right-4 bg-white text-gray-900 rounded-full w-10 h-10 flex items-center justify-center hover:bg-gray-200 transition-colors z-10"
              onClick={() => setSelectedImage(null)}
            >
              ✕
            </button>
            <img
              src={selectedImage}
              alt="Screenshot en plein écran"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

