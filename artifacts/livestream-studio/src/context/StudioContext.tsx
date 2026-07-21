import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useListProjects } from '@workspace/api-client-react';

type Project = {
  id: number;
  name: string;
  description?: string | null;
  activeSceneId?: number | null;
};

export type SceneTransition = {
  type: string;
  durationMs: number;
};

type StudioContextType = {
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  activeProject: Project | null;
  activeSceneId: number | null;
  setActiveSceneId: (id: number | null) => void;
  /** Switch to a scene with an animated transition. */
  switchScene: (sceneId: number, transition?: SceneTransition) => void;
  /** Pending transition to apply when new scene sources arrive. Read-once via consumePendingTransition. */
  consumePendingTransition: () => SceneTransition | null;
  /** Current active transition for the UI overlay (set for the duration of the animation). */
  activeTransition: SceneTransition | null;
  activeSourceId: number | null;
  setActiveSourceId: (id: number | null) => void;
  isLoading: boolean;
};

const StudioContext = createContext<StudioContextType | undefined>(undefined);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<number | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const [activeTransition, setActiveTransition] = useState<SceneTransition | null>(null);

  // Ref so consumePendingTransition always reads the latest value without stale closures
  const pendingTransitionRef = useRef<SceneTransition | null>(null);

  const { data: projects, isLoading } = useListProjects();

  // Auto-load first project
  useEffect(() => {
    if (!isLoading && projects && projects.length > 0 && !activeProjectId) {
      const first = projects[0];
      setActiveProjectId(first.id);
      if (first.activeSceneId) setActiveSceneId(first.activeSceneId);
    }
  }, [isLoading, projects, activeProjectId]);

  const activeProject = projects?.find((p) => p.id === activeProjectId) ?? null;

  const switchScene = useCallback((sceneId: number, transition?: SceneTransition) => {
    if (transition && transition.type !== 'cut') {
      pendingTransitionRef.current = transition;
      setActiveTransition(transition);
      setTimeout(() => setActiveTransition(null), transition.durationMs + 50);
    } else {
      pendingTransitionRef.current = null;
    }
    setActiveSceneId(sceneId);
    setActiveSourceId(null);
  }, []);

  const consumePendingTransition = useCallback((): SceneTransition | null => {
    const t = pendingTransitionRef.current;
    pendingTransitionRef.current = null;
    return t;
  }, []);

  return (
    <StudioContext.Provider
      value={{
        activeProjectId,
        setActiveProjectId,
        activeProject,
        activeSceneId,
        setActiveSceneId,
        switchScene,
        consumePendingTransition,
        activeTransition,
        activeSourceId,
        setActiveSourceId,
        isLoading,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (context === undefined) throw new Error('useStudio must be used within a StudioProvider');
  return context;
}
