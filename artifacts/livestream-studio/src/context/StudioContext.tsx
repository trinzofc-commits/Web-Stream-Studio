import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useListProjects, useCreateProject, useUpdateProject } from '@workspace/api-client-react';

type Project = {
  id: number;
  name: string;
  description?: string | null;
  activeSceneId?: number | null;
};

type StudioContextType = {
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  activeProject: Project | null;
  activeSceneId: number | null;
  setActiveSceneId: (id: number | null) => void;
  activeSourceId: number | null;
  setActiveSourceId: (id: number | null) => void;
  isLoading: boolean;
};

const StudioContext = createContext<StudioContextType | undefined>(undefined);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<number | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);

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

  return (
    <StudioContext.Provider
      value={{
        activeProjectId,
        setActiveProjectId,
        activeProject,
        activeSceneId,
        setActiveSceneId,
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
